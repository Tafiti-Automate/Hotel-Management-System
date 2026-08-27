from django.db import migrations


def clear_legacy_preferred_flags(apps, schema_editor):
    SupplierItemPrice = apps.get_model("inventory", "SupplierItemPrice")
    SupplierItemPrice.objects.filter(is_preferred=True).update(is_preferred=False)


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0022_department_requisition_reference_and_hod_backfill"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="supplieritemprice",
            name="unique_preferred_supplier_per_item",
        ),
        migrations.AlterModelOptions(
            name="supplieritemprice",
            options={"ordering": ("item__name", "supplier__name")},
        ),
        migrations.RunPython(clear_legacy_preferred_flags, reverse_noop),
    ]
