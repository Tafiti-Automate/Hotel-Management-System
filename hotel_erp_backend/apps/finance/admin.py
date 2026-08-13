from django.contrib import admin

from apps.finance.models import (
    BankAccount,
    BankTransaction,
    CashFlow,
    DailyCashSummary,
    Expense,
    ExpenseCategory,
    PaymentMethod,
    SupplierInvoice,
    SupplierInvoiceItem,
    SupplierPayment,
)
from core.mixins.admin import CreatedByAdminMixin


@admin.register(PaymentMethod)
class PaymentMethodAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("name", "is_default", "is_active", "created_at")
    list_filter = ("is_default", "is_active")
    search_fields = ("name", "description")


@admin.register(CashFlow)
class CashFlowAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("date", "store", "transaction_type", "amount", "payment_method", "reference")
    list_filter = ("transaction_type", "payment_method", "store")
    list_select_related = ("store", "payment_method")
    autocomplete_fields = ("store", "payment_method")
    search_fields = ("reference", "note", "store__name")
    date_hierarchy = "date"


@admin.register(DailyCashSummary)
class DailyCashSummaryAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("date", "store", "opening_balance", "closing_balance", "calculated_balance", "discrepancy")
    list_filter = ("store",)
    list_select_related = ("store",)
    autocomplete_fields = ("store",)
    search_fields = ("store__name", "note")
    readonly_fields = ("net_flow", "discrepancy")
    date_hierarchy = "date"


@admin.register(BankAccount)
class BankAccountAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("bank_name", "name", "account_number", "opening_balance", "is_active")
    list_filter = ("is_active", "bank_name")
    search_fields = ("bank_name", "name", "account_number")


@admin.register(BankTransaction)
class BankTransactionAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("date", "bank_account", "store", "transaction_type", "amount", "reference")
    list_filter = ("transaction_type", "bank_account", "store")
    list_select_related = ("bank_account", "store", "related_cashflow")
    autocomplete_fields = ("bank_account", "store", "related_cashflow")
    search_fields = ("reference", "note", "bank_account__account_number", "store__name")
    date_hierarchy = "date"


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("name", "created_at")
    search_fields = ("name", "description")


@admin.register(Expense)
class ExpenseAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("date", "category", "store", "amount", "payment_method", "reference")
    list_filter = ("category", "store", "payment_method")
    list_select_related = ("category", "store", "payment_method", "related_purchase", "related_cashflow")
    autocomplete_fields = ("category", "store", "payment_method", "related_purchase", "related_cashflow")
    search_fields = ("reference", "description", "store__name", "category__name")
    date_hierarchy = "date"


class SupplierInvoiceItemInline(admin.TabularInline):
    model = SupplierInvoiceItem
    extra = 0
    autocomplete_fields = ("purchase_order_item", "unit")
    readonly_fields = ("item", "base_quantity", "line_subtotal")


@admin.register(SupplierInvoice)
class SupplierInvoiceAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "invoice_number", "supplier", "purchase_order", "invoice_date",
        "due_date", "total_amount", "status", "amount_variance",
    )
    list_filter = ("status", "supplier", "invoice_date", "due_date")
    list_select_related = ("supplier", "purchase_order")
    autocomplete_fields = ("supplier", "purchase_order")
    search_fields = ("invoice_number", "supplier__name", "purchase_order__po_number")
    readonly_fields = ("status", "quantity_variance", "amount_variance", "match_notes")
    inlines = (SupplierInvoiceItemInline,)
    date_hierarchy = "invoice_date"


@admin.register(SupplierPayment)
class SupplierPaymentAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "reference", "invoice", "amount", "payment_date", "payment_method", "status",
    )
    list_filter = ("status", "payment_method", "payment_date")
    list_select_related = ("invoice", "payment_method", "bank_account")
    autocomplete_fields = ("invoice", "payment_method", "bank_account")
    search_fields = ("reference", "invoice__invoice_number", "invoice__supplier__name")
    readonly_fields = ("status",)
    date_hierarchy = "payment_date"
