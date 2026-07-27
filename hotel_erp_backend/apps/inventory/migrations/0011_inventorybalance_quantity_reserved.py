from decimal import Decimal

from django.db import migrations, models
import core.validators.quantities


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0010_alter_supplieritemprice_options_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="inventorybalance",
            name="quantity_reserved",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0.00"),
                max_digits=12,
                validators=[core.validators.quantities.validate_non_negative_decimal],
            ),
        ),
    ]
