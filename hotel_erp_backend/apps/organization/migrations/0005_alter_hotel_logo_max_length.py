from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("organization", "0004_hotel_brand_theme")]

    operations = [
        migrations.AlterField(
            model_name="hotel",
            name="logo",
            field=models.ImageField(blank=True, max_length=500, null=True, upload_to="hotel_logos/"),
        ),
    ]
