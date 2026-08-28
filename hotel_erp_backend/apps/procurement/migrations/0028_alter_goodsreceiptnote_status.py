from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("procurement", "0027_alter_requisitionitem_procurement_supplier_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="goodsreceiptnote",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("received", "Received"),
                    ("inspected", "Inspected"),
                    ("posted", "Posted"),
                    ("cancelled", "Cancelled"),
                ],
                default="draft",
                max_length=20,
            ),
        ),
    ]
