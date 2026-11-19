import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("hospitality", "0002_property_guest_pos_order_line")]
    operations = [
        migrations.AddField(model_name="reservation", name="checked_in_at", field=models.DateTimeField(null=True, blank=True)),
        migrations.AddField(model_name="reservation", name="checked_in_by", field=models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.PROTECT, related_name="hotel_checkins", to="employees.employee")),
        migrations.AddField(model_name="posorderline", name="voided_at", field=models.DateTimeField(null=True, blank=True)),
        migrations.AddField(model_name="posorderline", name="voided_by", field=models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.PROTECT, related_name="voided_pos_lines", to="employees.employee")),
        migrations.AddField(model_name="posorderline", name="void_reason", field=models.CharField(max_length=250, blank=True)),
    ]
