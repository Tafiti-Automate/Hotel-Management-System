from decimal import Decimal

from django.db import migrations


RECEIPT_STATUSES = ("received", "inspected", "posted")
OPEN_DELIVERY_STATUSES = ("issued", "partially_received", "received")


def sync_lpo_delivery_status(apps, schema_editor):
    PurchaseOrder = apps.get_model("procurement", "PurchaseOrder")
    PurchaseOrderItem = apps.get_model("procurement", "PurchaseOrderItem")
    GoodsReceiptItem = apps.get_model("procurement", "GoodsReceiptItem")
    GoodsInspectionItem = apps.get_model("procurement", "GoodsInspectionItem")

    for order in PurchaseOrder.objects.filter(status__in=OPEN_DELIVERY_STATUSES).iterator():
        lines = list(PurchaseOrderItem.objects.filter(purchase_order_id=order.pk))
        if not lines:
            continue

        has_received = False
        fully_received = True
        has_positive_approved_line = False

        for line in lines:
            approved = (
                line.management_approved_quantity
                if line.management_approved_quantity is not None
                else line.finance_approved_quantity
                if line.finance_approved_quantity is not None
                else line.purchasing_approved_quantity
                if line.purchasing_approved_quantity is not None
                else line.quantity
            ) or Decimal("0.00")
            if approved <= Decimal("0.00"):
                continue
            has_positive_approved_line = True

            factor = Decimal("1.00")
            if line.quantity and line.base_quantity:
                factor = line.base_quantity / line.quantity
                if factor <= Decimal("0.00"):
                    factor = Decimal("1.00")

            received = Decimal("0.00")
            receipt_items = GoodsReceiptItem.objects.filter(
                purchase_order_item_id=line.pk,
                goods_receipt__status__in=RECEIPT_STATUSES,
            )
            for receipt_item in receipt_items:
                committed = receipt_item.quantity_received or Decimal("0.00")
                inspection_item = GoodsInspectionItem.objects.filter(
                    goods_receipt_item_id=receipt_item.pk
                ).first()
                if inspection_item and inspection_item.quantity_rejected:
                    committed -= inspection_item.quantity_rejected / factor
                received += max(committed, Decimal("0.00"))

            if received > Decimal("0.00"):
                has_received = True
            if received < approved:
                fully_received = False

        if not has_positive_approved_line:
            continue
        if fully_received and has_received:
            target = "received"
        elif has_received:
            target = "partially_received"
        else:
            target = "issued"

        if order.status != target:
            PurchaseOrder.objects.filter(pk=order.pk).update(status=target)


class Migration(migrations.Migration):
    dependencies = [
        ("procurement", "0030_store_purchase_request_source"),
    ]

    operations = [
        migrations.RunPython(sync_lpo_delivery_status, migrations.RunPython.noop),
    ]
