from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("procurement", "0029_line_quantity_approval_controls"),
    ]

    operations = [
        migrations.AlterField(
            model_name="purchaserequisition",
            name="procurement_source",
            field=models.CharField(
                choices=[
                    ("store_requisition", "Store Keeper requisition"),
                    ("store_purchase", "Store purchase request"),
                    ("store_shortage", "Store shortage (legacy)"),
                    ("manual", "Manual procurement"),
                    ("capital_asset", "Capital asset"),
                    ("emergency", "Emergency purchase"),
                    ("project", "Project purchase"),
                    ("service", "Service / non-stock purchase"),
                ],
                db_index=True,
                default="manual",
                max_length=30,
            ),
        ),
    ]
