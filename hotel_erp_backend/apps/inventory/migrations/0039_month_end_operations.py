from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0038_month_end_planning"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.AddField("monthendcycle", "status", models.CharField(default="planned", max_length=20)),
        migrations.AddField("monthendcycle", "approved_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="approved_month_end_cycles", to=settings.AUTH_USER_MODEL)),
        migrations.AddField("monthendcycle", "approved_at", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("monthendcycle", "approval_note", models.TextField(blank=True)),
        migrations.AddField("monthendcycle", "booked_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="booked_month_end_cycles", to=settings.AUTH_USER_MODEL)),
        migrations.AddField("monthendcycle", "booked_at", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("monthendinventory", "prepared_at", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("monthendinventory", "submitted_at", models.DateTimeField(blank=True, null=True)),
        migrations.AddField("monthendinventory", "count_snapshot", models.JSONField(blank=True, default=list)),
        migrations.AddField("monthendinventory", "stock_count", models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to="inventory.stockcount")),
    ]
