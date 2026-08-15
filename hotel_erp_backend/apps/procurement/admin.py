from django.contrib import admin, messages

from apps.approvals.models import ApprovalWorkflow
from apps.procurement.models import (
    GoodsInspection,
    GoodsInspectionItem,
    GoodsReceiptItem,
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseOrderActivity,
    PurchaseOrderItem,
    PurchaseOrderPrintRecord,
    PurchaseRequisition,
    RequisitionHistory,
    RequisitionItem,
    RequisitionSequence,
    ProcurementDocumentSequence,
    SupplierReturn,
    SupplierReturnItem,
    VendorQuotation,
    VendorQuotationItem,
)
from core.mixins.admin import CreatedByAdminMixin


class RequisitionItemInline(admin.TabularInline):
    model = RequisitionItem
    extra = 0
    autocomplete_fields = ("item", "unit")
    readonly_fields = (
        "description",
        "approved_quantity",
        "ordered_quantity",
        "received_quantity",
    )


class ApprovalWorkflowInline(admin.TabularInline):
    model = ApprovalWorkflow
    extra = 0
    autocomplete_fields = ("approver",)
    readonly_fields = ("status",)


class PurchaseOrderItemInline(admin.TabularInline):
    model = PurchaseOrderItem
    extra = 0
    autocomplete_fields = ("item", "unit")
    readonly_fields = ("base_quantity", "line_total")


class GoodsReceiptItemInline(admin.TabularInline):
    model = GoodsReceiptItem
    extra = 0
    autocomplete_fields = ("purchase_order_item", "store")
    readonly_fields = ("item", "base_quantity", "inventory_changes_applied")


@admin.register(PurchaseRequisition)
class PurchaseRequisitionAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "requisition_number",
        "hotel",
        "branch",
        "request_type",
        "requester",
        "department",
        "preferred_supplier",
        "status",
        "created_at",
    )
    list_filter = (
        "hotel",
        "branch",
        "request_type",
        "status",
        "department",
        "preferred_supplier",
    )
    list_select_related = (
        "hotel",
        "branch",
        "requester",
        "department",
        "preferred_supplier",
    )
    autocomplete_fields = (
        "hotel",
        "branch",
        "requester",
        "department",
        "preferred_supplier",
    )
    search_fields = (
        "requisition_number",
        "id",
        "requester__user__employee_code",
        "department__name",
        "preferred_supplier__name",
        "reason",
        "control_notes",
    )
    readonly_fields = (
        "requisition_number",
        "status",
        "submitted_at",
        "approved_at",
        "rejected_at",
        "returned_at",
        "fulfilled_at",
        "cancelled_at",
        "closed_at",
    )
    date_hierarchy = "created_at"
    inlines = [RequisitionItemInline, ApprovalWorkflowInline]
    actions = ("submit_selected_requisitions", "cancel_selected_requisitions")

    @admin.action(description="Submit selected requisitions for approval")
    def submit_selected_requisitions(self, request, queryset):
        submitted = 0
        for requisition in queryset:
            try:
                requisition.submit(actor=request.user)
                submitted += 1
            except Exception as error:
                self.message_user(request, f"{requisition}: {error}", level=messages.ERROR)
        if submitted:
            self.message_user(request, f"Submitted {submitted} requisition(s).")

    @admin.action(description="Cancel selected requisitions")
    def cancel_selected_requisitions(self, request, queryset):
        cancelled = 0
        for requisition in queryset:
            try:
                requisition.cancel(actor=request.user)
                cancelled += 1
            except Exception as error:
                self.message_user(request, f"{requisition}: {error}", level=messages.ERROR)
        if cancelled:
            self.message_user(request, f"Cancelled {cancelled} requisition(s).")


@admin.register(RequisitionItem)
class RequisitionItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "requisition",
        "item",
        "unit",
        "quantity",
        "approved_quantity",
        "ordered_quantity",
        "received_quantity",
        "created_at",
    )
    list_filter = ("item", "unit")
    list_select_related = ("requisition", "item", "unit")
    autocomplete_fields = ("requisition", "item", "unit")
    search_fields = (
        "requisition__requisition_number",
        "requisition__id",
        "item__name",
        "item__sku",
    )
    date_hierarchy = "created_at"


