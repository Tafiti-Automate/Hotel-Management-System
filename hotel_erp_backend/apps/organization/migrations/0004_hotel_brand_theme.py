from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("organization", "0001_initial")]
    operations = [
        migrations.AddField(model_name="hotel", name="brand_primary_color", field=models.CharField(blank=True, default="#1D4ED8", max_length=7)),
        migrations.AddField(model_name="hotel", name="brand_secondary_color", field=models.CharField(blank=True, default="#0F766E", max_length=7)),
        migrations.AddField(model_name="hotel", name="brand_accent_color", field=models.CharField(blank=True, default="#D97706", max_length=7)),
        migrations.AddField(model_name="hotel", name="use_logo_theme", field=models.BooleanField(default=True)),
    ]
