from django.db import migrations, models


def backfill_receipt_status(apps, schema_editor):
    GoodsReceiptNote = apps.get_model("procurement", "GoodsReceiptNote")
    GoodsReceiptNote.objects.filter(posted_at__isnull=False).update(status="posted")
    GoodsReceiptNote.objects.filter(
        posted_at__isnull=True,
        inspection__isnull=False,
    ).update(status="inspected")


class Migration(migrations.Migration):

    dependencies = [
        ("procurement", "0015_purchaseorder_approval_control"),
    ]

    operations = [
        migrations.AddField(
            model_name="goodsreceiptnote",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("inspected", "Inspected"),
                    ("posted", "Posted"),
                    ("cancelled", "Cancelled"),
                ],
                default="draft",
                max_length=20,
            ),
        ),
        migrations.RunPython(backfill_receipt_status, migrations.RunPython.noop),
    ]
