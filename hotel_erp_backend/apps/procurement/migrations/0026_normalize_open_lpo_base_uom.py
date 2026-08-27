from decimal import Decimal, ROUND_HALF_UP

from django.db import migrations


TWOPLACES = Decimal("0.01")
OPEN_STATUSES = ("draft", "pending_approval", "approved")


def q2(value):
    return Decimal(value).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def normalize_open_lpos(apps, schema_editor):
    RequisitionItem = apps.get_model("procurement", "RequisitionItem")
    PurchaseOrder = apps.get_model("procurement", "PurchaseOrder")
    PurchaseOrderItem = apps.get_model("procurement", "PurchaseOrderItem")
    Item = apps.get_model("inventory", "Item")
    ItemUnitPrice = apps.get_model("inventory", "ItemUnitPrice")

    item_base_units = dict(Item.objects.values_list("id", "base_unit_id"))

    def factor_for(item_id, unit_id):
        base_unit_id = item_base_units.get(item_id)
        if not unit_id or not base_unit_id or unit_id == base_unit_id:
            return Decimal("1")
        factor = ItemUnitPrice.objects.filter(
            item_id=item_id,
            unit_id=unit_id,
            is_active=True,
        ).values_list("conversion_factor", flat=True).first()
        return Decimal(factor) if factor else None

    # Existing Procurement allocations created before this fix stored the
    # supplier pack quantity (for example 0.20 carton for one ream). Convert
    # unfinished allocations to the Article base/request UOM while retaining
    # the linked supplier quotation as the commercial evidence.
    for line in RequisitionItem.objects.exclude(procurement_quantity__isnull=True).iterator():
        base_unit_id = item_base_units.get(line.item_id)
        if not base_unit_id or not line.procurement_unit_id or line.procurement_unit_id == base_unit_id:
            continue
        factor = factor_for(line.item_id, line.procurement_unit_id)
        if not factor or factor <= 0:
            continue
        base_quantity = q2(Decimal(line.procurement_quantity) * factor)
        updates = {
            "procurement_unit_id": base_unit_id,
            "procurement_quantity": base_quantity,
        }
        if line.procurement_unit_cost is not None:
            updates["procurement_unit_cost"] = q2(Decimal(line.procurement_unit_cost) / factor)
        RequisitionItem.objects.filter(pk=line.pk).update(**updates)

    # Correct draft/pending/final-approved-but-not-issued LPOs so the supplier
    # document shows the quantity approved by the client (1 ream, 1 bottle,
    # etc.) rather than a fractional supplier pack. Issued LPOs are historical
    # supplier-facing documents and are intentionally left unchanged.
    affected_order_ids = set()
    for line in PurchaseOrderItem.objects.filter(
        purchase_order__status__in=OPEN_STATUSES,
    ).iterator():
        base_unit_id = item_base_units.get(line.item_id)
        if not base_unit_id or not line.unit_id or line.unit_id == base_unit_id:
            continue
        factor = factor_for(line.item_id, line.unit_id)
        if not factor or factor <= 0:
            continue

        base_quantity = Decimal(line.base_quantity or 0)
        if base_quantity <= 0:
            base_quantity = Decimal(line.quantity) * factor
        base_quantity = q2(base_quantity)
        unit_cost = q2(Decimal(line.unit_cost) / factor)

        procurement_quantity = line.procurement_base_quantity
        if procurement_quantity is None:
            procurement_quantity = base_quantity
        else:
            procurement_quantity = q2(procurement_quantity)

        finance_quantity = None
        if line.finance_approved_quantity is not None:
            finance_quantity = line.finance_approved_base_quantity
            if finance_quantity is None:
                finance_quantity = Decimal(line.finance_approved_quantity) * factor
            finance_quantity = q2(finance_quantity)

        PurchaseOrderItem.objects.filter(pk=line.pk).update(
            unit_id=base_unit_id,
            quantity=base_quantity,
            base_quantity=base_quantity,
            procurement_quantity=procurement_quantity,
            procurement_base_quantity=procurement_quantity,
            finance_approved_quantity=finance_quantity,
            finance_approved_base_quantity=finance_quantity,
            unit_cost=unit_cost,
        )
        affected_order_ids.add(line.purchase_order_id)

    # Recalculate open LPO totals after the UOM normalization.
    for order_id in affected_order_ids:
        total = Decimal("0.00")
        for line in PurchaseOrderItem.objects.filter(purchase_order_id=order_id).iterator():
            quantity = line.finance_approved_quantity
            if quantity is None:
                quantity = line.quantity
            total += Decimal(quantity or 0) * Decimal(line.unit_cost or 0)
        PurchaseOrder.objects.filter(pk=order_id).update(total_amount=q2(total))


def reverse_noop(apps, schema_editor):
    # This migration corrects client-facing units on unfinished documents.
    # Reintroducing fractional pack quantities would be destructive/confusing.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0022_department_requisition_reference_and_hod_backfill"),
        ("procurement", "0025_numeric_client_references"),
    ]

    operations = [
        migrations.RunPython(normalize_open_lpos, reverse_noop),
    ]
