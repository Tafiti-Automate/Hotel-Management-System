from rest_framework import serializers

from apps.approvals.models import ApprovalMatrixRule, ApprovalWorkflow
from core.constants.choices import ApprovalStatus


class ApprovalMatrixRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalMatrixRule
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class ApprovalWorkflowSerializer(serializers.ModelSerializer):
    is_actionable = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalWorkflow
        fields = (
            "id",
            "requisition",
            "approver",
            "stage",
            "stage_name",
            "matrix_rule",
            "status",
            "comments",
            "is_actionable",
            "decided_at",
            "decided_by",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = (
            "id",
            "status",
            "matrix_rule",
            "is_actionable",
            "decided_at",
            "decided_by",
            "created_at",
            "updated_at",
            "created_by",
        )

    def get_is_actionable(self, obj):
        if obj.status != ApprovalStatus.PENDING:
            return False
        return not ApprovalWorkflow.objects.filter(
            requisition=obj.requisition,
            stage__lt=obj.stage,
        ).exclude(
            status__in=(ApprovalStatus.APPROVED, ApprovalStatus.SKIPPED)
        ).exists()
