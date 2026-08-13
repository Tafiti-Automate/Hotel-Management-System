from django.contrib import admin, messages

from apps.approvals.models import (
    ApprovalMatrixRule,
    ApprovalWorkflow,
    PurchaseOrderApprovalWorkflow,
)
from core.mixins.admin import CreatedByAdminMixin


@admin.register(ApprovalMatrixRule)
class ApprovalMatrixRuleAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "name", "document_type", "branch", "department", "minimum_amount",
        "maximum_amount", "stage", "stage_name", "assignment_type", "approver",
        "approver_role", "is_active",
    )
    list_filter = (
        "document_type",
        "branch",
        "department",
        "assignment_type",
        "is_active",
    )
    list_select_related = ("branch", "department", "approver", "approver_role")
    autocomplete_fields = ("branch", "department", "approver", "approver_role")
    search_fields = (
        "name",
        "stage_name",
        "approver__user__employee_code",
        "approver_role__name",
    )


@admin.register(ApprovalWorkflow)
class ApprovalWorkflowAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "requisition",
        "stage",
        "stage_name",
        "approver",
        "status",
        "decided_by",
        "decided_at",
    )
    list_filter = ("status", "stage")
    list_select_related = ("requisition", "approver")
    autocomplete_fields = ("requisition", "approver")
    search_fields = ("requisition__id", "approver__user__employee_code", "comments")
    readonly_fields = ("status", "decided_by", "decided_at")
    date_hierarchy = "created_at"
    actions = ("approve_selected_stages", "reject_selected_stages")

    @admin.action(description="Approve selected stages")
    def approve_selected_stages(self, request, queryset):
        approved = 0
        for approval in queryset.order_by("requisition", "stage"):
            try:
                approval.approve(decided_by=request.user)
                approved += 1
            except Exception as error:
                self.message_user(request, f"{approval}: {error}", level=messages.ERROR)
        if approved:
            self.message_user(request, f"Approved {approved} approval stage(s).")

    @admin.action(description="Reject selected stages")
    def reject_selected_stages(self, request, queryset):
        rejected = 0
        for approval in queryset:
            try:
                approval.reject(
                    comments="Rejected from Django administration.",
                    decided_by=request.user,
                )
                rejected += 1
            except Exception as error:
                self.message_user(request, f"{approval}: {error}", level=messages.ERROR)
        if rejected:
            self.message_user(request, f"Rejected {rejected} approval stage(s).")


@admin.register(PurchaseOrderApprovalWorkflow)
class PurchaseOrderApprovalWorkflowAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "purchase_order",
        "stage",
        "stage_name",
        "approver",
        "status",
        "decided_by",
        "decided_at",
    )
    list_filter = ("status", "stage")
    list_select_related = ("purchase_order", "approver", "decided_by")
    autocomplete_fields = ("purchase_order", "approver")
    search_fields = (
        "purchase_order__po_number",
        "approver__user__employee_code",
        "comments",
    )
    readonly_fields = ("status", "decided_by", "decided_at")
    date_hierarchy = "created_at"
