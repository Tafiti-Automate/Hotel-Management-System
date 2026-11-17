from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("materials_control", "0004_pos_historical_cogs"),
    ]

    operations = [
        migrations.AlterField(
            model_name="glaccountmapping",
            name="source_type",
            field=models.CharField(
                max_length=40,
                choices=[
                    ("supplier_invoice", "Supplier invoices"),
                    ("expense", "Expenses"),
                    ("supplier_payment", "Supplier payments (AP debit / bank clearing credit)"),
                ],
            ),
        ),
    ]
