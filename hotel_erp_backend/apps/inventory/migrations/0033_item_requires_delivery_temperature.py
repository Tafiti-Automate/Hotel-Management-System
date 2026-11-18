from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0032_stockledger_valuation_snapshots"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="requires_delivery_temperature",
            field=models.BooleanField(
                default=False,
                help_text="Receiving must record the observed HACCP delivery temperature for this Article.",
            ),
        ),
    ]
