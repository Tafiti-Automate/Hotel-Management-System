"""Discount percentage on supplier contracts and immutable price snapshots."""
from decimal import Decimal
from django.db import migrations, models
import core.validators.quantities

class Migration(migrations.Migration):
    dependencies = [("inventory", "0029_mc_store_feature_flags")]
    operations = [
        migrations.AddField(
            model_name="supplieritemprice", name="discount_percent",
            field=models.DecimalField(
                max_digits=5, decimal_places=2, default=Decimal("0.00"),
                validators=[core.validators.quantities.validate_non_negative_decimal]
            ),
        ),
        migrations.AddField(
            model_name="supplieritempricehistory", name="discount_percent",
            field=models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00")),
        ),
    ]
