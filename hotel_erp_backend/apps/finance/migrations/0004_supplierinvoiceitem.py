import uuid
from decimal import Decimal

import core.validators.quantities
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0003_supplierinvoice_supplierpayment_and_more"),
        ("inventory", "0016_supplieritemprice_currency_and_more"),
        ("procurement", "0015_purchaseorder_approval_control"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SupplierInvoiceItem",
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
                ("description", models.CharField(blank=True, max_length=255)),
                (
                    "quantity",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=12,
                        validators=[core.validators.quantities.validate_positive_decimal],
                    ),
                ),
                (
                    "base_quantity",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        max_digits=12,
                        validators=[core.validators.quantities.validate_non_negative_decimal],
                    ),
                ),
                (
                    "unit_price",
                    models.DecimalField(
                        decimal_places=2,
                        max_digits=15,
                        validators=[core.validators.quantities.validate_positive_decimal],
                    ),
                ),
                (
                    "tax_amount",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        max_digits=15,
                        validators=[core.validators.quantities.validate_non_negative_decimal],
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
                    "invoice",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="finance.supplierinvoice",
                    ),
                ),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="supplier_invoice_items",
                        to="inventory.item",
                    ),
                ),
                (
                    "purchase_order_item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="supplier_invoice_items",
                        to="procurement.purchaseorderitem",
                    ),
                ),
                (
                    "unit",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="supplier_invoice_items",
                        to="inventory.unitofmeasure",
                    ),
                ),
            ],
            options={
                "ordering": ("item__name",),
            },
        ),
        migrations.AddConstraint(
            model_name="supplierinvoiceitem",
            constraint=models.UniqueConstraint(
                fields=("invoice", "purchase_order_item", "unit"),
                name="unique_supplier_invoice_order_item_unit",
            ),
        ),
    ]
