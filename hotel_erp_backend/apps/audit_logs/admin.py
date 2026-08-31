from django.contrib import admin

from apps.audit_logs.models import AuditChainState, AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "entity_type", "entity_id", "actor", "request_id", "created_at")
    list_filter = ("action", "entity_type")
    list_select_related = ("actor", "created_by")
    search_fields = ("action", "entity_type", "entity_id", "actor__username", "request_id")
    readonly_fields = (
        "id", "actor", "action", "entity_type", "entity_id", "metadata", "ip_address",
        "request_id", "user_agent", "chain_sequence", "previous_hash", "entry_hash", "created_at", "updated_at", "created_by",
    )
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AuditChainState)
class AuditChainStateAdmin(admin.ModelAdmin):
    readonly_fields = ("id", "last_hash", "sequence", "updated_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
