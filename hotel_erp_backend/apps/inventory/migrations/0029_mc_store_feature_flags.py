"""MC-style store setup flags used by enterprise administration."""
from django.db import migrations, models

def classify_transit(apps, schema_editor):
    Store = apps.get_model("inventory", "StoreLocation")
    Store.objects.filter(name="Virtual Transit Store — Internal Dispatch").update(
        is_virtual_transit=True, is_active=False, is_default=False
    )

class Migration(migrations.Migration):
    dependencies = [("inventory", "0028_store_fulfillment_wac_transit")]
    operations = [
        migrations.AddField(model_name="storelocation", name="is_virtual_transit", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="storelocation", name="enable_menu_planning", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="storelocation", name="permanent_inventory_pot_cos", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="storelocation", name="is_to_budget", field=models.BooleanField(default=False)),
        migrations.RunPython(classify_transit, migrations.RunPython.noop),
    ]
