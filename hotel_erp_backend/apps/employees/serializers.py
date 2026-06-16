from rest_framework import serializers

from apps.employees.models import Designation, Employee


class DesignationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Designation
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class EmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = (
            "id",
            "user",
            "branch",
            "department",
            "designation_record",
            "designation",
            "gender",
            "contact",
            "address",
            "date_joined",
            "is_active",
            "photo",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "created_at", "updated_at", "created_by")
