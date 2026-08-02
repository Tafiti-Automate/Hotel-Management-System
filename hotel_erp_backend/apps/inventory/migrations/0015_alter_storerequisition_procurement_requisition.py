from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0014_store_requisition_procurement_link"),
        ("procurement", "0013_purchaserequisition_procurement_source"),
    ]

    operations = [
        migrations.AlterField(
            model_name="storerequisition",
            name="procurement_requisition",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="linked_store_requisition",
                to="procurement.purchaserequisition",
            ),
        ),
    ]
