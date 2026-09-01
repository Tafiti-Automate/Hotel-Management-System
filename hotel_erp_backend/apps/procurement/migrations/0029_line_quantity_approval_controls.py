from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import core.validators.quantities


class Migration(migrations.Migration):
    dependencies = [
        ("procurement", "0028_alter_goodsreceiptnote_status"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="requisitionitem",
            name="approved_quantity",
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
            name="rejection_stage",
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="rejection_reason",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="rejected_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="requisitionitem",
            name="rejected_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="rejected_procurement_requisition_items",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="purchaseorderitem",
            name="purchasing_approved_quantity",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Purchasing Manager approved quantity; blank means the Procurement draft quantity was retained.",
                max_digits=12,
                null=True,
                validators=[core.validators.quantities.validate_non_negative_decimal],
            ),
        ),
        migrations.AddField(
            model_name="purchaseorderitem",
            name="purchasing_approved_base_quantity",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=12,
                null=True,
                validators=[core.validators.quantities.validate_non_negative_decimal],
            ),
        ),
        migrations.AddField(
            model_name="purchaseorderitem",
            name="purchasing_reduction_reason",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="purchaseorderitem",
            name="management_approved_quantity",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="General Manager approved quantity; blank means the Finance-approved quantity was retained.",
                max_digits=12,
                null=True,
                validators=[core.validators.quantities.validate_non_negative_decimal],
            ),
        ),
        migrations.AddField(
            model_name="purchaseorderitem",
            name="management_approved_base_quantity",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=12,
                null=True,
                validators=[core.validators.quantities.validate_non_negative_decimal],
            ),
        ),
        migrations.AddField(
            model_name="purchaseorderitem",
            name="management_reduction_reason",
            field=models.TextField(blank=True),
        ),
    ]
