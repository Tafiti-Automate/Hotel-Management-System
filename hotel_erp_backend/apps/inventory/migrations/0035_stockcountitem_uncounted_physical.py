from django.db import migrations, models
from core.validators.quantities import validate_non_negative_decimal


class Migration(migrations.Migration):
    dependencies = [("inventory", "0034_four_decimal_quantities")]
    operations = [
        migrations.AlterField(
            model_name="stockcountitem",
            name="physical_quantity",
            field=models.DecimalField(
                max_digits=14, decimal_places=4,
                null=True, blank=True, default=None,
                validators=[validate_non_negative_decimal],
            ),
        ),
    ]
