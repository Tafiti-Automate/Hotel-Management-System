from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

from core.constants.choices import (
    CashFlowType,
    CustomerLedgerType,
    LedgerReferenceType,
    SaleStatus,
)
from core.mixins.models import BaseModel
from core.validators.quantities import validate_non_negative_decimal, validate_positive_decimal


class Sale(BaseModel):
    receipt_no = models.CharField(max_length=50, unique=True, blank=True)
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales",
    )
    store = models.ForeignKey(
        "inventory.StoreLocation",
        on_delete=models.PROTECT,
        related_name="sales",
        null=True,
        blank=True,
    )
    sale_date = models.DateField(default=timezone.localdate)
    status = models.CharField(
        max_length=20,
        choices=SaleStatus.choices,
        default=SaleStatus.DRAFT,
    )
    recorded_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales",
    )
    payment_method = models.ForeignKey(
        "finance.PaymentMethod",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales",
    )
    total_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    amount_paid = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    note = models.TextField(blank=True)
    inventory_changes_applied = models.BooleanField(default=False)
    is_cancelled = models.BooleanField(default=False)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cancelled_sales",
    )
    cancellation_reason = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-sale_date", "-created_at")

    def save(self, *args, **kwargs):
        if not self.receipt_no:
            prefix = f"SALE-{timezone.localdate().year}"
            last_sale = (
                Sale.objects.filter(receipt_no__startswith=prefix)
                .order_by("receipt_no")
                .last()
            )
            next_number = 1
            if last_sale and last_sale.receipt_no:
                try:
                    next_number = int(last_sale.receipt_no.split("-")[-1]) + 1
                except (IndexError, ValueError):
                    next_number = 1
            self.receipt_no = f"{prefix}-{next_number:05d}"
        self.balance = max(Decimal("0.00"), self.total_amount - self.amount_paid)
        if self.is_cancelled:
            self.status = SaleStatus.CANCELLED
            if not self.cancelled_at:
                self.cancelled_at = timezone.now()
        elif self.total_amount > Decimal("0.00") and self.balance == Decimal("0.00"):
            self.status = SaleStatus.PAID
        elif self.amount_paid > Decimal("0.00"):
            self.status = SaleStatus.PARTIALLY_PAID
        super().save(*args, **kwargs)

    def update_total_amount(self):
        self.total_amount = sum(item.line_total for item in self.items.all())
        self.save(update_fields=["total_amount", "balance", "status", "updated_at"])

    def complete_sale(self):
        if self.inventory_changes_applied:
            raise ValidationError("Sale has already been completed.")

        from apps.customers.models import Customer, CustomerLedger
        from apps.finance.models import CashFlow
        from apps.inventory.models import InventoryBalance, StockLedger

        with transaction.atomic():
            sale = (
                Sale.objects.select_for_update()
                .select_related("customer", "store", "payment_method")
                .get(pk=self.pk)
            )
            if sale.inventory_changes_applied:
                raise ValidationError("Sale has already been completed.")
            if sale.is_cancelled:
                raise ValidationError("Cancelled sales cannot be completed.")
            if not sale.store_id:
                raise ValidationError("Sale must have a store before completion.")

            sale_items = list(sale.items.select_related("item", "unit").all())
            if not sale_items:
                raise ValidationError("Sale must include at least one item.")

            sale.total_amount = sum(
                (item.line_total for item in sale_items),
                Decimal("0.00"),
            )
            sale.balance = max(Decimal("0.00"), sale.total_amount - sale.amount_paid)

            for sale_item in sale_items:
                balance = (
                    InventoryBalance.objects.select_for_update()
                    .filter(item=sale_item.item, store=sale.store)
                    .first()
                )
                available = balance.quantity_in_stock if balance else Decimal("0.00")
                if available < sale_item.base_quantity:
                    raise ValidationError(f"Insufficient stock for {sale_item.item}.")

            for sale_item in sale_items:
                balance = InventoryBalance.objects.select_for_update().get(
                    item=sale_item.item,
                    store=sale.store,
                )
                balance.quantity_in_stock -= sale_item.base_quantity
                balance.save(update_fields=["quantity_in_stock", "updated_at"])
                StockLedger.objects.create(
                    item=sale_item.item,
                    store=sale.store,
                    quantity_out=sale_item.base_quantity,
                    reference_type=LedgerReferenceType.SALE,
                    reference_id=sale.id,
                    note=f"Sale {sale.receipt_no}",
                    created_by=sale.created_by,
                )

            if sale.amount_paid > Decimal("0.00"):
                CashFlow.objects.create(
                    store=sale.store,
                    amount=sale.amount_paid,
                    transaction_type=CashFlowType.INFLOW,
                    reference=sale.receipt_no,
                    payment_method=sale.payment_method,
                    note=f"Sale {sale.receipt_no}",
                    created_by=sale.created_by,
                )

            if sale.customer_id:
                customer = Customer.objects.select_for_update().get(pk=sale.customer_id)
                balance_after_debit = customer.balance + sale.total_amount
                if sale.total_amount > Decimal("0.00"):
                    CustomerLedger.objects.create(
                        customer=customer,
                        transaction_type=CustomerLedgerType.INVOICE,
                        reference=sale.receipt_no,
                        debit=sale.total_amount,
                        balance_after=balance_after_debit,
                        note=f"Sale {sale.receipt_no}",
                        created_by=sale.created_by,
                    )
                balance_after_credit = max(
                    Decimal("0.00"),
                    balance_after_debit - sale.amount_paid,
                )
                if sale.amount_paid > Decimal("0.00"):
                    CustomerLedger.objects.create(
                        customer=customer,
                        transaction_type=CustomerLedgerType.PAYMENT,
                        reference=sale.receipt_no,
                        credit=sale.amount_paid,
                        balance_after=balance_after_credit,
                        note=f"Payment for sale {sale.receipt_no}",
                        created_by=sale.created_by,
                    )
                customer.balance = balance_after_credit
                customer.save(update_fields=["balance", "updated_at"])

            sale.inventory_changes_applied = True
            if sale.total_amount > Decimal("0.00") and sale.balance == Decimal("0.00"):
                sale.status = SaleStatus.PAID
            elif sale.amount_paid > Decimal("0.00"):
                sale.status = SaleStatus.PARTIALLY_PAID
            else:
                sale.status = SaleStatus.PENDING
            sale.save(
                update_fields=[
                    "total_amount",
                    "balance",
                    "status",
                    "inventory_changes_applied",
                    "updated_at",
                ]
            )

            self.total_amount = sale.total_amount
            self.balance = sale.balance
            self.status = sale.status
            self.inventory_changes_applied = True

    def __str__(self):
        return self.receipt_no


