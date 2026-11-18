from decimal import Decimal
from django.db import migrations, models
from core.validators.quantities import validate_non_negative_decimal, validate_positive_decimal


class Migration(migrations.Migration):
    dependencies = [
        ("finance", "0007_supplierpaymentreconciliation"),
        ("procurement", "0035_four_decimal_quantities"),
    ]

    # Schema-only widening: no update queries or historical monetary revaluation.
    operations = [
        migrations.AlterField(
            model_name="supplierinvoice",
            name="quantity_variance",
            field=models.DecimalField(
                    max_digits=17, decimal_places=4, default=Decimal("0.00")
                ),
        ),
        migrations.AlterField(
            model_name="supplierinvoiceitem",
            name="quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    validators=[validate_positive_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="supplierinvoiceitem",
            name="base_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    default=Decimal("0.00"),
                    validators=[validate_non_negative_decimal],
                ),
        ),
    ]
