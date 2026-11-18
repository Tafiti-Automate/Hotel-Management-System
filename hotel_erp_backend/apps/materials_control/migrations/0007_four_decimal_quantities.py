from decimal import Decimal
from django.db import migrations, models
from core.validators.quantities import validate_non_negative_decimal, validate_positive_decimal


class Migration(migrations.Migration):
    dependencies = [
        ("materials_control", "0006_inventory_gl_preview_sources"),
        ("inventory", "0034_four_decimal_quantities"),
        ("sales", "0003_four_decimal_quantities"),
    ]

    # Schema-only widening: no update queries or historical monetary revaluation.
    operations = [
        migrations.AlterField(
            model_name="wasterecord",
            name="quantity",
            field=models.DecimalField(
                    max_digits=14, decimal_places=4, validators=[validate_positive_decimal]
                ),
        ),
        migrations.AlterField(
            model_name="wasterecord",
            name="base_quantity",
            field=models.DecimalField(
                    max_digits=14,
                    decimal_places=4,
                    default=Decimal("0.00"),
                    validators=[validate_non_negative_decimal],
                ),
        ),
        migrations.AlterField(
            model_name="recipe",
            name="yield_quantity",
            field=models.DecimalField(
                    max_digits=14, decimal_places=4, validators=[validate_positive_decimal]
                ),
        ),
        migrations.AlterField(
            model_name="possaleline",
            name="quantity",
            field=models.DecimalField(
                    max_digits=14, decimal_places=4, validators=[validate_positive_decimal]
                ),
        ),
    ]
