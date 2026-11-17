from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("materials_control", "0005_gl_supplier_payment_source")]
    operations = [
        migrations.AlterField(
            model_name="glaccountmapping", name="source_type",
            field=models.CharField(max_length=40, choices=[
                ("supplier_invoice", "Supplier invoices"),
                ("expense", "Expenses"),
                ("supplier_payment", "Supplier payments (AP debit / bank clearing credit)"),
                ("stock_consumption", "Department stock consumption"),
                ("pos_cogs", "POS cost of goods sold"),
                ("stock_waste", "Waste and spoilage expense"),
                ("stock_variance", "Physical counts and stock adjustments"),
            ]),
        ),
    ]
