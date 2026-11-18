from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("procurement", "0036_daily_market_list_source")]

    operations = [
        migrations.AddField(
            model_name="goodsreceiptnote",
            name="blind_count_locked_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
    ]
