from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("inventory", "0035_stockcountitem_uncounted_physical")]

    operations = [
        migrations.AddField(
            model_name="item",
            name="vat_applicable",
            field=models.BooleanField(
                default=False,
                help_text="Whether this Article is VAT-taxable for future LPO lines; choose explicitly in the Article master.",
            ),
        ),
    ]
