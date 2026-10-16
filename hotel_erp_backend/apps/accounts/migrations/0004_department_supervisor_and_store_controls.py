from django.db import migrations


def sync_roles(apps, schema_editor):
    # Import the runtime role template after inventory/procurement permissions exist.
    from apps.accounts.role_templates import sync_client_roles

    sync_client_roles(reset_permissions=True)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0003_client_role_templates"),
        ("inventory", "0026_store_requisition_item_rejection_controls"),
        ("procurement", "0032_alter_purchaseorderitem_finance_approved_quantity"),
    ]

    operations = [
        migrations.RunPython(sync_roles, migrations.RunPython.noop),
    ]
