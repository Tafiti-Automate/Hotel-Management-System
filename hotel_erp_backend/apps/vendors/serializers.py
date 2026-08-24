from rest_framework import serializers

from apps.vendors.models import Supplier
from core.phone_validation import normalize_uganda_phone


class SupplierSerializer(serializers.ModelSerializer):
    def validate_phone(self, value):
        return normalize_uganda_phone(value, allow_blank=False)

    class Meta:
        model = Supplier
        fields = (
            "id",
            "name",
            "supplier_code",
            "email",
            "phone",
            "address",
            "contact_person",
            "payment_terms",
            "tin_number",
            "registration_number",
            "is_active",
            "notes",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by")
