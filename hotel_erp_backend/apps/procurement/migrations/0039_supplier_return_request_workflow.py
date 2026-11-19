import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import core.validators.quantities


class Migration(migrations.Migration):
    dependencies = [
        ("procurement", "0038_purchase_order_item_vat_snapshot"),
        ("inventory", "0037_supplier_return_quarantine"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SupplierReturnRequest",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("quantity", models.DecimalField(max_digits=14, decimal_places=4, validators=[core.validators.quantities.validate_positive_decimal])),
                ("source", models.CharField(max_length=25, choices=[("receiving_rejection", "Rejected at receiving"), ("stock_on_hand", "Already posted to store")])),
                ("status", models.CharField(max_length=20, default="pending", choices=[("pending", "Awaiting Cost Controller"), ("approved", "Approved for dispatch"), ("rejected", "Not approved"), ("dispatched", "Dispatched to supplier")])),
                ("reason", models.TextField()),
                ("evidence_note", models.TextField(blank=True)),
                ("review_note", models.TextField(blank=True)),
                ("reviewed_at", models.DateTimeField(null=True, blank=True)),
                ("dispatched_at", models.DateTimeField(null=True, blank=True)),
                ("supplier_acknowledged_at", models.DateTimeField(null=True, blank=True)),
                ("supplier_acknowledged_by", models.CharField(max_length=150, blank=True)),
                ("credit_note_number", models.CharField(max_length=100, blank=True)),
                ("goods_receipt", models.ForeignKey(to="procurement.goodsreceiptnote", on_delete=django.db.models.deletion.PROTECT, related_name="return_requests")),
                ("goods_receipt_item", models.ForeignKey(to="procurement.goodsreceiptitem", on_delete=django.db.models.deletion.PROTECT, related_name="return_requests")),
                ("store", models.ForeignKey(to="inventory.storelocation", on_delete=django.db.models.deletion.PROTECT, related_name="supplier_return_requests")),
                ("reported_by", models.ForeignKey(to="employees.employee", on_delete=django.db.models.deletion.PROTECT, related_name="reported_supplier_returns")),
                ("reviewed_by", models.ForeignKey(to="employees.employee", on_delete=django.db.models.deletion.PROTECT, null=True, blank=True, related_name="reviewed_supplier_returns")),
                ("dispatched_by", models.ForeignKey(to="employees.employee", on_delete=django.db.models.deletion.PROTECT, null=True, blank=True, related_name="dispatched_supplier_return_requests")),
                ("supplier_return", models.OneToOneField(to="procurement.supplierreturn", on_delete=django.db.models.deletion.PROTECT, null=True, blank=True, related_name="source_report")),
                ("created_by", models.ForeignKey(to=settings.AUTH_USER_MODEL, on_delete=django.db.models.deletion.SET_NULL, null=True, blank=True, related_name="created_supplierreturnrequests")),
            ],
            options={"ordering": ("-created_at",)},
        ),
    ]
