from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from apps.accounts.models import User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ("username", "employee_code", "email", "is_staff", "is_active")
    search_fields = ("username", "employee_code", "email", "first_name", "last_name")
    list_per_page = 50
    date_hierarchy = "date_joined"
    fieldsets = UserAdmin.fieldsets + (
        ("Hotel Management System", {"fields": ("employee_code", "phone")}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Hotel Management System", {"fields": ("employee_code", "phone")}),
    )
