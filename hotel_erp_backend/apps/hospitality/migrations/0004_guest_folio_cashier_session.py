import django.db.models.deletion
import decimal
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("hospitality", "0003_reservation_checkin_pos_void")]

    operations = [
        migrations.CreateModel(
            name="GuestFolio",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("status", models.CharField(max_length=16, choices=[("open", "Open"), ("closed", "Closed")], default="open")),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="guest_folios", to="departments.branch")),
                ("reservation", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="folio", to="hospitality.reservation")),
                ("opened_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="opened_guest_folios", to="employees.employee")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-created_at",)},
        ),
        migrations.CreateModel(
            name="CashierSession",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("opened_at", models.DateTimeField()),
                ("opening_float", models.DecimalField(max_digits=15, decimal_places=2, default=decimal.Decimal("0"))),
                ("status", models.CharField(max_length=16, choices=[("open", "Open"), ("closed", "Closed")], default="open")),
                ("closed_at", models.DateTimeField(null=True, blank=True)),
                ("closing_count", models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)),
                ("note", models.CharField(max_length=250, blank=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="cashier_sessions", to="departments.branch")),
                ("outlet", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="cashier_sessions", to="inventory.storelocation")),
                ("cashier", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="cashier_sessions", to="employees.employee")),
                ("closed_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="closed_cashier_sessions", to="employees.employee", null=True, blank=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-opened_at",)},
        ),
        migrations.AddConstraint(
            model_name="cashiersession",
            constraint=models.UniqueConstraint(
                fields=("cashier",), condition=models.Q(status="open"),
                name="unique_open_cashier_session_per_employee",
            ),
        ),
    ]
