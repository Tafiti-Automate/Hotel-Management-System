import django.db.models.deletion
from django.db import migrations, models


def backfill_source_requisition_lines(apps, schema_editor):
    PurchaseOrderItem = apps.get_model("procurement", "PurchaseOrderItem")
    RequisitionItem = apps.get_model("procurement", "RequisitionItem")
    for line in PurchaseOrderItem.objects.select_related("purchase_order").iterator():
        source = RequisitionItem.objects.filter(
            requisition_id=line.purchase_order.requisition_id,
            item_id=line.item_id,
        ).first()
        if source:
            line.requisition_item_id = source.id
            line.save(update_fields=("requisition_item",))


class Migration(migrations.Migration):

    dependencies = [
        ("procurement", "0016_goodsreceiptnote_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchaseorderitem",
            name="requisition_item",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="purchase_order_items",
                to="procurement.requisitionitem",
            ),
        ),
        migrations.RunPython(backfill_source_requisition_lines, migrations.RunPython.noop),
    ]
