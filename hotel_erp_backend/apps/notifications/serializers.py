from rest_framework import serializers

from apps.notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    priority = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()

    def get_priority(self, obj):
        key = obj.deduplication_key
        if key.startswith("inventory-expiry:"):
            return "critical" if key.endswith(":expired") or key.endswith(":expires_today") else "warning"
        if key.startswith("ap-payment:"):
            return "warning" if key.endswith(":submitted") else "normal"
        return "normal"

    def get_category(self, obj):
        key = obj.deduplication_key
        if key.startswith("inventory-expiry:"):
            return "Inventory"
        if key.startswith("ap-payment:"):
            return "Accounts payable"
        return "General"

    class Meta:
        model = Notification
        fields = (
            "id",
            "employee",
            "title",
            "message",
            "is_read",
            "priority",
            "category",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = fields
