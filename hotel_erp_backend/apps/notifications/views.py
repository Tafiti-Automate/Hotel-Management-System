from rest_framework.viewsets import ModelViewSet

from apps.notifications.models import Notification
from apps.notifications.serializers import NotificationSerializer
from core.mixins.viewsets import CreatedByModelMixin


class NotificationViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = Notification.objects.select_related("employee")
    serializer_class = NotificationSerializer
    filterset_fields = ("employee", "is_read")
    search_fields = ("title", "message", "employee__user__employee_code")
    ordering_fields = ("is_read", "created_at")
