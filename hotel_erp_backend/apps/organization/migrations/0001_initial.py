# Manually added hotel/organization setup migration

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Hotel",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=150, unique=True)),
                ("legal_name", models.CharField(blank=True, max_length=200)),
                ("business_type", models.CharField(choices=[("single", "Single Hotel"), ("group", "Hotel Group / Multiple Branches")], default="single", help_text="Use Single Hotel for one property, or Hotel Group for many branches.", max_length=20)),
                ("registration_number", models.CharField(blank=True, max_length=100)),
                ("tax_identification_number", models.CharField(blank=True, max_length=100, verbose_name="TIN")),
                ("email", models.EmailField(blank=True, max_length=254)),
                ("phone", models.CharField(blank=True, max_length=30)),
                ("alternate_phone", models.CharField(blank=True, max_length=30)),
                ("website", models.URLField(blank=True)),
                ("logo", models.ImageField(blank=True, null=True, upload_to="hotel_logos/")),
                ("address", models.TextField(blank=True)),
                ("city", models.CharField(blank=True, max_length=100)),
                ("country", models.CharField(default="Uganda", max_length=100)),
                ("currency", models.CharField(default="UGX", max_length=10)),
                ("timezone", models.CharField(default="Africa/Kampala", max_length=50)),
                ("is_active", models.BooleanField(default=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ("name",),
                "abstract": False,
            },
        ),
    ]
