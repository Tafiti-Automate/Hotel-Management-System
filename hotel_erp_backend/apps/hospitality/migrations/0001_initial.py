# Initial unified PMS/POS domain foundation.
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("departments", "0003_branch_hotel_profile_fields"),
        ("customers", "0003_initial"),
        ("inventory", "0031_supplier_price_quote_proposals"),
        ("employees", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="RoomType",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("code", models.CharField(max_length=20)),
                ("name", models.CharField(max_length=100)),
                ("capacity", models.PositiveSmallIntegerField(default=2)),
                ("is_active", models.BooleanField(default=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="room_types", to="departments.branch")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("branch__name", "name")},
        ),
        migrations.CreateModel(
            name="Room",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("number", models.CharField(max_length=20)),
                ("floor", models.CharField(blank=True, max_length=20)),
                ("status", models.CharField(choices=[("vacant", "Vacant"), ("occupied", "Occupied"), ("out_of_order", "Out of order")], default="vacant", max_length=20)),
                ("housekeeping_status", models.CharField(choices=[("clean", "Clean"), ("dirty", "Dirty"), ("inspected", "Inspected")], default="dirty", max_length=20)),
                ("is_active", models.BooleanField(default=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="hotel_rooms", to="departments.branch")),
                ("room_type", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="rooms", to="hospitality.roomtype")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("branch__name", "number")},
        ),
        migrations.CreateModel(
            name="Reservation",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("reference", models.CharField(max_length=60, unique=True)),
                ("arrival_date", models.DateField()),
                ("departure_date", models.DateField()),
                ("adults", models.PositiveSmallIntegerField(default=1)),
                ("children", models.PositiveSmallIntegerField(default=0)),
                ("status", models.CharField(choices=[("reserved", "Reserved"), ("checked_in", "Checked in"), ("checked_out", "Checked out"), ("cancelled", "Cancelled")], default="reserved", max_length=20)),
                ("notes", models.TextField(blank=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="hotel_reservations", to="departments.branch")),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="hotel_reservations", to="customers.customer")),
                ("room", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="reservations", to="hospitality.room")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-arrival_date", "reference")},
        ),
        migrations.CreateModel(
            name="POSCheck",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("reference", models.CharField(max_length=60, unique=True)),
                ("table_reference", models.CharField(blank=True, max_length=30)),
                ("status", models.CharField(choices=[("open", "Open"), ("settled", "Settled"), ("void", "Voided")], default="open", max_length=20)),
                ("notes", models.TextField(blank=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="pos_checks", to="departments.branch")),
                ("outlet", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="hospitality_pos_checks", to="inventory.storelocation")),
                ("reservation", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="pos_checks", to="hospitality.reservation")),
                ("opened_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="opened_pos_checks", to="employees.employee")),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-created_at",)},
        ),
        migrations.AddConstraint(
            model_name="roomtype",
            constraint=models.UniqueConstraint(fields=("branch", "code"), name="unique_room_type_per_property"),
        ),
        migrations.AddConstraint(
            model_name="room",
            constraint=models.UniqueConstraint(fields=("branch", "number"), name="unique_room_number_per_property"),
        ),
    ]
