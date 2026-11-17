from django.db import migrations, models

import core.validators.quantities


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0031_supplier_price_quote_proposals"),
    ]

    operations = [
        migrations.AddField(
            model_name="stockledger", name="unit_cost_snapshot",
            field=models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True,
                validators=[core.validators.quantities.validate_non_negative_decimal]),
        ),
        migrations.AddField(
            model_name="stockledger", name="total_cost_snapshot",
            field=models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True,
                validators=[core.validators.quantities.validate_non_negative_decimal]),
        ),
        migrations.AddField(
            model_name="stockledger", name="wac_before",
            field=models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True,
                validators=[core.validators.quantities.validate_non_negative_decimal]),
        ),
        migrations.AddField(
            model_name="stockledger", name="wac_after",
            field=models.DecimalField(max_digits=15, decimal_places=4, null=True, blank=True,
                validators=[core.validators.quantities.validate_non_negative_decimal]),
        ),
    ]
