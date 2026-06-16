from django.contrib import admin

from apps.organization.models import Hotel
from core.mixins.admin import CreatedByAdminMixin


@admin.register(Hotel)
class HotelAdmin(CreatedByAdminMixin, admin.ModelAdmin):
    list_display = (
        "name",
        "business_type",
        "city",
        "country",
        "currency",
        "phone",
        "is_active",
        "created_at",
    )
    list_filter = ("business_type", "is_active", "country", "currency")
    search_fields = (
        "name",
        "legal_name",
        "registration_number",
        "tax_identification_number",
        "email",
        "phone",
        "city",
        "country",
    )
    date_hierarchy = "created_at"
