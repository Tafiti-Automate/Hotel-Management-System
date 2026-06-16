from django.contrib import admin

from apps.audit_logs.models import AuditLog
from core.mixins.admin import CreatedByAdminMixin


@admin.register(AuditLog)
class AuditLogAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("action", "entity_type", "entity_id", "actor", "created_at")
    list_filter = ("action", "entity_type")
    list_select_related = ("actor", "created_by")
    search_fields = ("action", "entity_type", "entity_id", "actor__username")
    readonly_fields = (
        "actor",
        "action",
        "entity_type",
        "entity_id",
        "metadata",
        "ip_address",
    )
    date_hierarchy = "created_at"
    has_add_permission = lambda self, request: False
    has_change_permission = lambda self, request, obj=None: False
