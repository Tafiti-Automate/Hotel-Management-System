from rest_framework import serializers

from apps.audit_logs.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = (
            "id", "actor", "action", "entity_type", "entity_id", "metadata",
            "ip_address", "request_id", "user_agent", "chain_sequence", "previous_hash", "entry_hash",
            "created_at", "updated_at", "created_by",
        )
        read_only_fields = fields
