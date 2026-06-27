from django.contrib import admin, messages

from apps.inventory.models import (
    Category,
    InventoryBalance,
    InventoryBatch,
    ReorderRule,
    Item,
    ItemUnitPrice,
    StockAdjustment,
    StockAdjustmentItem,
    StockCount,
    StockCountItem,
    StockIssue,
    StockIssueItem,
    StockLedger,
    StockTransfer,
    StockTransferItem,
    StoreLocation,
    StoreRequisition,
    StoreRequisitionItem,
    StoreReturn,
    StoreReturnItem,
    SupplierItemPrice,
    UnitOfMeasure,
)
from core.mixins.admin import CreatedByAdminMixin


@admin.register(Category)
class CategoryAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("name", "code", "parent", "is_active", "created_at")
    list_filter = ("parent", "is_active")
    list_select_related = ("parent",)
    autocomplete_fields = ("parent",)
    search_fields = ("name", "code", "description", "parent__name")
    date_hierarchy = "created_at"


@admin.register(UnitOfMeasure)
class UnitOfMeasureAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("name", "abbreviation", "is_active", "created_at")
    list_filter = ("is_active",)
    search_fields = ("name", "abbreviation")
    date_hierarchy = "created_at"


@admin.register(Item)
class ItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("name", "sku", "category", "base_unit", "reorder_level", "is_active")
    list_filter = ("category", "unit", "base_unit", "is_active")
    list_select_related = ("category", "base_unit")
    autocomplete_fields = ("category", "base_unit")
    search_fields = ("name", "sku", "barcode", "brand", "category__name")
    date_hierarchy = "created_at"


@admin.register(ItemUnitPrice)
class ItemUnitPriceAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("item", "unit", "conversion_factor", "selling_price", "is_active")
    list_filter = ("unit", "is_active")
    list_select_related = ("item", "unit")
    autocomplete_fields = ("item", "unit")
    search_fields = ("item__name", "item__sku", "unit__name")
    date_hierarchy = "created_at"


@admin.register(StoreLocation)
class StoreLocationAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("name", "branch", "is_default", "is_active", "created_at")
    list_filter = ("branch", "is_default", "is_active")
    list_select_related = ("branch",)
    autocomplete_fields = ("branch",)
    search_fields = ("name", "address", "branch__name")
    date_hierarchy = "created_at"


@admin.register(InventoryBalance)
class InventoryBalanceAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("item", "store", "quantity_in_stock", "reorder_level", "is_below_reorder")
    list_filter = ("store",)
    list_select_related = ("item", "store")
    autocomplete_fields = ("item", "store")
    search_fields = ("item__name", "item__sku", "store__name")
    date_hierarchy = "last_updated"


@admin.register(SupplierItemPrice)
class SupplierItemPriceAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("supplier", "item", "unit", "unit_price", "lead_time_days", "is_active")
    list_filter = ("supplier", "item", "unit", "is_active")
    list_select_related = ("supplier", "item", "unit")
    autocomplete_fields = ("supplier", "item", "unit")
    search_fields = ("supplier__name", "item__name", "item__sku")
    date_hierarchy = "created_at"


@admin.register(StockLedger)
class StockLedgerAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "item",
        "store",
        "quantity_in",
        "quantity_out",
        "reference_type",
        "reference_id",
        "created_at",
    )
    list_filter = ("reference_type", "item", "store")
    list_select_related = ("item", "store")
    autocomplete_fields = ("item", "store")
    search_fields = ("item__name", "item__sku", "store__name", "reference_id")
    readonly_fields = ("net_quantity",)
    date_hierarchy = "created_at"


@admin.register(InventoryBatch)
class InventoryBatchAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("item", "store", "remaining_quantity", "quantity", "unit_cost", "expiry_date")
    list_filter = ("store", "expiry_date")
    list_select_related = ("item", "store", "purchase_order_item")
    autocomplete_fields = ("item", "store", "purchase_order_item")
    search_fields = ("item__name", "item__sku", "store__name")
    date_hierarchy = "received_date"


class StockTransferItemInline(admin.TabularInline):
    model = StockTransferItem
    extra = 0
    autocomplete_fields = ("item", "unit")
    readonly_fields = ("base_quantity",)


@admin.register(StockTransfer)
class StockTransferAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "from_store",
        "to_store",
        "status",
        "required_date",
        "inventory_changes_applied",
        "created_at",
    )
    list_filter = ("status", "from_store", "to_store", "inventory_changes_applied")
    list_select_related = ("from_store", "to_store", "requested_by", "approved_by")
    autocomplete_fields = ("from_store", "to_store", "requested_by", "approved_by")
    search_fields = ("from_store__name", "to_store__name", "note")
    date_hierarchy = "created_at"
    inlines = [StockTransferItemInline]
    actions = ("apply_selected_transfers",)

    @admin.action(description="Apply selected stock transfers")
    def apply_selected_transfers(self, request, queryset):
        applied = 0
        for transfer in queryset:
            try:
                transfer.apply_inventory_changes()
                applied += 1
            except Exception as error:
                self.message_user(request, f"{transfer}: {error}", level=messages.ERROR)
        if applied:
            self.message_user(request, f"Applied {applied} stock transfer(s).")


