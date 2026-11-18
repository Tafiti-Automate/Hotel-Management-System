from decimal import Decimal
from django.db import migrations, models
from core.validators.quantities import validate_non_negative_decimal, validate_positive_decimal


class Migration(migrations.Migration):
    dependencies = [
        ("procurement", "0034_consolidated_purchase_order_sources"),
        ("inventory", "0034_four_decimal_quantities"),
    ]

    # Schema-only widening: no update queries or historical monetary revaluation.
    operations = [
        migrations.AlterField(
            model_name="requisitionitem",
            name="quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    validators=[validate_positive_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="requisitionitem",
            name="approved_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="requisitionitem",
            name="procurement_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    validators=[validate_positive_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="base_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    default=Decimal("0.00"),
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="procurement_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                    help_text="Quantity requested by Procurement before Finance review.",
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="procurement_base_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="purchasing_approved_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                    help_text="Purchasing Manager approved quantity; blank means the Procurement draft quantity was retained.",
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="purchasing_approved_base_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="finance_approved_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                    help_text="Finance-approved quantity; blank means Finance retained the Purchasing Manager quantity.",
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="finance_approved_base_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="management_approved_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                    help_text="General Manager approved quantity; blank means the Finance-approved quantity was retained.",
                ),
        ),
        migrations.AlterField(
            model_name="purchaseorderitem",
            name="management_approved_base_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    null=True,
                    blank=True,
                    validators=[validate_non_negative_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="goodsreceiptitem",
            name="quantity_received",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    validators=[validate_positive_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="goodsreceiptitem",
            name="base_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    default=Decimal("0.00"),
                ),
        ),
        migrations.AlterField(
            model_name="vendorquotationitem",
            name="quantity",
            field=models.DecimalField(max_digits=14, decimal_places=4, validators=[validate_positive_decimal]),
        ),
        migrations.AlterField(
            model_name="goodsinspectionitem",
            name="quantity_received",
            field=models.DecimalField(max_digits=14, decimal_places=4, validators=[validate_positive_decimal]),
        ),
        migrations.AlterField(
            model_name="goodsinspectionitem",
            name="quantity_accepted",
            field=models.DecimalField(max_digits=14, decimal_places=4, default=Decimal("0.00")),
        ),
        migrations.AlterField(
            model_name="goodsinspectionitem",
            name="quantity_rejected",
            field=models.DecimalField(max_digits=14, decimal_places=4, default=Decimal("0.00")),
        ),
        migrations.AlterField(
            model_name="supplierreturnitem",
            name="quantity",
            field=models.DecimalField(max_digits=14, decimal_places=4, validators=[validate_positive_decimal]),
        ),
        migrations.AlterField(
            model_name="supplierreturnitem",
            name="base_quantity",
            field=models.DecimalField(max_digits=14, decimal_places=4, default=Decimal("0.00")),
        ),
    ]
