from decimal import Decimal

from django.conf import settings
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
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="approved_supplier_invoices",
        null=True,
        blank=True,
    )
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
    def credited_amount(self):
        return sum(
            (credit.total_amount for credit in self.supplier_credits.filter(
                status=SupplierCreditNote.STATUS_POSTED
            )),
            Decimal("0.00"),
        )

    @property
    def balance_due(self):
        return max(
            self.total_amount - self.paid_amount - self.credited_amount,
            Decimal("0.00"),
        )

    def clean(self):
        super().clean()
        errors = {}
        if (
            self.purchase_order_id
            and self.supplier_id
            and self.purchase_order.supplier_id != self.supplier_id
        ):
            errors["supplier"] = "Invoice supplier must match the supplier on the LPO."
        if self.invoice_date and self.due_date and self.due_date < self.invoice_date:
            errors["due_date"] = "Invoice due date cannot be before the invoice date."
        if errors:
            raise ValidationError(errors)

    def perform_three_way_match(self, amount_tolerance=Decimal("0.01")):
        if self.status not in (self.STATUS_DRAFT, self.STATUS_EXCEPTION):
            raise ValidationError("Only draft or exception invoices may be matched. Approved and paid invoices are locked.")
        # Header-only matching has no per-line allocation. Once a header-only
        # invoice has reserved a receipt's value, it cannot be claimed again.
        # Similarly, detailed lines cannot safely allocate quantities against
        # a previously matched header-only invoice without a credit/reversal.
        locked_statuses = (
            self.STATUS_MATCHED, self.STATUS_APPROVED,
            self.STATUS_PARTIALLY_PAID, self.STATUS_PAID,
        )
        prior_matched = SupplierInvoice.objects.filter(
            purchase_order_id=self.purchase_order_id,
            status__in=locked_statuses,
        ).exclude(pk=self.pk)
        prior_header_only = prior_matched.filter(items__isnull=True).exists()
        invoice_lines = list(
            self.items.select_related(
                "purchase_order_item",
                "purchase_order_item__item",
                "unit",
            )
        )
        if invoice_lines:
            if prior_header_only:
                self.status = self.STATUS_EXCEPTION
                self.quantity_variance = Decimal("0.00")
                self.amount_variance = self.subtotal
                self.match_notes = (
                    "A previously matched header-only invoice already claims this "
                    "purchase order's received value. Reconcile or reverse it first."
                )
                self.save(update_fields=(
                    "status", "quantity_variance", "amount_variance",
                    "match_notes", "updated_at",
                ))
                return
            accepted_value = Decimal("0.00")
            calculated_subtotal = Decimal("0.00")
            quantity_variance = Decimal("0.00")
            line_exceptions = []
            for line in invoice_lines:
                invoiceable = line.invoiceable_base_quantity
                line_quantity_variance = max(
                    line.base_quantity - invoiceable,
                    Decimal("0.00"),
                )
                quantity_variance += line_quantity_variance
                expected_value = line.base_quantity * line.purchase_order_item.base_unit_cost
                accepted_value += expected_value
                calculated_subtotal += line.line_subtotal
                line_amount_variance = line.line_subtotal - expected_value
                if line_quantity_variance > Decimal("0.00"):
                    line_exceptions.append(
                        f"{line.item}: invoiced quantity exceeds the remaining accepted quantity "
                        f"by {line_quantity_variance}."
                    )
                if abs(line_amount_variance) > amount_tolerance:
                    line_exceptions.append(
                        f"{line.item}: invoiced value differs from the LPO value by "
                        f"{line_amount_variance}."
                    )

            header_variance = self.subtotal - calculated_subtotal
            self.quantity_variance = quantity_variance
            self.amount_variance = self.subtotal - accepted_value
            if abs(header_variance) > amount_tolerance:
                line_exceptions.append(
                    f"Invoice header subtotal differs from its line subtotal by {header_variance}."
                )

            if not line_exceptions and accepted_value > Decimal("0.00"):
                self.status = self.STATUS_MATCHED
                self.match_notes = (
                    "All invoice lines are within the accepted GRN quantity and LPO price tolerance."
                )
            else:
                self.status = self.STATUS_EXCEPTION
                self.match_notes = " ".join(line_exceptions) or (
                    "The invoice has no accepted quantity available for matching."
                )
            self.save(
                update_fields=(
                    "quantity_variance",
                    "amount_variance",
                    "status",
                    "match_notes",
                    "updated_at",
                )
            )
            return

        # A header-only invoice cannot be reconciled against receipts already
        # claimed by a matched line invoice or another header-only invoice.
        if prior_matched.exists():
            self.status = self.STATUS_EXCEPTION
            self.quantity_variance = Decimal("0.00")
            self.amount_variance = self.subtotal
            self.match_notes = (
                "Accepted receipts have already been allocated to a matched "
                "invoice for this purchase order. Use invoice lines for new "
                "partial receipts or resolve the previous invoice."
            )
            self.save(update_fields=(
                "status", "quantity_variance", "amount_variance",
                "match_notes", "updated_at",
            ))
            return
        accepted_value = Decimal("0.00")
        for receipt in self.purchase_order.goods_receipt_notes.all():
            for line in receipt.items.select_related("purchase_order_item"):
                if line.inventory_changes_applied:
                    accepted_value += line.inventory_post_quantity() * line.base_unit_cost

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

    def approve_for_payment(self, approved_by=None):
        if self.status != self.STATUS_MATCHED:
            raise ValidationError("Only a successfully matched invoice can be approved.")
        if approved_by and self.created_by_id == approved_by.id:
            raise ValidationError(
                "The employee who registered the invoice cannot approve it for payment."
            )
        self.status = self.STATUS_APPROVED
        self.approved_at = timezone.now()
        self.approved_by = approved_by or self.approved_by
        self.save(
            update_fields=("status", "approved_at", "approved_by", "updated_at")
        )

    def __str__(self):
        return f"{self.supplier} invoice {self.invoice_number}"


