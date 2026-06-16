from rest_framework import serializers

from apps.approvals.models import ApprovalWorkflow


class ApprovalWorkflowSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalWorkflow
        fields = (
            "id",
            "requisition",
            "approver",
            "stage",
            "status",
            "comments",
            "created_at",
            "updated_at",
            "created_by",
        )
        read_only_fields = ("id", "status", "created_at", "updated_at", "created_by")
