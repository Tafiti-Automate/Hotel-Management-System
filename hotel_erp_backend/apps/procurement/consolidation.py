"""Transactional supplier/currency consolidation of approved PR lines.

An LPO can contain identical Articles from separate departments, but each LPO
line retains its originating RequisitionItem. The existing LPO/GRN/invoice
approval chain stays unchanged; the historical primary requisition FK remains
for compatibility with already-issued documents.
"""
from collections import defaultdict
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.procurement.models import (
    PurchaseOrder, PurchaseOrderItem, RequisitionItem,
)
from core.constants.choices import POStatus, PRStatus


@transaction.atomic
def consolidate_approved_requisitions(*, buyer, actor, requisition_item_ids):
    """Create at most one draft LPO per supplier+currency; all or nothing."""
    if not buyer or not buyer.is_active or not buyer.branch_id:
        raise ValidationError("An active Purchasing employee assigned to a property is required.")
    if not isinstance(requisition_item_ids, list) or not (
        1 <= len(requisition_item_ids) <= 100
    ):
        raise ValidationError("Select between 1 and 100 approved PR lines.")
    ids = [str(value) for value in requisition_item_ids]
    if len(ids) != len(set(ids)):
        raise ValidationError("Each requisition line can be selected only once.")

    rows = list(
        # Lock only non-nullable joins: PostgreSQL forbids FOR UPDATE on
        # the nullable side of supplier/unit/destination outer joins.
        RequisitionItem.objects.select_for_update().select_related(
            "requisition", "item",
        ).filter(pk__in=ids).order_by("requisition_id", "item_id")
    )
    if len(rows) != len(ids):
        raise ValidationError("One or more selected lines do not exist or were removed.")

    grouped = defaultdict(list)
    today = timezone.localdate()
    for line in rows:
        req = line.requisition
        if req.status not in (PRStatus.APPROVED, PRStatus.PARTIALLY_ORDERED):
            raise ValidationError(
                f"{req.requisition_number} is not approved for Purchasing."
            )
        if req.branch_id != buyer.branch_id:
            raise ValidationError("Cannot consolidate requisitions from another property.")
        if not all((
            line.procurement_supplier_id, line.procurement_supplier_price_id,
            line.procurement_unit_id, line.procurement_quantity,
            line.procurement_unit_cost,
        )):
            raise ValidationError(
                f"Allocate a vetted supplier, purchase unit, quantity and price for {line.item}."
            )
        quote = line.procurement_supplier_price
        if (
            quote.supplier_id != line.procurement_supplier_id
            or quote.item_id != line.item_id
            or not quote.is_active
            or quote.effective_from > today
            or (quote.quotation_valid_until and quote.quotation_valid_until < today)
        ):
            raise ValidationError(f"{line.item}: the chosen supplier quote is no longer valid.")
        if quote.currency != req.currency:
            raise ValidationError(
                f"{req.requisition_number}: quote currency differs from the approved PR."
            )
        if line.procurement_quantity <= Decimal("0") or line.procurement_unit_cost <= Decimal("0"):
            raise ValidationError("Allocated purchase quantity and price must be positive.")
        base = line.item.quantity_in_base_units(
            line.procurement_quantity, line.procurement_unit
        )
        if base <= Decimal("0") or base > line.remaining_order_quantity:
            raise ValidationError(
                f"{line.item}: allocation exceeds the remaining approved PR quantity."
            )
        if line.purchase_order_items.exclude(
            purchase_order__status=POStatus.CANCELLED,
        ).exists():
            raise ValidationError(
                f"{line.item} on {req.requisition_number} already has an LPO. "
                "Complete or cancel the existing document before ordering again."
            )
        if line.destination_store_id and (
            line.destination_store.branch_id != req.branch_id
            or not line.destination_store.is_active
            or line.destination_store.is_virtual_transit
        ):
            raise ValidationError("Destination store must be an active physical store in this property.")
        grouped[(line.procurement_supplier_id, req.currency)].append(line)

    orders = []
    for (supplier_id, currency), group in sorted(grouped.items(), key=lambda entry: (str(entry[0][0]), entry[0][1])):
        source_ids = sorted({row.requisition_id for row in group}, key=str)
        first = group[0]
        stores = {row.destination_store_id for row in group}
        destination = first.destination_store if len(stores) == 1 else None
        order = PurchaseOrder.objects.create(
            requisition=first.requisition,
            supplier=first.procurement_supplier,
            ordered_by=buyer,
            store=destination,
            expected_date=min(
                (row.requisition.expected_date for row in group if row.requisition.expected_date),
                default=None,
            ),
            note=(
                f"Consolidated {len(group)} approved PR line(s) from "
                f"{len(source_ids)} requisition(s). Supplier currency: {currency}."
            ),
            created_by=actor,
        )
        order.source_requisitions.set(source_ids)
        for line in group:
            PurchaseOrderItem.objects.create(
                purchase_order=order,
                requisition_item=line,
                item=line.item,
                unit=line.procurement_unit,
                quantity=line.procurement_quantity,
                unit_cost=line.procurement_unit_cost,
                destination_type=line.destination_type,
                destination_store=line.destination_store,
                destination_department=line.destination_department,
                destination_justification=line.destination_justification,
                created_by=actor,
            )
        order.lead_time_days = max(
            (row.procurement_supplier_price.lead_time_days or 0 for row in group),
            default=0,
        )
        order.save(update_fields=("lead_time_days", "updated_at"))
        order.record_activity(
            action="consolidated_from_requisitions",
            actor=actor,
            metadata={
                "source_requisitions": [str(key) for key in source_ids],
                "source_lines": [str(line.pk) for line in group],
                "supplier": str(supplier_id),
                "currency": currency,
            },
            previous_status=POStatus.DRAFT,
            new_status=POStatus.DRAFT,
        )
        orders.append(order)
    return orders
