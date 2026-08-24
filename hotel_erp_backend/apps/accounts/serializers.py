from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from rest_framework import serializers

from core.phone_validation import normalize_uganda_phone


User = get_user_model()


TECHNICAL_ROLE_NAMES = {
    "administrator", "system administrator", "platform administrator",
    "technical support", "implementation consultant",
}


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False)
    role = serializers.CharField(write_only=True, required=False, allow_blank=True)
    role_name = serializers.SerializerMethodField()
    linked_employee = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "password",
            "email",
            "first_name",
            "last_name",
            "employee_code",
            "phone",
            "account_type",
            "linked_employee",
            "is_active",
            "is_staff",
            "date_joined",
            "last_login",
            "role",
            "role_name",
        )
        read_only_fields = ("id", "date_joined", "last_login", "linked_employee")


    def validate_phone(self, value):
        return normalize_uganda_phone(value)

    def validate(self, attrs):
        role = attrs.get("role")
        account_type = attrs.get("account_type", getattr(self.instance, "account_type", User.ACCOUNT_EMPLOYEE))
        if not self.instance and account_type != User.ACCOUNT_SYSTEM:
            raise serializers.ValidationError({
                "account_type": "Employee accounts must be created from the employee profile."
            })
        if self.instance:
            linked_employee = getattr(self.instance, "employee_profile", None)
            if account_type == User.ACCOUNT_EMPLOYEE and linked_employee is None:
                raise serializers.ValidationError({
                    "account_type": "An employee account must be linked to an employee profile."
                })
            if account_type == User.ACCOUNT_SYSTEM and linked_employee is not None:
                raise serializers.ValidationError({
                    "account_type": "Linked employee accounts cannot be converted into standalone system accounts."
                })
        if account_type == User.ACCOUNT_SYSTEM:
            role_obj = None
            if role:
                try:
                    role_obj = Group.objects.get(pk=role)
                except Group.DoesNotExist:
                    raise serializers.ValidationError({"role": "Select a valid technical role."})
            elif self.instance:
                role_obj = self.instance.groups.first()
            role_name = (role_obj.name if role_obj else "").strip().lower()
            if not (getattr(self.instance, "is_superuser", False) or role_name in TECHNICAL_ROLE_NAMES):
                raise serializers.ValidationError({
                    "role": "Standalone accounts are restricted to approved technical roles."
                })
        return attrs

    def create(self, validated_data):
        role = validated_data.pop("role", "")
        password = validated_data.pop("password", None)
        if validated_data.get("account_type") == User.ACCOUNT_SYSTEM and not validated_data.get("employee_code"):
            base = (validated_data.get("username") or "system").upper().replace(" ", "-")[:35]
            code = f"SYS-{base}"
            suffix = 1
            while User.objects.filter(employee_code=code).exists():
                suffix += 1
                code = f"SYS-{base}-{suffix}"
            validated_data["employee_code"] = code
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        if role:
            user.groups.set([Group.objects.get(pk=role)])
        return user

    def update(self, instance, validated_data):
        role = validated_data.pop("role", None)
        password = validated_data.pop("password", None)
        instance = super().update(instance, validated_data)
        if role is not None:
            instance.groups.set([Group.objects.get(pk=role)] if role else [])
        if password:
            instance.set_password(password)
            instance.save(update_fields=["password"])
        return instance

    def get_linked_employee(self, obj):
        employee = getattr(obj, "employee_profile", None)
        if not employee:
            return None
        return {
            "id": str(employee.id),
            "name": employee.user.get_full_name() or employee.user.username,
            "department": employee.department.name,
        }

    def get_role_name(self, obj):
        group = obj.groups.first()
        return group.name if group else ("Administrator" if obj.is_superuser else "Unassigned")


class RoleSerializer(serializers.ModelSerializer):
    system_role = serializers.SerializerMethodField()
    permission_ids = serializers.PrimaryKeyRelatedField(
        source="permissions", queryset=Permission.objects.all(), many=True, required=False
    )
    user_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Group
        fields = ("id", "name", "permission_ids", "user_count", "system_role")

    def get_system_role(self, obj):
        from apps.accounts.role_policy import SYSTEM_ROLE_NAMES
        return obj.name in SYSTEM_ROLE_NAMES

    def validate_name(self, value):
        from apps.accounts.role_policy import SYSTEM_ROLE_NAMES
        if self.instance and self.instance.name in SYSTEM_ROLE_NAMES and value != self.instance.name:
            raise serializers.ValidationError("Predefined workflow role names cannot be changed. Adjust permissions instead.")
        return value


class PermissionSerializer(serializers.ModelSerializer):
    app_label = serializers.CharField(source="content_type.app_label", read_only=True)
    model = serializers.CharField(source="content_type.model", read_only=True)

    class Meta:
        model = Permission
        fields = ("id", "name", "codename", "app_label", "model")
