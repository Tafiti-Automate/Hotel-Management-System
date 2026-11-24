from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("inventory", "0039_month_end_operations")]
    operations = [
        migrations.AddField(
            model_name="stockledger",
            name="business_date",
            field=models.DateField(
                blank=True, db_index=True, editable=False, null=True,
                help_text="Explicit cutoff date for controlled month-end variance posting.",
            ),
        ),
    ]
