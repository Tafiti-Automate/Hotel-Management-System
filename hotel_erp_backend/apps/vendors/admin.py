from django.contrib import admin

from apps.vendors.models import Supplier
from core.mixins.admin import CreatedByAdminMixin


@admin.register(Supplier)
class SupplierAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = ("name", "supplier_code", "email", "phone", "payment_terms", "is_active")
    list_filter = ("is_active",)
    search_fields = (
        "name",
        "supplier_code",
        "email",
        "phone",
        "contact_person",
        "tin_number",
        "registration_number",
    )
    date_hierarchy = "created_at"
