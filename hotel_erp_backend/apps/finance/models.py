from decimal import Decimal

from django.db import models

from core.constants.choices import BankTransactionType, CashFlowType
from core.mixins.models import BaseModel
from core.validators.quantities import validate_non_negative_decimal, validate_positive_decimal


class PaymentMethod(BaseModel):
    name = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)

    class Meta(BaseModel.Meta):
        ordering = ("name",)

    def __str__(self):
        return self.name


class CashFlow(BaseModel):
    store = models.ForeignKey(
        "inventory.StoreLocation",
        on_delete=models.PROTECT,
        related_name="cashflows",
        null=True,
        blank=True,
    )
    date = models.DateField(auto_now_add=True)
    amount = models.DecimalField(max_digits=15, decimal_places=2)
    transaction_type = models.CharField(max_length=20, choices=CashFlowType.choices)
    reference = models.CharField(max_length=100, blank=True)
    payment_method = models.ForeignKey(
        PaymentMethod,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cashflows",
    )
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-date", "-created_at")

    @property
    def is_inflow(self):
        return self.transaction_type == CashFlowType.INFLOW

    @property
    def is_outflow(self):
        return self.transaction_type == CashFlowType.OUTFLOW

    @property
    def abs_amount(self):
        return abs(self.amount)

    def __str__(self):
        return f"{self.transaction_type} {self.amount} on {self.date}"


class DailyCashSummary(BaseModel):
    store = models.ForeignKey(
        "inventory.StoreLocation",
        on_delete=models.PROTECT,
        related_name="daily_cash_summaries",
        null=True,
        blank=True,
    )
    date = models.DateField()
    opening_balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_non_negative_decimal],
    )
    closing_balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_non_negative_decimal],
    )
    calculated_balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_non_negative_decimal],
    )
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("store", "date"),
                name="unique_store_daily_cash_summary",
            )
        ]
        ordering = ("-date",)

    @property
    def net_flow(self):
        return self.closing_balance - self.opening_balance

    @property
    def discrepancy(self):
        return self.closing_balance - self.calculated_balance

    def __str__(self):
        return f"{self.store} {self.date}"


class BankAccount(BaseModel):
    name = models.CharField(max_length=100)
    account_number = models.CharField(max_length=50, unique=True)
    bank_name = models.CharField(max_length=100)
    opening_balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    is_active = models.BooleanField(default=True)
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("bank_name", "name")

    def __str__(self):
        return f"{self.bank_name} - {self.account_number}"


class BankTransaction(BaseModel):
    bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.PROTECT,
        related_name="transactions",
    )
    store = models.ForeignKey(
        "inventory.StoreLocation",
        on_delete=models.PROTECT,
        related_name="bank_transactions",
        null=True,
        blank=True,
    )
    date = models.DateField(auto_now_add=True)
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    transaction_type = models.CharField(max_length=20, choices=BankTransactionType.choices)
    reference = models.CharField(max_length=100, blank=True)
    related_cashflow = models.ForeignKey(
        CashFlow,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bank_transactions",
    )
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-date", "-created_at")

    def __str__(self):
        return f"{self.transaction_type} {self.amount} - {self.bank_account}"


class ExpenseCategory(BaseModel):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        verbose_name_plural = "expense categories"
        ordering = ("name",)

    def __str__(self):
        return self.name


class Expense(BaseModel):
    store = models.ForeignKey(
        "inventory.StoreLocation",
        on_delete=models.PROTECT,
        related_name="expenses",
        null=True,
        blank=True,
    )
    category = models.ForeignKey(
        ExpenseCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    date = models.DateField(auto_now_add=True)
    description = models.TextField(blank=True)
    reference = models.CharField(max_length=100, blank=True)
    related_purchase = models.ForeignKey(
        "procurement.PurchaseOrder",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    related_cashflow = models.ForeignKey(
        CashFlow,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    payment_method = models.ForeignKey(
        PaymentMethod,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    attachment = models.FileField(upload_to="expense_attachments/", null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-date", "-created_at")

    def __str__(self):
        return f"{self.category} - {self.amount}"
