from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("inventory", "0040_stockledger_business_date")]
    operations = [
        migrations.AddField(
            model_name="monthendinventory",
            name="department_cost_snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
