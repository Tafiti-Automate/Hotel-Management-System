from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("inventory", "0018_storerequisitionitem_storekeeper_comment")]

    operations = [
        migrations.AlterField(
            model_name="storerequisition",
            name="store",
            field=models.ForeignKey(
                blank=True,
                help_text="Destination store selected by the Store Keeper after Department Head approval.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="store_requisitions",
                to="inventory.storelocation",
            ),
        ),
    ]
