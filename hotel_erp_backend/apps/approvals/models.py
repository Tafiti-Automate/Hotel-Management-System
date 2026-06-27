from django.core.exceptions import ValidationError
from django.db import models

from core.constants.choices import ApprovalStatus, PRStatus
from core.mixins.models import BaseModel


class ApprovalWorkflow(BaseModel):
    requisition = models.ForeignKey(
        "procurement.PurchaseRequisition",
        on_delete=models.CASCADE,
        related_name="approval_workflow",
    )
    approver = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="approval_steps",
    )
    stage = models.PositiveIntegerField()
    status = models.CharField(
        max_length=20,
        choices=ApprovalStatus.choices,
        default=ApprovalStatus.PENDING,
    )
    comments = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("requisition", "stage"),
                name="unique_requisition_approval_stage",
            )
        ]
        ordering = ("requisition", "stage")

    def __str__(self):
        return f"{self.requisition} stage {self.stage}: {self.status}"

    def approve(self, comments=""):
        if self.requisition.status in (PRStatus.DRAFT, PRStatus.CANCELLED):
            raise ValidationError("Requisition must be submitted before approval.")
        if self.requisition.status == PRStatus.APPROVED:
            raise ValidationError("Requisition is already fully approved")
        if self.status == ApprovalStatus.REJECTED:
            raise ValidationError("Rejected approval stages cannot be approved.")

        incomplete_previous_stages = ApprovalWorkflow.objects.filter(
            requisition=self.requisition,
            stage__lt=self.stage,
        ).exclude(status__in=(ApprovalStatus.APPROVED, ApprovalStatus.SKIPPED))
        if incomplete_previous_stages.exists():
            raise ValidationError("Previous approval stages must be completed first.")

        self.status = ApprovalStatus.APPROVED
        if comments:
            self.comments = comments
        self.save(update_fields=["status", "comments", "updated_at"])
        self.requisition.sync_approval_status()

    def reject(self, comments=""):
        if self.requisition.status in (PRStatus.CANCELLED, PRStatus.APPROVED):
            raise ValidationError("Cancelled or approved requisitions cannot be rejected.")
        self.status = ApprovalStatus.REJECTED
        if comments:
            self.comments = comments
        self.save(update_fields=["status", "comments", "updated_at"])
        self.requisition.status = PRStatus.REJECTED
        self.requisition.save(update_fields=["status", "updated_at"])
