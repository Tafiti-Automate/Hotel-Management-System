# Generated for the initial Hotel Management System scaffold.
import uuid

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models

import core.validators.quantities


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("departments", "0001_initial"),
        ("employees", "0001_initial"),
        ("inventory", "0001_initial"),
        ("vendors", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PurchaseRequisition",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("submitted", "Submitted"),
                            ("hod_approved", "Head of Department Approved"),
                            ("finance_approved", "Finance Approved"),
                            ("director_approved", "Director Approved"),
                            ("rejected", "Rejected"),
                            ("cancelled", "Cancelled"),
                        ],
                        default="draft",
                        max_length=30,
                    ),
                ),
                ("reason", models.TextField()),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "department",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="purchase_requisitions",
                        to="departments.department",
                    ),
                ),
                (
                    "requester",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="purchase_requisitions",
                        to="employees.employee",
                    ),
                ),
            ],
            options={
                "ordering": ("-created_at",),
            },
        ),
        migrations.CreateModel(
            name="PurchaseOrder",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("po_number", models.CharField(max_length=50, unique=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("issued", "Issued"),
                            ("partially_received", "Partially Received"),
                            ("received", "Received"),
                            ("cancelled", "Cancelled"),
                        ],
                        default="draft",
                        max_length=30,
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "ordered_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="purchase_orders",
                        to="employees.employee",
                    ),
                ),
                (
                    "requisition",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="purchase_orders",
                        to="procurement.purchaserequisition",
                    ),
                ),
                (
                    "supplier",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="purchase_orders",
                        to="vendors.supplier",
                    ),
                ),
            ],
            options={
                "ordering": ("-created_at",),
            },
        ),
        migrations.CreateModel(
            name="GoodsReceiptNote",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("received_date", models.DateField(default=django.utils.timezone.localdate)),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "purchase_order",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="goods_receipt_notes",
                        to="procurement.purchaseorder",
                    ),
                ),
                (
                    "received_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="goods_receipt_notes",
                        to="employees.employee",
                    ),
                ),
            ],
            options={
                "ordering": ("-received_date", "-created_at"),
            },
        ),
        migrations.CreateModel(
            name="RequisitionItem",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "quantity",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=12,
                        validators=[core.validators.quantities.validate_positive_decimal],
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="requisition_items",
                        to="inventory.item",
                    ),
                ),
                (
                    "requisition",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="procurement.purchaserequisition",
                    ),
                ),
            ],
            options={
                "ordering": ("item__name",),
            },
        ),
        migrations.CreateModel(
            name="VendorQuotation",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "total_amount",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=15,
                        validators=[core.validators.quantities.validate_positive_decimal],
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_%(class)ss",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "requisition",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="vendor_quotations",
                        to="procurement.purchaserequisition",
                    ),
                ),
                (
                    "supplier",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="quotations",
                        to="vendors.supplier",
                    ),
                ),
            ],
            options={
                "ordering": ("total_amount",),
            },
        ),
        migrations.AddConstraint(
            model_name="requisitionitem",
            constraint=models.UniqueConstraint(
                fields=("requisition", "item"),
                name="unique_requisition_item",
            ),
        ),
        migrations.AddConstraint(
            model_name="vendorquotation",
            constraint=models.UniqueConstraint(
                fields=("requisition", "supplier"),
                name="unique_requisition_supplier_quotation",
            ),
        ),
    ]