@admin.register(StockTransferItem)
class StockTransferItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("stock_transfer", "item", "unit", "quantity", "base_quantity")
    list_filter = ("unit",)
    list_select_related = ("stock_transfer", "item", "unit")
    autocomplete_fields = ("stock_transfer", "item", "unit")
    search_fields = ("item__name", "item__sku")
    date_hierarchy = "created_at"


class StockAdjustmentItemInline(admin.TabularInline):
    model = StockAdjustmentItem
    extra = 0
    autocomplete_fields = ("item", "unit")


@admin.register(StockAdjustment)
class StockAdjustmentAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("reference", "store", "status", "approved_by", "created_at")
    list_filter = ("status", "store")
    list_select_related = ("store", "approved_by")
    autocomplete_fields = ("store", "approved_by")
    search_fields = ("reference", "reason", "note", "store__name")
    date_hierarchy = "created_at"
    inlines = [StockAdjustmentItemInline]
    actions = ("apply_selected_adjustments",)

    @admin.action(description="Apply selected stock adjustments")
    def apply_selected_adjustments(self, request, queryset):
        applied = 0
        for adjustment in queryset:
            try:
                adjustment.apply()
                applied += 1
            except Exception as error:
                self.message_user(request, f"{adjustment}: {error}", level=messages.ERROR)
        if applied:
            self.message_user(request, f"Applied {applied} stock adjustment(s).")


@admin.register(StockAdjustmentItem)
class StockAdjustmentItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("stock_adjustment", "item", "unit", "quantity_change", "unit_cost")
    list_filter = ("unit",)
    list_select_related = ("stock_adjustment", "item", "unit")
    autocomplete_fields = ("stock_adjustment", "item", "unit")
    search_fields = ("item__name", "item__sku", "reason")
    date_hierarchy = "created_at"


class StoreRequisitionItemInline(admin.TabularInline):
    model = StoreRequisitionItem
    extra = 0
    autocomplete_fields = ("item", "unit")
    readonly_fields = ("base_quantity_requested", "quantity_issued")


@admin.register(ReorderRule)
class ReorderRuleAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("item", "store", "minimum_level", "reorder_quantity", "preferred_supplier", "is_active")
    list_filter = ("store", "preferred_supplier", "is_active")
    list_select_related = ("item", "store", "preferred_supplier")
    autocomplete_fields = ("item", "store", "preferred_supplier")
    search_fields = ("item__name", "item__sku", "store__name", "preferred_supplier__name")


@admin.register(StoreRequisition)
class StoreRequisitionAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("requisition_no", "department", "store", "requested_by", "status", "required_date", "created_at")
    list_filter = ("status", "department", "store")
    list_select_related = ("department", "store", "requested_by", "approved_by")
    autocomplete_fields = ("department", "store", "requested_by", "approved_by")
    search_fields = ("requisition_no", "purpose", "department__name", "store__name")
    readonly_fields = ("requisition_no", "approved_at", "issued_at")
    inlines = [StoreRequisitionItemInline]
    actions = ("submit_selected_requisitions", "approve_selected_requisitions")

    @admin.action(description="Submit selected store requisitions")
    def submit_selected_requisitions(self, request, queryset):
        submitted = 0
        for requisition in queryset:
            try:
                requisition.submit()
                submitted += 1
            except Exception as error:
                self.message_user(request, f"{requisition}: {error}", level=messages.ERROR)
        if submitted:
            self.message_user(request, f"Submitted {submitted} store requisition(s).")

    @admin.action(description="Approve selected store requisitions")
    def approve_selected_requisitions(self, request, queryset):
        approved = 0
        employee = getattr(request.user, "employee_profile", None)
        for requisition in queryset:
            try:
                requisition.approve(approved_by=employee)
                approved += 1
            except Exception as error:
                self.message_user(request, f"{requisition}: {error}", level=messages.ERROR)
        if approved:
            self.message_user(request, f"Approved {approved} store requisition(s).")


@admin.register(StoreRequisitionItem)
class StoreRequisitionItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("requisition", "item", "unit", "quantity_requested", "quantity_approved", "quantity_issued")
    list_select_related = ("requisition", "item", "unit")
    autocomplete_fields = ("requisition", "item", "unit")
    search_fields = ("requisition__requisition_no", "item__name", "item__sku")


class StockIssueItemInline(admin.TabularInline):
    model = StockIssueItem
    extra = 0
    autocomplete_fields = ("requisition_item", "unit")
    readonly_fields = ("item", "base_quantity")


