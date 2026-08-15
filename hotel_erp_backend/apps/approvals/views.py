from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.approvals.models import ApprovalMatrixRule, ApprovalWorkflow
from apps.approvals.serializers import ApprovalMatrixRuleSerializer, ApprovalWorkflowSerializer
from core.mixins.viewsets import CreatedByModelMixin


def raise_drf_validation_error(error):
    raise ValidationError(getattr(error, "messages", str(error)))


class ApprovalWorkflowViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = ApprovalWorkflow.objects.select_related(
        "requisition",
        "approver",
        "decided_by",
    )
    serializer_class = ApprovalWorkflowSerializer
    filterset_fields = ("requisition", "approver", "stage", "status")
    search_fields = ("comments", "approver__user__employee_code")
    ordering_fields = ("stage", "status", "created_at")

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.is_superuser or user.groups.filter(
            name="System Administrator"
        ).exists():
            return queryset
        if self.action == "list":
            return queryset.filter(approver__user=user)
        return queryset

    @staticmethod
    def enforce_assigned_approver(request, approval):
        if request.user.is_superuser:
            return
        if approval.approver.user_id != request.user.id:
            raise PermissionDenied(
                "Only the employee assigned to this approval stage can record its decision."
            )

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        approval = self.get_object()
        self.enforce_assigned_approver(request, approval)
        try:
            approval.approve(
                comments=request.data.get("comments", ""),
                decided_by=request.user,
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(approval)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        approval = self.get_object()
        self.enforce_assigned_approver(request, approval)
        try:
            approval.reject(
                comments=request.data.get("comments", ""),
                decided_by=request.user,
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        serializer = self.get_serializer(approval)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="return-for-correction")
    def return_for_correction(self, request, pk=None):
        approval = self.get_object()
        self.enforce_assigned_approver(request, approval)
        try:
            approval.return_for_correction(
                comments=request.data.get("comments", ""),
                decided_by=request.user,
            )
        except DjangoValidationError as error:
            raise_drf_validation_error(error)
        return Response(self.get_serializer(approval).data)


class ApprovalMatrixRuleViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = ApprovalMatrixRule.objects.select_related(
        "branch", "department", "approver", "approver_role"
    )
    serializer_class = ApprovalMatrixRuleSerializer
    filterset_fields = ("document_type", "branch", "department", "stage", "is_active")
    search_fields = (
        "name",
        "stage_name",
        "approver__user__employee_code",
        "approver_role__name",
    )
    ordering_fields = ("document_type", "minimum_amount", "maximum_amount", "stage")
