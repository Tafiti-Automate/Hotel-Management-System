from django.contrib import admin, messages

from apps.sales.models import Sale, SaleItem
from core.mixins.admin import CreatedByAdminMixin


class SaleItemInline(admin.TabularInline):
    model = SaleItem
    extra = 0
    autocomplete_fields = ("item", "unit")
    readonly_fields = ("base_quantity", "line_total")


@admin.register(Sale)
class SaleAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "receipt_no",
        "customer",
        "store",
        "sale_date",
        "status",
        "total_amount",
        "amount_paid",
        "balance",
        "inventory_changes_applied",
    )
    list_filter = ("status", "store", "payment_method", "is_cancelled", "inventory_changes_applied")
    list_select_related = ("customer", "store", "recorded_by", "payment_method", "cancelled_by")
    autocomplete_fields = ("customer", "store", "recorded_by", "payment_method", "cancelled_by")
    search_fields = ("receipt_no", "customer__name", "store__name", "note")
    readonly_fields = ("balance", "inventory_changes_applied")
    date_hierarchy = "sale_date"
    inlines = [SaleItemInline]
    actions = ("complete_selected_sales",)

    @admin.action(description="Complete selected sales")
    def complete_selected_sales(self, request, queryset):
        completed = 0
        for sale in queryset:
            try:
                sale.complete_sale()
                completed += 1
            except Exception as error:
                self.message_user(request, f"{sale}: {error}", level=messages.ERROR)
        if completed:
            self.message_user(request, f"Completed {completed} sale(s).")


@admin.register(SaleItem)
class SaleItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("sale", "item", "unit", "quantity", "base_quantity", "unit_price", "line_total")
    list_filter = ("unit",)
    list_select_related = ("sale", "item", "unit")
    autocomplete_fields = ("sale", "item", "unit")
    search_fields = ("sale__receipt_no", "item__name", "item__sku")
    readonly_fields = ("base_quantity", "line_total")
    date_hierarchy = "created_at"
