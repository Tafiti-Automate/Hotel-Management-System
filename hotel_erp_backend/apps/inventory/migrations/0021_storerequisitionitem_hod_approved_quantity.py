from django.db import migrations, models
import core.validators.quantities


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0020_seed_tot_unit"),
    ]

    operations = [
        migrations.AddField(
            model_name="storerequisitionitem",
            name="hod_approved_quantity",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Quantity approved by the Department Head; requester quantity remains unchanged.",
                max_digits=12,
                null=True,
                validators=[core.validators.quantities.validate_non_negative_decimal],
            ),
        ),
    ]
