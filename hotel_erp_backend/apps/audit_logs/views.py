from rest_framework.permissions import IsAdminUser
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.audit_logs.models import AuditLog
from apps.audit_logs.serializers import AuditLogSerializer


class AuditLogViewSet(ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related("actor", "created_by")
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdminUser]
    filterset_fields = ("actor", "action", "entity_type", "entity_id")
    search_fields = ("action", "entity_type")
    ordering_fields = ("created_at", "action", "entity_type")
