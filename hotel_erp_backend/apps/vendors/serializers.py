from rest_framework import serializers

from apps.vendors.models import Supplier


class SupplierSerializer(serializers.ModelSerializer):
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