@admin.register(RequisitionHistory)
class RequisitionHistoryAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "requisition",
        "action",
        "previous_status",
        "new_status",
        "performed_by",
        "created_at",
    )
    list_filter = ("action", "previous_status", "new_status")
    list_select_related = ("requisition", "performed_by")
    autocomplete_fields = ("requisition", "performed_by")
    search_fields = (
        "requisition__requisition_number",
        "performed_by__username",
        "comments",
    )
    readonly_fields = (
        "requisition",
        "action",
        "previous_status",
        "new_status",
        "performed_by",
        "comments",
        "metadata",
        "created_at",
        "updated_at",
        "created_by",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(RequisitionSequence)
class RequisitionSequenceAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("scope", "year", "current_value", "updated_at")
    list_filter = ("year", "scope")
    readonly_fields = (
        "scope",
        "year",
        "current_value",
        "created_at",
        "updated_at",
        "created_by",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ProcurementDocumentSequence)
class ProcurementDocumentSequenceAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("document_type", "current_value", "updated_at")
    readonly_fields = tuple(field.name for field in ProcurementDocumentSequence._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PurchaseOrderActivity)
class PurchaseOrderActivityAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("purchase_order", "action", "performed_by", "previous_status", "new_status", "created_at")
    list_filter = ("action", "previous_status", "new_status")
    search_fields = ("purchase_order__po_number", "performed_by__username", "comments")
    readonly_fields = tuple(field.name for field in PurchaseOrderActivity._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PurchaseOrderPrintRecord)
class PurchaseOrderPrintRecordAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("purchase_order", "print_number", "classification", "printed_by", "created_at")
    list_filter = ("classification",)
    search_fields = ("purchase_order__po_number", "printed_by__username")
    readonly_fields = tuple(field.name for field in PurchaseOrderPrintRecord._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(VendorQuotation)
class VendorQuotationAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("requisition", "supplier", "total_amount", "created_at")
    list_filter = ("supplier",)
    list_select_related = ("requisition", "supplier")
    autocomplete_fields = ("requisition", "supplier")
    search_fields = ("requisition__id", "supplier__name")
    date_hierarchy = "created_at"


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "po_number",
        "supplier",
        "store",
        "ordered_by",
        "status",
        "sent_at",
        "sent_to_email",
        "total_amount",
        "created_at",
    )
    list_filter = ("status", "supplier", "store")
    list_select_related = ("requisition", "supplier", "ordered_by", "store", "sent_by")
    autocomplete_fields = ("requisition", "supplier", "ordered_by", "store", "sent_by")
    search_fields = (
        "po_number",
        "supplier__name",
        "ordered_by__user__employee_code",
        "store__name",
        "sent_to_email",
    )
    readonly_fields = ("sent_at",)
    date_hierarchy = "created_at"
    inlines = [PurchaseOrderItemInline]


@admin.register(PurchaseOrderItem)
class PurchaseOrderItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("purchase_order", "item", "unit", "quantity", "base_quantity", "unit_cost", "line_total")
    list_filter = ("unit",)
    list_select_related = ("purchase_order", "item", "unit")
    autocomplete_fields = ("purchase_order", "item", "unit")
    search_fields = ("purchase_order__po_number", "item__name", "item__sku")
    readonly_fields = ("base_quantity", "line_total")
    date_hierarchy = "created_at"


@admin.register(GoodsReceiptNote)
class GoodsReceiptNoteAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("grn_number", "purchase_order", "supplier_invoice_no", "received_by", "received_date", "status")
    list_filter = ("status", "received_date")
    list_select_related = ("purchase_order", "received_by")
    autocomplete_fields = ("purchase_order", "received_by")
    search_fields = ("grn_number", "purchase_order__po_number", "supplier_invoice_no", "delivery_note_no", "received_by__user__employee_code")
    date_hierarchy = "received_date"
    inlines = [GoodsReceiptItemInline]
    actions = ("post_selected_receipts_to_inventory",)

    @admin.action(description="Post selected receipts to inventory")
    def post_selected_receipts_to_inventory(self, request, queryset):
        posted = 0
        for receipt in queryset:
            try:
                receipt.post_to_inventory()
                posted += 1
            except Exception as error:
                self.message_user(request, f"{receipt}: {error}", level=messages.ERROR)
        if posted:
            self.message_user(request, f"Posted {posted} goods receipt(s) to inventory.")


@admin.register(GoodsReceiptItem)
class GoodsReceiptItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "goods_receipt",
        "item",
        "store",
        "quantity_received",
        "base_quantity",
        "unit_cost",
        "inventory_changes_applied",
    )
    list_filter = ("store", "expiry_date", "inventory_changes_applied")
    list_select_related = ("goods_receipt", "purchase_order_item", "item", "store")
    autocomplete_fields = ("goods_receipt", "purchase_order_item", "store")
    search_fields = ("goods_receipt__purchase_order__po_number", "item__name", "item__sku", "store__name")
    readonly_fields = ("item", "base_quantity", "inventory_changes_applied")
    date_hierarchy = "created_at"
    actions = ("post_selected_items_to_inventory",)

    @admin.action(description="Post selected receipt items to inventory")
    def post_selected_items_to_inventory(self, request, queryset):
        posted = 0
        for receipt_item in queryset:
            try:
                receipt_item.post_to_inventory()
                posted += 1
            except Exception as error:
                self.message_user(request, f"{receipt_item}: {error}", level=messages.ERROR)
        if posted:
            self.message_user(request, f"Posted {posted} receipt item(s) to inventory.")


