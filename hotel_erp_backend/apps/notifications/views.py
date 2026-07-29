from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.notifications.models import Notification
from apps.notifications.serializers import NotificationSerializer


class NotificationViewSet(ReadOnlyModelViewSet):
    queryset = Notification.objects.select_related("employee")
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ("employee", "is_read")
    search_fields = ("title", "message", "employee__user__employee_code")
    ordering_fields = ("is_read", "created_at")

    def get_queryset(self):
        return super().get_queryset().filter(employee__user=self.request.user)

    @action(detail=True, methods=("post",), url_path="mark-read")
    def mark_read(self, request, *args, **kwargs):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=("is_read", "updated_at"))
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=("post",), url_path="mark-all-read")
    def mark_all_read(self, request, *args, **kwargs):
        updated = self.get_queryset().filter(is_read=False).update(
            is_read=True,
            updated_at=timezone.now(),
        )
        return Response({"updated": updated})
