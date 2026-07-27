from rest_framework import serializers

from apps.approvals.models import ApprovalMatrixRule, ApprovalWorkflow


class ApprovalMatrixRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalMatrixRule
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "created_by")


class ApprovalWorkflowSerializer(serializers.ModelSerializer):
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
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "status", "matrix_rule", "created_at", "updated_at", "created_by")
