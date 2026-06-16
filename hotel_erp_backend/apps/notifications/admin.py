from django.contrib import admin

from apps.notifications.models import Notification
from core.mixins.admin import CreatedByAdminMixin


@admin.register(Notification)
class NotificationAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("title", "employee", "is_read", "created_at")
    list_filter = ("is_read",)
    list_select_related = ("employee",)
    autocomplete_fields = ("employee",)
    search_fields = ("title", "message", "employee__user__employee_code")
    date_hierarchy = "created_at"
