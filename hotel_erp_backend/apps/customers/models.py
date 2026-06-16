from decimal import Decimal

from django.db import models

from core.constants.choices import CustomerLedgerType
from core.mixins.models import BaseModel
from core.validators.quantities import validate_non_negative_decimal, validate_positive_decimal


class Customer(BaseModel):
    name = models.CharField(max_length=200)
    company = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    address = models.TextField(blank=True)
    balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("name",)

    def __str__(self):
        return self.name


class CustomerLedger(BaseModel):
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="ledger_entries",
    )
    transaction_type = models.CharField(max_length=20, choices=CustomerLedgerType.choices)
    reference = models.CharField(max_length=100, blank=True)
    debit = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    credit = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    balance_after = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.customer} {self.transaction_type} {self.reference}"


class Payment(BaseModel):
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="payments",
    )
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    payment_method = models.ForeignKey(
        "finance.PaymentMethod",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_payments",
    )
    received_by = models.ForeignKey(
        "employees.Employee",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_payments",
    )
    reference = models.CharField(max_length=100, blank=True)
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.customer} payment {self.amount}"


class PaymentAllocation(BaseModel):
    payment = models.ForeignKey(
        Payment,
        on_delete=models.CASCADE,
        related_name="allocations",
    )
    sale = models.ForeignKey(
        "sales.Sale",
        on_delete=models.CASCADE,
        related_name="payment_allocations",
    )
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("payment", "sale"),
                name="unique_payment_sale_allocation",
            )
        ]
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.payment} -> {self.sale}: {self.amount}"
