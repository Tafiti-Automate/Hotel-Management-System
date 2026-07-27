from django.core.exceptions import ValidationError
from django.db import models

from core.constants.choices import ApprovalStatus, PRStatus
from core.mixins.models import BaseModel


class ApprovalMatrixRule(BaseModel):
    """Reusable value-based approval rule used to build document approval routes."""

    DOCUMENT_PURCHASE_REQUISITION = "purchase_requisition"
    DOCUMENT_PURCHASE_ORDER = "purchase_order"
    DOCUMENT_STOCK_ADJUSTMENT = "stock_adjustment"
    DOCUMENT_STOCK_COUNT = "stock_count"
    DOCUMENT_TYPES = (
        (DOCUMENT_PURCHASE_REQUISITION, "Purchase Requisition"),
        (DOCUMENT_PURCHASE_ORDER, "Local Purchase Order"),
        (DOCUMENT_STOCK_ADJUSTMENT, "Stock Adjustment"),
        (DOCUMENT_STOCK_COUNT, "Stock Count"),
    )

    name = models.CharField(max_length=120)
    document_type = models.CharField(max_length=40, choices=DOCUMENT_TYPES)
    branch = models.ForeignKey(
        "departments.Branch",
        on_delete=models.CASCADE,
        related_name="approval_matrix_rules",
        null=True,
        blank=True,
    )
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.CASCADE,
        related_name="approval_matrix_rules",
        null=True,
        blank=True,
    )
    minimum_amount = models.DecimalField(max_digits=15, decimal_places=2, default=0)
    maximum_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
    )
    stage = models.PositiveIntegerField()
    stage_name = models.CharField(max_length=100)
    approver = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="approval_matrix_assignments",
    )
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        ordering = ("document_type", "minimum_amount", "stage")
        constraints = [
            models.UniqueConstraint(
                fields=("document_type", "branch", "department", "minimum_amount", "stage"),
                name="unique_approval_matrix_stage",
            ),
            models.CheckConstraint(
                condition=models.Q(maximum_amount__isnull=True)
                | models.Q(maximum_amount__gte=models.F("minimum_amount")),
                name="approval_matrix_valid_amount_range",
            ),
        ]

    def __str__(self):
        return f"{self.name}: {self.stage_name}"

    @classmethod
    def matching_requisition_rules(cls, requisition):
        amount = requisition.estimated_total
        branch = getattr(requisition.requester, "branch", None)
        rules = cls.objects.filter(
            document_type=cls.DOCUMENT_PURCHASE_REQUISITION,
            is_active=True,
            minimum_amount__lte=amount,
        ).filter(
            models.Q(maximum_amount__isnull=True) | models.Q(maximum_amount__gte=amount)
        )
        rules = rules.filter(
            models.Q(department__isnull=True) | models.Q(department=requisition.department)
        )
        rules = rules.filter(models.Q(branch__isnull=True) | models.Q(branch=branch))
        return rules.select_related("approver").order_by("stage")


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
    stage_name = models.CharField(max_length=100, blank=True)
    matrix_rule = models.ForeignKey(
        ApprovalMatrixRule,
        on_delete=models.SET_NULL,
        related_name="generated_steps",
        null=True,
        blank=True,
    )
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
