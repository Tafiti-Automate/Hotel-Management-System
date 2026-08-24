from django.db import migrations


def seed_tot_unit(apps, schema_editor):
    UnitOfMeasure = apps.get_model("inventory", "UnitOfMeasure")
    UnitOfMeasure.objects.get_or_create(
        name="Tot",
        defaults={"abbreviation": "tot", "is_active": True},
    )


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0019_storerequisition_store_optional"),
    ]

    operations = [
        migrations.RunPython(seed_tot_unit, migrations.RunPython.noop),
    ]
