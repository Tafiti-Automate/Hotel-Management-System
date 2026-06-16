from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.approvals.models import ApprovalWorkflow
from apps.approvals.serializers import ApprovalWorkflowSerializer
from core.mixins.viewsets import CreatedByModelMixin


def raise_drf_validation_error(error):
    raise ValidationError(getattr(error, "messages", str(error)))


class ApprovalWorkflowViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = ApprovalWorkflow.objects.select_related("requisition", "approver")
    serializer_class = ApprovalWorkflowSerializer
    filterset_fields = ("requisition", "approver", "stage", "status")
    search_fields = ("comments", "approver__user__employee_code")
    ordering_fields = ("stage", "status", "created_at")

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        approval = self.get_object()
        try:
            approval.approve(comments=request.data.get("comments", ""))
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(approval)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        approval = self.get_object()
        try:
            approval.reject(comments=request.data.get("comments", ""))
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(approval)
        return Response(serializer.data)
