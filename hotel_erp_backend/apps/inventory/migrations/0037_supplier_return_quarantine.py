from decimal import Decimal
from django.db import migrations, models
from core.validators.quantities import validate_non_negative_decimal


class Migration(migrations.Migration):
    dependencies = [("inventory", "0036_item_vat_applicability")]

    operations = [
        migrations.AddField(
            model_name="inventorybalance",
            name="quantity_quarantined",
            field=models.DecimalField(
                max_digits=14, decimal_places=4, default=Decimal("0.0000"),
                validators=[validate_non_negative_decimal],
                help_text="Reported supplier-return stock withheld from usable inventory.",
            ),
        ),
    ]
