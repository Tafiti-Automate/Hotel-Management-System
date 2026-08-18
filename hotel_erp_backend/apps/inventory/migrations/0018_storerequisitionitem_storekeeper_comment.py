from django.db import migrations, models


def ensure_department_head_role(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.get_or_create(name="Department Head")


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0017_supplieritemprice_quotation_reference_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="storerequisitionitem",
            name="storekeeper_comment",
            field=models.TextField(blank=True),
        ),
        migrations.RunPython(
            ensure_department_head_role,
            migrations.RunPython.noop,
        ),
    ]