class SupplierInvoiceItem(BaseModel):
    """Line-level allocation used for partial and cumulative three-way matching."""

    invoice = models.ForeignKey(
        SupplierInvoice,
        on_delete=models.CASCADE,
        related_name="items",
    )
    purchase_order_item = models.ForeignKey(
        "procurement.PurchaseOrderItem",
        on_delete=models.PROTECT,
        related_name="supplier_invoice_items",
    )
    item = models.ForeignKey(
        "inventory.Item",
        on_delete=models.PROTECT,
        related_name="supplier_invoice_items",
    )
    description = models.CharField(max_length=255, blank=True)
    unit = models.ForeignKey(
        "inventory.UnitOfMeasure",
        on_delete=models.PROTECT,
        related_name="supplier_invoice_items",
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
        validators=[validate_non_negative_decimal],
    )
    unit_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        validators=[validate_positive_decimal],
    )
    tax_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("invoice", "purchase_order_item", "unit"),
                name="unique_supplier_invoice_order_item_unit",
            )
        ]
        ordering = ("item__name",)

    @property
    def line_subtotal(self):
        return (self.quantity or Decimal("0.00")) * (
            self.unit_price or Decimal("0.00")
        )

    @property
    def accepted_base_quantity(self):
        total = Decimal("0.00")
        for receipt_line in self.purchase_order_item.receipt_items.filter(
            inventory_changes_applied=True,
        ).select_related("goods_receipt"):
            total += receipt_line.inventory_post_quantity()
        return total

    @property
    def previously_matched_base_quantity(self):
        matched_statuses = (
            SupplierInvoice.STATUS_MATCHED,
            SupplierInvoice.STATUS_APPROVED,
            SupplierInvoice.STATUS_PARTIALLY_PAID,
            SupplierInvoice.STATUS_PAID,
        )
        result = SupplierInvoiceItem.objects.filter(
            purchase_order_item=self.purchase_order_item,
            invoice__status__in=matched_statuses,
        ).exclude(invoice=self.invoice).aggregate(total=models.Sum("base_quantity"))
        return result["total"] or Decimal("0.00")

    @property
    def invoiceable_base_quantity(self):
        return max(
            self.accepted_base_quantity - self.previously_matched_base_quantity,
            Decimal("0.00"),
        )

    def clean(self):
        super().clean()
        errors = {}
        if (
            self.invoice_id
            and self.purchase_order_item_id
            and self.purchase_order_item.purchase_order_id
            != self.invoice.purchase_order_id
        ):
            errors["purchase_order_item"] = (
                "Invoice line must reference an Article on the invoice's LPO."
            )
        if self.purchase_order_item_id and self.item_id:
            if self.purchase_order_item.item_id != self.item_id:
                errors["item"] = "Invoice Article must match the selected LPO line."
        if self.purchase_order_item_id and self.base_quantity:
            if self.base_quantity > self.purchase_order_item.base_quantity:
                errors["quantity"] = "Invoice quantity cannot exceed the LPO line quantity."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.invoice.status not in (
            SupplierInvoice.STATUS_DRAFT,
            SupplierInvoice.STATUS_EXCEPTION,
        ):
            raise ValidationError("Matched or approved invoice lines cannot be changed.")
        self.item = self.purchase_order_item.item
        if not self.unit_id:
            self.unit = self.purchase_order_item.unit
        self.base_quantity = self.item.quantity_in_base_units(
            self.quantity, self.unit
        ).quantize(Decimal("0.01"))
        if not self.description:
            self.description = self.item.name
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.invoice} - {self.item} x {self.quantity}"


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
    posted_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="posted_supplier_payments",
        null=True,
        blank=True,
    )

    class Meta(BaseModel.Meta):
        ordering = ("-payment_date", "-created_at")

    def post(self, posted_by=None):
        with transaction.atomic():
            payment = SupplierPayment.objects.select_for_update().select_related("invoice").get(pk=self.pk)
            invoice = SupplierInvoice.objects.select_for_update().get(pk=payment.invoice_id)
            if payment.status != self.STATUS_DRAFT:
                raise ValidationError("Only draft supplier payments can be posted.")
            if posted_by and payment.created_by_id == posted_by.id:
                raise ValidationError(
                    "The employee who prepared the supplier payment cannot post it."
                )
            if invoice.status not in (
                SupplierInvoice.STATUS_APPROVED,
                SupplierInvoice.STATUS_PARTIALLY_PAID,
            ):
                raise ValidationError("The supplier invoice is not approved for payment.")
            if payment.amount > invoice.balance_due:
                raise ValidationError("Payment cannot exceed the invoice balance.")

            payment.status = self.STATUS_POSTED
            payment.posted_at = timezone.now()
            payment.posted_by = posted_by or payment.posted_by
            payment.save(
                update_fields=("status", "posted_at", "posted_by", "updated_at")
            )
            invoice.refresh_from_db()
            invoice.status = (
                SupplierInvoice.STATUS_PAID
                if invoice.balance_due <= Decimal("0.00")
                else SupplierInvoice.STATUS_PARTIALLY_PAID
            )
            invoice.save(update_fields=("status", "updated_at"))
            self.status = payment.status
            self.posted_at = payment.posted_at
            self.posted_by = payment.posted_by
            self.invoice.status = invoice.status

    def __str__(self):
        return f"{self.reference}: {self.amount}"


