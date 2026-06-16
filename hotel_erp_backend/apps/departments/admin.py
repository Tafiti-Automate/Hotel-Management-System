from django.contrib import admin

from apps.departments.models import Branch, Department
from core.mixins.admin import CreatedByAdminMixin


@admin.register(Department)
class DepartmentAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("name", "is_active", "created_at", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "description")
    date_hierarchy = "created_at"


@admin.register(Branch)
class BranchAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "name",
        "hotel",
        "branch_code",
        "branch_type",
        "city",
        "country",
        "contact_person",
        "contact",
        "is_head_office",
        "is_active",
        "created_at",
    )
    list_filter = ("hotel", "branch_type", "is_head_office", "is_active", "country", "city")
    search_fields = (
        "name",
        "branch_code",
        "location",
        "physical_address",
        "contact_person",
        "contact",
        "email",
        "hotel__name",
    )
    date_hierarchy = "created_at"
