# Generated for the initial Hotel Management System scaffold.
import decimal
import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import core.validators.quantities


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("vendors", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Category",
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
                ("name", models.CharField(max_length=100, unique=True)),
                ("description", models.TextField(blank=True)),
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
            ],
            options={
                "verbose_name_plural": "categories",
                "ordering": ("name",),
            },
        ),
        migrations.CreateModel(
            name="Item",
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
                ("name", models.CharField(max_length=255)),
                ("sku", models.CharField(max_length=50, unique=True)),
                ("unit", models.CharField(max_length=50)),
                (
                    "reorder_level",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=12,
                        validators=[core.validators.quantities.validate_non_negative_decimal],
                    ),
                ),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="items",
                        to="inventory.category",
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
            ],
            options={
                "ordering": ("name",),
            },
        ),
        migrations.CreateModel(
            name="StockLedger",
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
                    "quantity_in",
                    models.DecimalField(
                        decimal_places=2,
                        default=decimal.Decimal("0.00"),
                        max_digits=12,
                        validators=[core.validators.quantities.validate_non_negative_decimal],
                    ),
                ),
                (
                    "quantity_out",
                    models.DecimalField(
                        decimal_places=2,
                        default=decimal.Decimal("0.00"),
                        max_digits=12,
                        validators=[core.validators.quantities.validate_non_negative_decimal],
                    ),
                ),
                (
                    "reference_type",
                    models.CharField(
                        choices=[
                            ("goods_receipt", "Goods Receipt"),
                            ("stock_adjustment", "Stock Adjustment"),
                            ("stock_issue", "Stock Issue"),
                            ("return_to_vendor", "Return to Vendor"),
                        ],
                        max_length=50,
                    ),
                ),
                ("reference_id", models.UUIDField()),
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
                        related_name="stock_movements",
                        to="inventory.item",
                    ),
                ),
            ],
            options={
                "ordering": ("-created_at",),
            },
        ),
        migrations.CreateModel(
            name="SupplierItemPrice",
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
                    "unit_price",
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
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="supplier_prices",
                        to="inventory.item",
                    ),
                ),
                (
                    "supplier",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="item_prices",
                        to="vendors.supplier",
                    ),
                ),
            ],
            options={
                "ordering": ("item__name", "supplier__name"),
            },
        ),
        migrations.AddConstraint(
            model_name="supplieritemprice",
            constraint=models.UniqueConstraint(
                fields=("supplier", "item"),
                name="unique_supplier_item_price",
            ),
        ),
    ]
