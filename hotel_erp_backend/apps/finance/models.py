from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone

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


class SupplierInvoice(BaseModel):
    STATUS_DRAFT = "draft"
    STATUS_EXCEPTION = "exception"
    STATUS_MATCHED = "matched"
    STATUS_APPROVED = "approved"
    STATUS_PARTIALLY_PAID = "partially_paid"
    STATUS_PAID = "paid"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Draft"),
        (STATUS_EXCEPTION, "Match Exception"),
        (STATUS_MATCHED, "Three-way Matched"),
        (STATUS_APPROVED, "Approved for Payment"),
        (STATUS_PARTIALLY_PAID, "Partially Paid"),
        (STATUS_PAID, "Paid"),
        (STATUS_CANCELLED, "Cancelled"),
    )

    supplier = models.ForeignKey(
        "vendors.Supplier",
        on_delete=models.PROTECT,
        related_name="invoices",
    )
    purchase_order = models.ForeignKey(
        "procurement.PurchaseOrder",
        on_delete=models.PROTECT,
        related_name="supplier_invoices",
    )
    invoice_number = models.CharField(max_length=80)
    invoice_date = models.DateField(default=timezone.localdate)
    due_date = models.DateField()
    subtotal = models.DecimalField(
        max_digits=15, decimal_places=2, validators=[validate_non_negative_decimal]
    )
    tax_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    status = models.CharField(
        max_length=30, choices=STATUS_CHOICES, default=STATUS_DRAFT
    )
    quantity_variance = models.DecimalField(
        max_digits=15, decimal_places=2, default=Decimal("0.00")
    )
    amount_variance = models.DecimalField(
        max_digits=15, decimal_places=2, default=Decimal("0.00")
    )
    match_notes = models.TextField(blank=True)
    attachment = models.FileField(
        upload_to="supplier_invoices/", null=True, blank=True
    )

    class Meta(BaseModel.Meta):
        ordering = ("-invoice_date", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("supplier", "invoice_number"),
                name="unique_supplier_invoice_number",
            )
        ]

    @property
    def total_amount(self):
        return self.subtotal + self.tax_amount

    @property
    def paid_amount(self):
        return sum(
            (payment.amount for payment in self.payments.filter(status=SupplierPayment.STATUS_POSTED)),
            Decimal("0.00"),
        )

    @property
    def balance_due(self):
        return max(self.total_amount - self.paid_amount, Decimal("0.00"))

    def perform_three_way_match(self, amount_tolerance=Decimal("0.01")):
        accepted_value = Decimal("0.00")
        for receipt in self.purchase_order.goods_receipt_notes.all():
            for line in receipt.items.select_related("purchase_order_item"):
                if line.inventory_changes_applied:
                    accepted_value += line.inventory_post_quantity() * line.unit_cost

        self.amount_variance = self.subtotal - accepted_value
        if abs(self.amount_variance) <= amount_tolerance and accepted_value > 0:
            self.status = self.STATUS_MATCHED
            self.match_notes = "LPO, accepted GRN, and supplier invoice are within tolerance."
        else:
            self.status = self.STATUS_EXCEPTION
            self.match_notes = (
                f"Invoice subtotal differs from accepted receipt value by {self.amount_variance}."
            )
        self.save(
            update_fields=("amount_variance", "status", "match_notes", "updated_at")
        )

    def approve_for_payment(self):
        if self.status != self.STATUS_MATCHED:
            raise ValidationError("Only a successfully matched invoice can be approved.")
        self.status = self.STATUS_APPROVED
        self.save(update_fields=("status", "updated_at"))

    def __str__(self):
        return f"{self.supplier} invoice {self.invoice_number}"


class SupplierPayment(BaseModel):
    STATUS_DRAFT = "draft"
    STATUS_POSTED = "posted"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Draft"),
        (STATUS_POSTED, "Posted"),
        (STATUS_CANCELLED, "Cancelled"),
    )

    invoice = models.ForeignKey(
        SupplierInvoice,
        on_delete=models.PROTECT,
        related_name="payments",
    )
    amount = models.DecimalField(
        max_digits=15, decimal_places=2, validators=[validate_positive_decimal]
    )
    payment_date = models.DateField(default=timezone.localdate)
    payment_method = models.ForeignKey(
        PaymentMethod,
        on_delete=models.PROTECT,
        related_name="supplier_payments",
    )
    bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.PROTECT,
        related_name="supplier_payments",
        null=True,
        blank=True,
    )
    reference = models.CharField(max_length=100)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT
    )
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-payment_date", "-created_at")

    def post(self):
        if self.status != self.STATUS_DRAFT:
            raise ValidationError("Only draft supplier payments can be posted.")
        if self.invoice.status not in (
            SupplierInvoice.STATUS_APPROVED,
            SupplierInvoice.STATUS_PARTIALLY_PAID,
        ):
            raise ValidationError("The supplier invoice is not approved for payment.")
        if self.amount > self.invoice.balance_due:
            raise ValidationError("Payment cannot exceed the invoice balance.")

        with transaction.atomic():
            payment = SupplierPayment.objects.select_for_update().get(pk=self.pk)
            payment.status = self.STATUS_POSTED
            payment.save(update_fields=("status", "updated_at"))
            invoice = SupplierInvoice.objects.select_for_update().get(pk=self.invoice_id)
            invoice.status = (
                SupplierInvoice.STATUS_PAID
                if invoice.balance_due <= Decimal("0.00")
                else SupplierInvoice.STATUS_PARTIALLY_PAID
            )
            invoice.save(update_fields=("status", "updated_at"))
            self.status = payment.status
            self.invoice.status = invoice.status

    def __str__(self):
        return f"{self.reference}: {self.amount}"