class SupplierCreditNote(BaseModel):
    """Valued AP reversal linked to one acknowledged, posted supplier return.

    A supplier return alone only changes stock and records acknowledgement.
    Financial liability changes after an independent Finance approval followed
    by an Accounts Payable posting, both serialized against the invoice.
    """
    STATUS_DRAFT = "draft"
    STATUS_APPROVED = "approved"
    STATUS_POSTED = "posted"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Draft"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_POSTED, "Posted"),
    )

    invoice = models.ForeignKey(
        SupplierInvoice, on_delete=models.PROTECT, related_name="supplier_credits",
    )
    supplier_return = models.OneToOneField(
        "procurement.SupplierReturn", on_delete=models.PROTECT,
        related_name="financial_credit",
    )
    credit_date = models.DateField(default=timezone.localdate)
    subtotal = models.DecimalField(
        max_digits=15, decimal_places=2, validators=[validate_positive_decimal],
    )
    tax_amount = models.DecimalField(
        max_digits=15, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    note = models.TextField(blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="approved_supplier_credit_notes",
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="posted_supplier_credit_notes",
    )

    class Meta(BaseModel.Meta):
        ordering = ("-credit_date", "-created_at")

    @property
    def total_amount(self):
        return self.subtotal + self.tax_amount

    def _validate_evidence(self):
        record = self.supplier_return
        if not record.inventory_changes_applied or not record.supplier_acknowledged_at:
            raise ValidationError("A posted supplier return and acknowledgement are required.")
        if not record.credit_note_number.strip():
            raise ValidationError("Record the supplier's credit note reference first.")
        if (record.supplier_id != self.invoice.supplier_id or
                record.goods_receipt.purchase_order_id != self.invoice.purchase_order_id):
            raise ValidationError("Credit note, GRN, LPO and invoice supplier must agree.")
        if self.invoice.status not in (
            SupplierInvoice.STATUS_APPROVED,
            SupplierInvoice.STATUS_PARTIALLY_PAID,
            SupplierInvoice.STATUS_PAID,
        ):
            raise ValidationError("Only an approved supplier invoice may be credited.")
        # Do not derive credits from today's mutable catalogue prices. Value the
        # physical return at the actual LPO receipt rate, on the same GRN.
        received_lines = {
            line.item_id: line.base_unit_cost
            for line in record.goods_receipt.items.select_related("purchase_order_item")
            if line.inventory_changes_applied and line.store_id == record.store_id
        }
        return_value = Decimal("0.00")
        for line in record.items.all():
            if line.item_id not in received_lines:
                raise ValidationError("Returned article is not on the posted receiving GRN.")
            return_value += line.base_quantity * received_lines[line.item_id]
        if self.subtotal > return_value.quantize(Decimal("0.01")):
            raise ValidationError("Credit subtotal exceeds original returned-goods LPO value.")
        if self.tax_amount > self.invoice.tax_amount:
            raise ValidationError("Credit tax exceeds original invoice tax.")

    def clean(self):
        super().clean()
        if self.invoice_id and self.supplier_return_id:
            self._validate_evidence()

    def approve(self, *, actor):
        with transaction.atomic():
            credit = SupplierCreditNote.objects.select_for_update().get(pk=self.pk)
            if credit.status != self.STATUS_DRAFT:
                raise ValidationError("Only draft supplier credits can be approved.")
            if not actor or actor.pk == credit.created_by_id:
                raise ValidationError("A separate Financial Manager must approve the credit.")
            credit._validate_evidence()
            credit.status = self.STATUS_APPROVED
            credit.approved_at = timezone.now()
            credit.approved_by = actor
            credit.save(update_fields=("status", "approved_at", "approved_by", "updated_at"))
            self.status, self.approved_at, self.approved_by = (
                credit.status, credit.approved_at, credit.approved_by,
            )

    def post(self, *, actor):
        from apps.materials_control.models import FiscalPeriod
        with transaction.atomic():
            credit = SupplierCreditNote.objects.select_for_update().get(pk=self.pk)
            invoice = SupplierInvoice.objects.select_for_update().get(pk=credit.invoice_id)
            if credit.status != self.STATUS_APPROVED:
                raise ValidationError("Only approved supplier credits can be posted.")
            if not actor or actor.pk in (credit.created_by_id, credit.approved_by_id):
                raise ValidationError("A separate Accounts Payable poster is required.")
            credit._validate_evidence()
            branch = invoice.purchase_order.requisition.branch
            if FiscalPeriod.objects.filter(
                branch=branch, start_date__lte=credit.credit_date,
                end_date__gte=credit.credit_date, status=FiscalPeriod.STATUS_CLOSED,
            ).exists():
                raise ValidationError("Cannot post a supplier credit in a closed fiscal period.")
            if credit.total_amount > invoice.balance_due:
                raise ValidationError("Supplier credit exceeds the unpaid invoice balance.")
            credit.status = self.STATUS_POSTED
            credit.posted_at = timezone.now()
            credit.posted_by = actor
            credit.save(update_fields=("status", "posted_at", "posted_by", "updated_at"))
            invoice.refresh_from_db()
            if invoice.balance_due <= Decimal("0.00"):
                invoice.status = SupplierInvoice.STATUS_PAID
            elif invoice.paid_amount > 0:
                invoice.status = SupplierInvoice.STATUS_PARTIALLY_PAID
            else:
                invoice.status = SupplierInvoice.STATUS_APPROVED
            invoice.save(update_fields=("status", "updated_at"))
            self.status, self.posted_at, self.posted_by = (
                credit.status, credit.posted_at, credit.posted_by,
            )

    def __str__(self):
        return f"{self.supplier_return.credit_note_number} · {self.invoice.invoice_number}"
