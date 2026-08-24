from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

import core.validators.quantities


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0019_storerequisition_store_optional"),
        ("vendors", "0002_supplier_contact_person_supplier_notes_and_more"),
        ("procurement", "0023_enforce_purchaseorder_lpo_number_not_null"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="requisitionitem",
            name="procurement_supplier",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="allocated_requisition_items",
                to="vendors.supplier",
            ),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="procurement_supplier_price",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="allocated_requisition_items",
                to="inventory.supplieritemprice",
            ),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="procurement_unit",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="procurement_allocations",
                to="inventory.unitofmeasure",
            ),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="procurement_quantity",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=12,
                null=True,
                validators=[core.validators.quantities.validate_non_negative_decimal],
            ),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="procurement_unit_cost",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=15,
                null=True,
                validators=[core.validators.quantities.validate_non_negative_decimal],
            ),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="procurement_note",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="procurement_allocated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="procurement_allocated_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="procurement_line_allocations",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
