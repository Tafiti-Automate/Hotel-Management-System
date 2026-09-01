from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0025_enforce_catalogue_item_groups"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="storerequisitionitem",
            name="rejection_stage",
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.AddField(
            model_name="storerequisitionitem",
            name="rejection_reason",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="storerequisitionitem",
            name="rejected_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="storerequisitionitem",
            name="rejected_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="rejected_store_requisition_items",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
