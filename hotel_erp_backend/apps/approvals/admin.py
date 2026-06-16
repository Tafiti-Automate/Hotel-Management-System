from django.contrib import admin, messages

from apps.approvals.models import ApprovalWorkflow
from core.mixins.admin import CreatedByAdminMixin


@admin.register(ApprovalWorkflow)
class ApprovalWorkflowAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("requisition", "stage", "approver", "status", "updated_at")
    list_filter = ("status", "stage")
    list_select_related = ("requisition", "approver")
    autocomplete_fields = ("requisition", "approver")
    search_fields = ("requisition__id", "approver__user__employee_code", "comments")
    readonly_fields = ("status",)
    date_hierarchy = "created_at"
    actions = ("approve_selected_stages", "reject_selected_stages")

    @admin.action(description="Approve selected stages")
    def approve_selected_stages(self, request, queryset):
        approved = 0
        for approval in queryset.order_by("requisition", "stage"):
            try:
                approval.approve()
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
                approval.reject()
                rejected += 1
            except Exception as error:
                self.message_user(request, f"{approval}: {error}", level=messages.ERROR)
        if rejected:
            self.message_user(request, f"Rejected {rejected} approval stage(s).")
