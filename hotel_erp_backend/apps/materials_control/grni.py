"""Read-only GRNI reconciliation of posted receipt value against matched invoices.

No GL posting is performed. The report identifies the documentary value still
requiring a Goods Received Not Invoiced accounting treatment, using the frozen
LPO cost of posted GRNs. Any supplier return, credit, incomplete historical
posting date, or ambiguous header-only invoice receives a review warning.
"""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

from apps.finance.models import SupplierInvoice
from apps.procurement.models import GoodsReceiptItem, GoodsReceiptNote, SupplierReturn

CENT = Decimal("0.01")
FOUR = Decimal("0.0001")
MATCHED = (
    SupplierInvoice.STATUS_MATCHED,
    SupplierInvoice.STATUS_APPROVED,
    SupplierInvoice.STATUS_PARTIALLY_PAID,
    SupplierInvoice.STATUS_PAID,
)


def money(value):
    return str(value.quantize(CENT, rounding=ROUND_HALF_UP))


def grni_reconciliation(period):
    """Compare posted GRN acquisitions with matched invoice coverage per LPO.

    This is a *current-state period-end documentary comparison*, not a
    historical GL snapshot. Invoice status changes are not currently
    timestamped; therefore period-end reconstruction is not authoritative.
    """
    cutoff = period.end_date
    rows = {}
    receipt_lines = GoodsReceiptItem.objects.filter(
        goods_receipt__purchase_order__requisition__branch_id=period.branch_id,
        goods_receipt__status="posted",
        goods_receipt__received_date__lte=cutoff,
        inventory_changes_applied=True,
    ).select_related(
        "goods_receipt", "goods_receipt__purchase_order",
        "goods_receipt__purchase_order__supplier",
        "goods_receipt__purchase_order__requisition__department",
        "purchase_order_item",
    ).order_by("goods_receipt__received_date", "goods_receipt_id", "pk")

    for line in receipt_lines.iterator():
        receipt = line.goods_receipt
        # A backdated GRN posted after cutoff must not enter that period.
        if receipt.posted_at and receipt.posted_at.date() > cutoff:
            continue
        po = receipt.purchase_order
        key = str(po.pk)
        entry = rows.setdefault(key, {
            "purchase_order_id": key,
            "lpo_number": po.lpo_number or po.po_number,
            "supplier": str(po.supplier),
            "department": str(po.requisition.department or ""),
            "receipt_ids": set(),
            "received_qty": Decimal("0.0000"),
            "received_value": Decimal("0.00"),
            "matched_value": Decimal("0.00"),
            "receipt_lines": defaultdict(lambda: {"quantity": Decimal("0"), "value": Decimal("0")}),
            "warnings": [], "invoice_count": 0,
        })
        entry["receipt_ids"].add(str(receipt.pk))
        if not receipt.posted_at:
            entry["warnings"].append(
                f"GRN {receipt.grn_number} has no posting timestamp; verify its period."
            )
        try:
            qty = line.inventory_post_quantity()
            if qty <= 0 or line.base_unit_cost <= 0:
                entry["warnings"].append(
                    f"GRN {receipt.grn_number} has a nonpositive accepted quantity or cost."
                )
                continue
            value = qty * line.base_unit_cost
            entry["received_qty"] += qty
            entry["received_value"] += value
            part = entry["receipt_lines"][str(line.purchase_order_item_id)]
            part["quantity"] += qty
            part["value"] += value
        except Exception:
            entry["warnings"].append(
                f"GRN {receipt.grn_number} has inconsistent inspection or UOM evidence."
            )

    if not rows:
        return {
            "period_id": str(period.pk), "branch_id": str(period.branch_id),
            "as_of_date": cutoff.isoformat(), "orders": [], "order_count": 0,
            "received_value": "0.00", "matched_invoice_value": "0.00",
            "unmatched_receipt_value": "0.00", "requires_manual_review": False,
            "posted": False,
            "note": "No posted and dated GRN value in scope. Read-only; no GRNI or GL journals booked.",
        }

    invoice_records = SupplierInvoice.objects.filter(
        purchase_order_id__in=list(rows),
        invoice_date__lte=cutoff,
        created_at__date__lte=cutoff,
        status__in=MATCHED,
    ).select_related("purchase_order").prefetch_related("items__purchase_order_item")
    by_order = defaultdict(list)
    for invoice in invoice_records:
        by_order[str(invoice.purchase_order_id)].append(invoice)

    returns = SupplierReturn.objects.filter(
        goods_receipt__purchase_order_id__in=list(rows),
        inventory_changes_applied=True, return_date__lte=cutoff,
    ).values_list("goods_receipt__purchase_order_id", "return_no")
    for order_id, return_no in returns:
        rows[str(order_id)]["warnings"].append(
            f"Posted supplier return {return_no} requires independent GRNI/credit treatment."
        )

    total_receipt = total_matched = total_unmatched = Decimal("0")
    result = []
    any_warnings = False
    for key, entry in sorted(rows.items(), key=lambda x: (x[1]["lpo_number"], x[0])):
        invoices = by_order.get(key, [])
        entry["invoice_count"] = len(invoices)
        header = [invoice for invoice in invoices if not invoice.items.exists()]
        detailed = [invoice for invoice in invoices if invoice.items.exists()]
        if header and (len(header) != 1 or detailed):
            entry["warnings"].append(
                "Mixed or repeated header-only invoices have ambiguous receipt allocation."
            )
        elif header:
            entry["matched_value"] = header[0].subtotal
        else:
            for invoice in detailed:
                for item in invoice.items.all():
                    item_id = str(item.purchase_order_item_id)
                    source = entry["receipt_lines"].get(item_id)
                    if source is None or source["quantity"] <= 0:
                        entry["warnings"].append(
                            f"Invoice {invoice.invoice_number} allocates to an LPO line without posted GRN value."
                        )
                        continue
                    base_cost = item.purchase_order_item.base_unit_cost
                    entry["matched_value"] += item.base_quantity * base_cost

        received = entry["received_value"].quantize(CENT, rounding=ROUND_HALF_UP)
        matched = entry["matched_value"].quantize(CENT, rounding=ROUND_HALF_UP)
        outstanding = received - matched
        if outstanding < 0:
            entry["warnings"].append(
                f"Matched invoice cover exceeds posted receipt value by {money(-outstanding)}."
            )
        warnings = list(dict.fromkeys(entry["warnings"]))
        if warnings:
            any_warnings = True
        total_receipt += received
        total_matched += matched
        total_unmatched += outstanding
        result.append({
            "purchase_order_id": entry["purchase_order_id"],
            "lpo_number": entry["lpo_number"],
            "supplier": entry["supplier"],
            "department": entry["department"],
            "posted_grn_count": len(entry["receipt_ids"]),
            "matched_invoice_count": entry["invoice_count"],
            "received_base_quantity": str(entry["received_qty"].quantize(FOUR)),
            "posted_receipt_value": money(received),
            "matched_invoice_value": money(matched),
            "unmatched_receipt_value": money(outstanding),
            "requires_review": bool(warnings),
            "warnings": warnings,
        })

    return {
        "period_id": str(period.pk), "branch_id": str(period.branch_id),
        "as_of_date": cutoff.isoformat(), "orders": result, "order_count": len(result),
        "received_value": money(total_receipt),
        "matched_invoice_value": money(total_matched),
        "unmatched_receipt_value": money(total_unmatched),
        "requires_manual_review": any_warnings,
        "posted": False,
        "note": (
            "Read-only GRNI documentary reconciliation, not a posted accounting balance. "
            "Current invoice status and dated records are used; historical match-state "
            "snapshots are unavailable. Posted supplier returns and ambiguous headers "
            "require independent Finance reconciliation. No GL/GRNI journal is created."
        ),
    }