@admin.register(StockIssue)
class StockIssueAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("issue_no", "requisition", "store", "issued_by", "issue_date", "inventory_changes_applied")
    list_filter = ("store", "inventory_changes_applied")
    list_select_related = ("requisition", "store", "issued_by", "received_by")
    autocomplete_fields = ("requisition", "store", "issued_by", "received_by")
    search_fields = ("issue_no", "requisition__requisition_no", "store__name")
    readonly_fields = ("issue_no", "inventory_changes_applied")
    inlines = [StockIssueItemInline]
    actions = ("apply_selected_stock_issues",)

    @admin.action(description="Apply selected stock issues")
    def apply_selected_stock_issues(self, request, queryset):
        applied = 0
        for issue in queryset:
            try:
                issue.apply_inventory_changes()
                applied += 1
            except Exception as error:
                self.message_user(request, f"{issue}: {error}", level=messages.ERROR)
        if applied:
            self.message_user(request, f"Applied {applied} stock issue(s).")


@admin.register(StockIssueItem)
class StockIssueItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("issue", "item", "unit", "quantity", "base_quantity")
    list_select_related = ("issue", "requisition_item", "item", "unit")
    autocomplete_fields = ("issue", "requisition_item", "unit")
    search_fields = ("issue__issue_no", "item__name", "item__sku")


class StoreReturnItemInline(admin.TabularInline):
    model = StoreReturnItem
    extra = 0
    autocomplete_fields = ("item", "unit")
    readonly_fields = ("base_quantity",)


@admin.register(StoreReturn)
class StoreReturnAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("return_no", "department", "store", "received_by", "return_date", "inventory_changes_applied")
    list_filter = ("department", "store", "inventory_changes_applied")
    list_select_related = ("department", "store", "received_by")
    autocomplete_fields = ("department", "store", "received_by")
    search_fields = ("return_no", "department__name", "store__name", "reason")
    readonly_fields = ("return_no", "inventory_changes_applied")
    inlines = [StoreReturnItemInline]
    actions = ("apply_selected_store_returns",)

    @admin.action(description="Apply selected department returns")
    def apply_selected_store_returns(self, request, queryset):
        applied = 0
        for store_return in queryset:
            try:
                store_return.apply_inventory_changes()
                applied += 1
            except Exception as error:
                self.message_user(request, f"{store_return}: {error}", level=messages.ERROR)
        if applied:
            self.message_user(request, f"Applied {applied} department return(s).")


@admin.register(StoreReturnItem)
class StoreReturnItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("store_return", "item", "unit", "quantity", "base_quantity")
    list_select_related = ("store_return", "item", "unit")
    autocomplete_fields = ("store_return", "item", "unit")
    search_fields = ("store_return__return_no", "item__name", "item__sku")


class StockCountItemInline(admin.TabularInline):
    model = StockCountItem
    extra = 0
    autocomplete_fields = ("item",)
    readonly_fields = ("variance",)


@admin.register(StockCount)
class StockCountAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("count_no", "store", "conducted_by", "approved_by", "status", "count_date", "inventory_changes_applied")
    list_filter = ("status", "store", "inventory_changes_applied")
    list_select_related = ("store", "conducted_by", "approved_by")
    autocomplete_fields = ("store", "conducted_by", "approved_by")
    search_fields = ("count_no", "store__name", "note")
    readonly_fields = ("count_no", "inventory_changes_applied")
    inlines = [StockCountItemInline]
    actions = (
        "populate_selected_counts",
        "submit_selected_counts",
        "approve_selected_counts",
        "apply_selected_counts",
    )

    @admin.action(description="Populate selected counts from system balances")
    def populate_selected_counts(self, request, queryset):
        populated = 0
        for stock_count in queryset:
            try:
                stock_count.populate_from_system_balances()
                populated += 1
            except Exception as error:
                self.message_user(request, f"{stock_count}: {error}", level=messages.ERROR)
        if populated:
            self.message_user(request, f"Populated {populated} stock count(s).")

    @admin.action(description="Submit selected stock counts")
    def submit_selected_counts(self, request, queryset):
        submitted = 0
        for stock_count in queryset:
            try:
                stock_count.submit()
                submitted += 1
            except Exception as error:
                self.message_user(request, f"{stock_count}: {error}", level=messages.ERROR)
        if submitted:
            self.message_user(request, f"Submitted {submitted} stock count(s).")

    @admin.action(description="Approve selected stock counts")
    def approve_selected_counts(self, request, queryset):
        approved = 0
        employee = getattr(request.user, "employee_profile", None)
        for stock_count in queryset:
            try:
                stock_count.approve(approved_by=employee)
                approved += 1
            except Exception as error:
                self.message_user(request, f"{stock_count}: {error}", level=messages.ERROR)
        if approved:
            self.message_user(request, f"Approved {approved} stock count(s).")

    @admin.action(description="Apply selected approved stock counts")
    def apply_selected_counts(self, request, queryset):
        applied = 0
        for stock_count in queryset:
            try:
                stock_count.apply_variances()
                applied += 1
            except Exception as error:
                self.message_user(request, f"{stock_count}: {error}", level=messages.ERROR)
        if applied:
            self.message_user(request, f"Applied {applied} stock count(s).")


@admin.register(StockCountItem)
class StockCountItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("stock_count", "item", "system_quantity", "physical_quantity", "variance")
    list_select_related = ("stock_count", "item")
    autocomplete_fields = ("stock_count", "item")
    search_fields = ("stock_count__count_no", "item__name", "item__sku")
