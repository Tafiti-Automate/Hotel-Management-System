"""Retain every source PR line on supplier-consolidated purchase orders."""
from django.db import migrations, models


def backfill_sources(apps, schema_editor):
    Order = apps.get_model("procurement", "PurchaseOrder")
    for order in Order.objects.all().iterator():
        order.source_requisitions.add(order.requisition_id)


class Migration(migrations.Migration):
    dependencies = [
        ("procurement", "0033_goodsreceiptitem_batch_number_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchaseorder",
            name="source_requisitions",
            field=models.ManyToManyField(
                blank=True,
                help_text="All approved requisitions contributing individual Articles to this LPO.",
                related_name="consolidated_purchase_orders",
                to="procurement.purchaserequisition",
            ),
        ),
        migrations.RemoveConstraint(
            model_name="purchaseorderitem",
            name="unique_purchase_order_item_unit",
        ),
        migrations.AddConstraint(
            model_name="purchaseorderitem",
            constraint=models.UniqueConstraint(
                fields=("purchase_order", "requisition_item"),
                condition=models.Q(requisition_item__isnull=False),
                name="unique_po_line_source",
            ),
        ),
        migrations.AddConstraint(
            model_name="purchaseorderitem",
            constraint=models.UniqueConstraint(
                fields=("purchase_order", "item", "unit"),
                condition=models.Q(requisition_item__isnull=True),
                name="unique_legacy_po_item_unit",
            ),
        ),
        migrations.RunPython(backfill_sources, migrations.RunPython.noop),
    ]
