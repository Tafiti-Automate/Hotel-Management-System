from django.contrib import admin

from apps.employees.models import Designation, Employee
from core.mixins.admin import CreatedByAdminMixin


@admin.register(Designation)
class DesignationAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("title", "department", "is_active", "created_at")
    list_filter = ("department", "is_active")
    list_select_related = ("department",)
    autocomplete_fields = ("department",)
    search_fields = ("title", "department__name", "description")
    date_hierarchy = "created_at"


@admin.register(Employee)
class EmployeeAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("user", "branch", "department", "designation", "is_active", "created_at")
    list_filter = ("branch", "department", "designation_record", "is_active")
    list_select_related = ("user", "branch", "department", "designation_record")
    autocomplete_fields = ("user", "branch", "department", "designation_record")
    search_fields = (
        "user__username",
        "user__employee_code",
        "user__first_name",
        "user__last_name",
        "designation",
    )
    date_hierarchy = "created_at"
