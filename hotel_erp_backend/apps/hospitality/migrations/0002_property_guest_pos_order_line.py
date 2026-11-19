# Phase 1D: property-linked guests and snapshot-only draft POS lines.
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("hospitality", "0001_initial"),
        ("materials_control", "0007_four_decimal_quantities"),
    ]

    operations = [
        migrations.CreateModel(
            name="PropertyGuest",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="registered_guests", to="departments.branch")),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="property_registrations", to="customers.customer")),
                ("registered_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="registered_hotel_guests", to="employees.employee")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-created_at",)},
        ),
        migrations.CreateModel(
            name="POSOrderLine",
            fields=[
                ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("client_reference", models.CharField(max_length=80)),
                ("item_name_snapshot", models.CharField(max_length=180)),
                ("quantity", models.DecimalField(max_digits=14, decimal_places=4)),
                ("unit_price_snapshot", models.DecimalField(max_digits=15, decimal_places=2)),
                ("line_total", models.DecimalField(max_digits=17, decimal_places=2)),
                ("check", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="order_lines", to="hospitality.poscheck")),
                ("recipe", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="pos_draft_lines", to="materials_control.recipe")),
                ("entered_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="entered_pos_lines", to="employees.employee")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("created_at",)},
        ),
        migrations.AddConstraint(
            model_name="propertyguest",
            constraint=models.UniqueConstraint(fields=("branch", "customer"), name="unique_guest_property_registration"),
        ),
        migrations.AddConstraint(
            model_name="posorderline",
            constraint=models.UniqueConstraint(fields=("check", "client_reference"), name="unique_pos_line_client_reference"),
        ),
    ]
