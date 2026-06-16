from rest_framework import serializers

from apps.departments.models import Branch, Department


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = (
            "id",
            "name",
            "description",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class BranchSerializer(serializers.ModelSerializer):
    hotel_name = serializers.CharField(source="hotel.name", read_only=True)

    class Meta:
        model = Branch
        fields = (
            "id",
            "hotel",
            "hotel_name",
            "name",
            "branch_code",
            "branch_type",
            "location",
            "physical_address",
            "city",
            "country",
            "contact_person",
            "contact",
            "email",
            "is_head_office",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "hotel_name", "created_at", "updated_at", "created_by")
