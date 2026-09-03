import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.contrib.auth.models import Group
from rest_framework import serializers

from apps.employees.models import Designation, Employee
from core.phone_validation import normalize_uganda_phone


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
    role = serializers.PrimaryKeyRelatedField(queryset=Group.objects.all(), write_only=True, required=False, allow_null=True)
    role_name = serializers.SerializerMethodField()
    department_name = serializers.CharField(source="department.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)


    def validate_user_phone(self, value):
        return normalize_uganda_phone(value)

    def validate_contact(self, value):
        return normalize_uganda_phone(value)

    def validate_gender(self, value):
        value = str(value or "").strip().title()
        if value and value not in {"Male", "Female"}:
            raise serializers.ValidationError("Gender must be Male or Female.")
        return value

    def validate_photo(self, value):
        if value is None:
            return value

        max_size = 5 * 1024 * 1024
        if value.size > max_size:
            raise serializers.ValidationError("The employee photo must be 5 MB or smaller.")

        allowed_types = {"image/png", "image/jpeg", "image/webp"}
        content_type = getattr(value, "content_type", "")
        if content_type and content_type not in allowed_types:
            raise serializers.ValidationError("Upload a PNG, JPG/JPEG, or WEBP image.")

        running_on_vercel = bool(os.environ.get("VERCEL") or os.environ.get("VERCEL_URL"))
        blob_ready = bool(getattr(settings, "VERCEL_BLOB_CONFIGURED", False))
        if running_on_vercel and not blob_ready:
            raise serializers.ValidationError(
                "Media storage is not configured. Connect a Vercel Blob store to the backend project or add BLOB_READ_WRITE_TOKEN, redeploy, and try again."
            )
        return value

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
            "role",
            "role_name",
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

    def get_role_name(self, obj):
        group = obj.user.groups.first()
        return group.name if group else "Unassigned"

    @staticmethod
    def _next_employee_code():
        user_model = get_user_model()
        number = user_model.objects.count() + 1
        while user_model.objects.filter(employee_code=f"EMP-{number:05d}").exists():
            number += 1
        return f"EMP-{number:05d}"

    @transaction.atomic
    def create(self, validated_data):
        # Registration always starts as active. Status becomes an edit-time lifecycle control.
        validated_data["is_active"] = True
        user_data = validated_data.pop("user", {})
        password = validated_data.pop("password")
        role = validated_data.pop("role", None)
        employee_code = user_data.pop("employee_code", "") or self._next_employee_code()
        username = user_data.pop("username", "") or employee_code.lower()
        user = get_user_model().objects.create_user(
            username=username,
            employee_code=employee_code,
            password=password,
            account_type=get_user_model().ACCOUNT_EMPLOYEE,
            **user_data,
        )
        if role:
            user.groups.set([role])
        return Employee.objects.create(user=user, **validated_data)

    @transaction.atomic
    def update(self, instance, validated_data):
        user_data = validated_data.pop("user", {})
        password = validated_data.pop("password", "")
        role = validated_data.pop("role", None)
        employee_is_active = validated_data.get("is_active")
        for field, value in user_data.items():
            setattr(instance.user, field, value)
        if employee_is_active is not None:
            instance.user.is_active = employee_is_active
        if password:
            instance.user.set_password(password)
        instance.user.account_type = get_user_model().ACCOUNT_EMPLOYEE
        instance.user.save()
        if role is not None:
            instance.user.groups.set([role] if role else [])
        return super().update(instance, validated_data)