class SaleItem(BaseModel):
    sale = models.ForeignKey(
        Sale,
        on_delete=models.CASCADE,
        related_name="items",
    )
    item = models.ForeignKey(
        "inventory.Item",
        on_delete=models.PROTECT,
        related_name="sale_items",
    )
    unit = models.ForeignKey(
        "inventory.UnitOfMeasure",
        on_delete=models.PROTECT,
        related_name="sale_items",
        null=True,
        blank=True,
    )
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    base_quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_positive_decimal],
    )
    unit_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("sale", "item", "unit"),
                name="unique_sale_item_unit",
            )
        ]
        ordering = ("item__name",)

    @property
    def line_total(self):
        return (self.quantity or Decimal("0.00")) * (self.unit_price or Decimal("0.00"))

    def save(self, *args, **kwargs):
        if self.unit_id:
            from apps.inventory.models import ItemUnitPrice

            item_unit = ItemUnitPrice.objects.filter(item=self.item, unit=self.unit).first()
            self.base_quantity = self.quantity * item_unit.conversion_factor if item_unit else self.quantity
        else:
            self.base_quantity = self.quantity
        super().save(*args, **kwargs)
        self.sale.update_total_amount()

    def clean(self):
        super().clean()
        if self.sale_id and self.sale.store_id:
            from apps.inventory.models import InventoryBalance

            balance = InventoryBalance.objects.filter(
                item=self.item,
                store=self.sale.store,
            ).first()
            available = balance.quantity_in_stock if balance else Decimal("0.00")
            if available < self.base_quantity:
                raise ValidationError(f"Insufficient stock for {self.item}.")

    def __str__(self):
        return f"{self.sale} - {self.item} x {self.quantity}"
