"""Independent, read-only LPO quantity comparison after the clerk's count locks.

Never use this payload while the blind count is open. Commercial unit prices
and order values are not included. Missing LPO lines appear as zero counted so
undelivered articles are visible during the reconciliation.
"""
from decimal import Decimal
from django.core.exceptions import ValidationError
from django.db.models import Q

from apps.procurement.models import GoodsReceiptNote, GoodsReceiptItem
from core.constants.choices import GoodsReceiptStatus


FOUR = Decimal("0.0001")


def quantity(value):
    return str(Decimal(value).quantize(FOUR))


def blind_receiving_reconciliation(receipt):
    if not receipt.blind_count_locked_at:
        raise ValidationError("Save and lock the blind count before viewing ordered quantities.")
    if receipt.status == GoodsReceiptStatus.CANCELLED:
        raise ValidationError("Cancelled deliveries cannot be reconciled for receiving.")

    order = receipt.purchase_order
    current = {
        line.purchase_order_item_id: line
        for line in receipt.items.select_related(
            "item", "purchase_order_item__unit",
        ).prefetch_related("inspection_items")
    }
    output = []
    for order_line in order.items.select_related("item", "unit").order_by("item__name", "pk"):
        # Subsequent deliveries cannot silently rewrite the originally due
        # quantity. Only receipts created before this locked GRN are relevant.
        previous = GoodsReceiptItem.objects.filter(
            purchase_order_item=order_line,
            goods_receipt__created_at__lt=receipt.created_at,
        ).exclude(goods_receipt__status=GoodsReceiptStatus.CANCELLED).select_related(
            "purchase_order_item", "goods_receipt"
        ).prefetch_related("goods_receipt__inspection__items")
        previous_received = sum(
            (prior.committed_purchase_quantity for prior in previous),
            Decimal("0.0000"),
        )
        ordered = order_line.approved_quantity or Decimal("0")
        due_before = max(Decimal("0"), ordered - previous_received)
        current_line = current.get(order_line.pk)
        counted = current_line.quantity_received if current_line else Decimal("0")
        factor = order_line.conversion_factor
        decision = current_line.inspection_items.first() if current_line else None
        accepted = (
            decision.quantity_accepted / factor if decision and factor > 0
            else (counted if current_line else Decimal("0"))
        )
        rejected = (
            decision.quantity_rejected / factor if decision and factor > 0
            else Decimal("0")
        )
        difference = counted - due_before
        short = max(Decimal("0"), -difference)
        excess = max(Decimal("0"), difference)
        outstanding_after = max(Decimal("0"), due_before - accepted)
        output.append({
            "purchase_order_item": str(order_line.pk),
            "article": order_line.item.name,
            "sku": order_line.item.sku,
            "unit": (
                order_line.unit.abbreviation or order_line.unit.name
                if order_line.unit_id else (order_line.item.unit or "")
            ),
            "ordered_quantity": quantity(ordered),
            "previously_received_quantity": quantity(previous_received),
            "due_before_delivery": quantity(due_before),
            "counted_quantity": quantity(counted),
            "accepted_quantity": quantity(accepted),
            "rejected_quantity": quantity(rejected),
            "short_quantity": quantity(short),
            "excess_quantity": quantity(excess),
            "outstanding_after_inspection": quantity(outstanding_after),
            "difference": quantity(difference),
            "rejection_reason": decision.rejection_reason if decision else "",
            "has_variance": bool(difference or rejected),
            "received_line_id": str(current_line.pk) if current_line else None,
        })

    has_variance = any(item["has_variance"] for item in output)
    return {
        "grn_id": str(receipt.pk),
        "grn_number": receipt.grn_number,
        "lpo_number": order.lpo_number or order.po_number,
        "supplier": order.supplier.name,
        "status": receipt.status,
        "blind_count_locked": True,
        "blind_count_locked_at": receipt.blind_count_locked_at.isoformat(),
        "recorded_by": (
            receipt.received_by.user.get_full_name()
            or receipt.received_by.user.username
        ),
        "received_date": receipt.received_date.isoformat(),
        "has_variance": has_variance,
        "variance_note": receipt.note,
        "variance_note_required": has_variance and not receipt.note.strip(),
        "lines": output,
        "note": (
            "Ordered quantities were revealed only after the saved physical count "
            "was locked. Counted and inspection quantities are read-only. "
            "Supplier prices and commercial totals are not disclosed."
        ),
    }
