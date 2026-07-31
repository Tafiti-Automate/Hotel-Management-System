from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from rest_framework import serializers


User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False)
    role = serializers.CharField(write_only=True, required=False, allow_blank=True)
    role_name = serializers.SerializerMethodField()

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
            "is_active",
            "is_staff",
            "date_joined",
            "last_login",
            "role",
            "role_name",
        )
        read_only_fields = ("id", "date_joined", "last_login")

    def create(self, validated_data):
        role = validated_data.pop("role", "")
        password = validated_data.pop("password", None)
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

    def get_role_name(self, obj):
        group = obj.groups.first()
        return group.name if group else ("Administrator" if obj.is_superuser else "Unassigned")


class RoleSerializer(serializers.ModelSerializer):
    permission_ids = serializers.PrimaryKeyRelatedField(
        source="permissions", queryset=Permission.objects.all(), many=True, required=False
    )
    user_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Group
        fields = ("id", "name", "permission_ids", "user_count")
