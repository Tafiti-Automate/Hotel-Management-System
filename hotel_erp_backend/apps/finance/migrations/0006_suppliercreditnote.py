import uuid
from decimal import Decimal

import core.validators.quantities
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("finance", "0005_supplier_finance_maker_checker"),
        ("procurement", "0034_consolidated_purchase_order_sources"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SupplierCreditNote",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("credit_date", models.DateField(default=django.utils.timezone.localdate)),
                ("subtotal", models.DecimalField(max_digits=15, decimal_places=2, validators=[core.validators.quantities.validate_positive_decimal])),
                ("tax_amount", models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"), validators=[core.validators.quantities.validate_non_negative_decimal])),
                ("status", models.CharField(max_length=20, default="draft", choices=[("draft", "Draft"), ("approved", "Approved"), ("posted", "Posted")])),
                ("note", models.TextField(blank=True)),
                ("approved_at", models.DateTimeField(null=True, blank=True)),
                ("posted_at", models.DateTimeField(null=True, blank=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
                ("approved_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="approved_supplier_credit_notes", to=settings.AUTH_USER_MODEL)),
                ("posted_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="posted_supplier_credit_notes", to=settings.AUTH_USER_MODEL)),
                ("invoice", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="supplier_credits", to="finance.supplierinvoice")),
                ("supplier_return", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="financial_credit", to="procurement.supplierreturn")),
            ],
            options={"ordering": ("-credit_date", "-created_at")},
        ),
    ]