class VendorQuotationItemInline(admin.TabularInline):
    model = VendorQuotationItem
    extra = 0
    autocomplete_fields = ("requisition_item", "unit")
    readonly_fields = ("item", "line_total")


# Attach quotation line items to existing quotation admin.
VendorQuotationAdmin.inlines = [VendorQuotationItemInline]


@admin.register(VendorQuotationItem)
class VendorQuotationItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("quotation", "item", "unit", "quantity", "unit_price", "line_total", "selected")
    list_filter = ("selected", "unit")
    list_select_related = ("quotation", "requisition_item", "item", "unit")
    autocomplete_fields = ("quotation", "requisition_item", "unit")
    search_fields = ("quotation__supplier__name", "item__name", "item__sku", "selection_reason")
    readonly_fields = ("item", "line_total")


class GoodsInspectionItemInline(admin.TabularInline):
    model = GoodsInspectionItem
    extra = 0
    autocomplete_fields = ("goods_receipt_item",)
    readonly_fields = ("item",)


@admin.register(GoodsInspection)
class GoodsInspectionAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("goods_receipt", "inspected_by", "inspection_date", "status", "delivery_note_no")
    list_filter = ("status", "inspection_date")
    list_select_related = ("goods_receipt", "inspected_by")
    autocomplete_fields = ("goods_receipt", "inspected_by")
    search_fields = ("delivery_note_no", "remarks", "goods_receipt__purchase_order__po_number")
    readonly_fields = ("status",)
    inlines = [GoodsInspectionItemInline]


@admin.register(GoodsInspectionItem)
class GoodsInspectionItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("inspection", "item", "quantity_received", "quantity_accepted", "quantity_rejected")
    list_select_related = ("inspection", "goods_receipt_item", "item")
    autocomplete_fields = ("inspection", "goods_receipt_item")
    search_fields = ("item__name", "item__sku", "rejection_reason")
    readonly_fields = ("item",)


class SupplierReturnItemInline(admin.TabularInline):
    model = SupplierReturnItem
    extra = 0
    autocomplete_fields = ("item", "unit")
    readonly_fields = ("base_quantity",)


@admin.register(SupplierReturn)
class SupplierReturnAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("return_no", "supplier", "store", "returned_by", "status", "return_date", "inventory_changes_applied")
    list_filter = ("status", "supplier", "store", "inventory_changes_applied")
    list_select_related = ("supplier", "goods_receipt", "store", "returned_by")
    autocomplete_fields = ("supplier", "goods_receipt", "store", "returned_by")
    search_fields = ("return_no", "supplier__name", "goods_receipt__purchase_order__po_number", "reason")
    readonly_fields = ("return_no", "status", "inventory_changes_applied")
    inlines = [SupplierReturnItemInline]
    actions = ("apply_selected_supplier_returns",)

    @admin.action(description="Post selected supplier returns")
    def apply_selected_supplier_returns(self, request, queryset):
        posted = 0
        for supplier_return in queryset:
            try:
                supplier_return.apply_inventory_changes()
                posted += 1
            except Exception as error:
                self.message_user(request, f"{supplier_return}: {error}", level=messages.ERROR)
        if posted:
            self.message_user(request, f"Posted {posted} supplier return(s).")


@admin.register(SupplierReturnItem)
class SupplierReturnItemAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("supplier_return", "item", "unit", "quantity", "base_quantity")
    list_select_related = ("supplier_return", "item", "unit")
    autocomplete_fields = ("supplier_return", "item", "unit")
    search_fields = ("supplier_return__return_no", "item__name", "item__sku", "reason")
