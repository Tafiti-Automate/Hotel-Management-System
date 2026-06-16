from rest_framework import serializers

from apps.organization.models import Hotel


class HotelSerializer(serializers.ModelSerializer):
    branch_count = serializers.IntegerField(source="branches.count", read_only=True)

    class Meta:
        model = Hotel
        fields = (
            "id",
            "name",
            "legal_name",
            "business_type",
            "registration_number",
            "tax_identification_number",
            "email",
            "phone",
            "alternate_phone",
            "website",
            "logo",
            "address",
            "city",
            "country",
            "currency",
            "timezone",
            "is_active",
            "branch_count",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by", "branch_count")
