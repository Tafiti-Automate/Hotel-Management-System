from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("materials_control", "0007_four_decimal_quantities"),
        ("departments", "0001_initial"),
    ]
    operations = [
        migrations.AddField(
            model_name="recipe",
            name="production_department",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name="production_recipes", to="departments.department"),
        ),
    ]
