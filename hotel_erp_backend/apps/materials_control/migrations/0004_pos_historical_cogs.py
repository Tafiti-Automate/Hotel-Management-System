"""Freeze actual POS recipe COGS at posting to preserve historical profitability."""
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("materials_control", "0003_nested_sub_recipes")]
    operations = [
        migrations.AddField(
            model_name="possaleline", name="cost_of_goods_sold",
            field=models.DecimalField(
                max_digits=15, decimal_places=2, null=True, blank=True,
                help_text="Cost captured on first successful POS stock posting; null means unvalued.",
            ),
        ),
    ]
