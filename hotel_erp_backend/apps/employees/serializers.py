from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from apps.employees.models import Designation, Employee


class DesignationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Designation
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class EmployeeSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(source="user.first_name")
    last_name = serializers.CharField(source="user.last_name")
    username = serializers.CharField(source="user.username", required=False, allow_blank=True)
    email = serializers.EmailField(source="user.email", required=False, allow_blank=True)
    employee_code = serializers.CharField(source="user.employee_code", required=False, allow_blank=True)
    user_phone = serializers.CharField(source="user.phone", required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = Employee
        fields = (
            "id",
            "user",
            "first_name",
            "last_name",
            "username",
            "email",
            "employee_code",
            "user_phone",
            "password",
            "branch",
            "branch_name",
            "department",
            "department_name",
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
        read_only_fields = ("id", "user", "created_at", "updated_at", "created_by")

    def validate(self, attrs):
        user_data = attrs.get("user", {})
        if not self.instance:
            if not user_data.get("first_name"):
                raise serializers.ValidationError({"first_name": "First name is required."})
            if not user_data.get("last_name"):
                raise serializers.ValidationError({"last_name": "Last name is required."})
            if not attrs.get("password"):
                raise serializers.ValidationError({"password": "A temporary password is required."})
        return attrs

    @staticmethod
    def _next_employee_code():
        user_model = get_user_model()
        number = user_model.objects.count() + 1
        while user_model.objects.filter(employee_code=f"EMP-{number:05d}").exists():
            number += 1
        return f"EMP-{number:05d}"

    @transaction.atomic
    def create(self, validated_data):
        user_data = validated_data.pop("user", {})
        password = validated_data.pop("password")
        employee_code = user_data.pop("employee_code", "") or self._next_employee_code()
        username = user_data.pop("username", "") or employee_code.lower()
        user = get_user_model().objects.create_user(
            username=username,
            employee_code=employee_code,
            password=password,
            **user_data,
        )
        return Employee.objects.create(user=user, **validated_data)

    @transaction.atomic
    def update(self, instance, validated_data):
        user_data = validated_data.pop("user", {})
        password = validated_data.pop("password", "")
        employee_is_active = validated_data.get("is_active")
        for field, value in user_data.items():
            setattr(instance.user, field, value)
        if employee_is_active is not None:
            instance.user.is_active = employee_is_active
        if password:
            instance.user.set_password(password)
        instance.user.save()
        return super().update(instance, validated_data)
