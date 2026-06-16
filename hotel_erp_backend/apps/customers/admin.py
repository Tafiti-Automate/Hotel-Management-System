from django.contrib import admin

from apps.customers.models import Customer, CustomerLedger, Payment, PaymentAllocation
from core.mixins.admin import CreatedByAdminMixin


@admin.register(Customer)
class CustomerAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("name", "company", "phone", "email", "balance", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "company", "phone", "email")
    date_hierarchy = "created_at"


@admin.register(CustomerLedger)
class CustomerLedgerAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("customer", "transaction_type", "reference", "debit", "credit", "balance_after", "created_at")
    list_filter = ("transaction_type", "customer")
    list_select_related = ("customer",)
    autocomplete_fields = ("customer",)
    search_fields = ("customer__name", "reference", "note")
    date_hierarchy = "created_at"


@admin.register(Payment)
class PaymentAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("customer", "amount", "payment_method", "received_by", "reference", "created_at")
    list_filter = ("payment_method", "received_by")
    list_select_related = ("customer", "payment_method", "received_by")
    autocomplete_fields = ("customer", "payment_method", "received_by")
    search_fields = ("customer__name", "reference", "note")
    date_hierarchy = "created_at"


@admin.register(PaymentAllocation)
class PaymentAllocationAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("payment", "sale", "amount", "created_at")
    list_select_related = ("payment", "sale")
    autocomplete_fields = ("payment", "sale")
    search_fields = ("payment__customer__name", "sale__receipt_no")
    date_hierarchy = "created_at"
