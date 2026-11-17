"""Draft supplier quotes proposed by Purchasing and approved by Cost Control."""
from decimal import Decimal
import uuid
import django.utils.timezone
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
import core.validators.quantities

class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0030_supplier_price_discounts"),
        ("departments", "0001_initial"),
        ("vendors", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name="SupplierPriceQuoteProposal",
            fields=[
                ("id", models.UUIDField(primary_key=True, editable=False, default=uuid.uuid4, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("quotation_reference", models.CharField(max_length=100, blank=True)),
                ("currency", models.CharField(max_length=10, default="UGX")),
                ("unit_price", models.DecimalField(max_digits=15, decimal_places=2, validators=[core.validators.quantities.validate_positive_decimal])),
                ("discount_percent", models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"), validators=[core.validators.quantities.validate_non_negative_decimal])),
                ("fixed_order_quantity", models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("1.00"), validators=[core.validators.quantities.validate_positive_decimal])),
                ("valid_from", models.DateField(default=django.utils.timezone.localdate)),
                ("valid_to", models.DateField(null=True, blank=True)),
                ("is_preferred", models.BooleanField(default=False)),
                ("status", models.CharField(max_length=20, choices=[("draft","Draft"),("submitted","Submitted for Cost Control"),("approved","Approved"),("rejected","Rejected")], default="draft")),
                ("review_note", models.TextField(blank=True)),
                ("reviewed_at", models.DateTimeField(null=True, blank=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="departments.branch")),
                ("supplier", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="vendors.supplier")),
                ("item", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="inventory.item")),
                ("unit", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="inventory.unitofmeasure", null=True, blank=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL, null=True, blank=True, related_name="created_supplierpricequoteproposals")),
                ("reviewed_by", models.ForeignKey(on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL, null=True, blank=True, related_name="reviewed_supplier_quotes")),
            ],
            options={"ordering":("-created_at",)},
        )
    ]
