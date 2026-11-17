import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("finance", "0006_suppliercreditnote"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SupplierPaymentReconciliation",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("status", models.CharField(max_length=20, choices=[
                    ("pending", "Pending review"),
                    ("confirmed", "Confirmed against recorded bank entry"),
                ], default="pending")),
                ("review_note", models.TextField(blank=True)),
                ("confirmed_at", models.DateTimeField(blank=True, null=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_%(class)ss", to=settings.AUTH_USER_MODEL)),
                ("confirmed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="confirmed_supplier_payment_reconciliations", to=settings.AUTH_USER_MODEL)),
                ("payment", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="bank_reconciliation", to="finance.supplierpayment")),
                ("bank_transaction", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="supplier_payment_reconciliation", to="finance.banktransaction")),
            ],
            options={"ordering": ("-created_at",)},
        ),
    ]
