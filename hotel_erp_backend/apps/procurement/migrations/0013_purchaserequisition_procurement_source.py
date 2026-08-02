from django.db import migrations, models
import django.db.models.deletion


def classify_existing(apps, schema_editor):
    PR = apps.get_model('procurement', 'PurchaseRequisition')
    for row in PR.objects.all().iterator():
        notes = (row.control_notes or '').lower()
        row.procurement_source = 'store_shortage' if 'generated from department material request' in notes else 'manual'
        row.save(update_fields=['procurement_source'])


class Migration(migrations.Migration):
    dependencies = [
        ('inventory', '0014_store_requisition_procurement_link'),
        ('procurement', '0012_purchaserequisition_approved_at_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='purchaserequisition',
            name='procurement_source',
            field=models.CharField(choices=[('store_shortage', 'Store shortage'), ('manual', 'Manual procurement'), ('capital_asset', 'Capital asset'), ('emergency', 'Emergency purchase'), ('project', 'Project purchase'), ('service', 'Service / non-stock purchase')], db_index=True, default='manual', max_length=30),
        ),
        migrations.AddField(
            model_name='purchaserequisition',
            name='source_store_requisition',
            field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='generated_purchase_requisition', to='inventory.storerequisition'),
        ),
        migrations.RunPython(classify_existing, migrations.RunPython.noop),
    ]
