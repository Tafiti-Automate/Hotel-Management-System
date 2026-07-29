from django.core.exceptions import ValidationError
from django.conf import settings
from django.contrib.auth.models import Group
from django.db import models
from django.utils import timezone

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
    ASSIGNMENT_FIXED_EMPLOYEE = "fixed_employee"
    ASSIGNMENT_DEPARTMENT_HEAD = "department_head"
    ASSIGNMENT_ROLE = "role"
    ASSIGNMENT_TYPES = (
        (ASSIGNMENT_FIXED_EMPLOYEE, "Fixed employee"),
        (ASSIGNMENT_DEPARTMENT_HEAD, "Requesting department head"),
        (ASSIGNMENT_ROLE, "Employee role"),
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
    assignment_type = models.CharField(
        max_length=30,
        choices=ASSIGNMENT_TYPES,
        default=ASSIGNMENT_FIXED_EMPLOYEE,
    )
    approver = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="approval_matrix_assignments",
        null=True,
        blank=True,
    )
    approver_role = models.ForeignKey(
        Group,
        on_delete=models.PROTECT,
        related_name="approval_matrix_assignments",
        null=True,
        blank=True,
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

    def clean(self):
        super().clean()
        errors = {}
        if self.assignment_type == self.ASSIGNMENT_FIXED_EMPLOYEE and not self.approver_id:
            errors["approver"] = "Choose the employee assigned to this approval stage."
        if self.assignment_type == self.ASSIGNMENT_ROLE and not self.approver_role_id:
            errors["approver_role"] = "Choose the employee role assigned to this approval stage."
        if errors:
            raise ValidationError(errors)

    def resolve_approver(self, requisition):
        if self.assignment_type == self.ASSIGNMENT_FIXED_EMPLOYEE:
            if not self.approver_id or not self.approver.is_active:
                raise ValidationError(
                    f"{self.stage_name} does not have an active assigned employee."
                )
            return self.approver

        from apps.employees.models import Employee

        candidates = Employee.objects.filter(is_active=True, user__is_active=True)
        if requisition.branch_id:
            candidates = candidates.filter(branch=requisition.branch)

        if self.assignment_type == self.ASSIGNMENT_DEPARTMENT_HEAD:
            if not requisition.department_id:
                raise ValidationError(
                    f"{self.stage_name} requires a requesting department."
                )
            candidates = candidates.filter(
                department=requisition.department,
                user__groups__name="Department Head",
            )
        elif self.assignment_type == self.ASSIGNMENT_ROLE:
            candidates = candidates.filter(user__groups=self.approver_role)
        else:
            raise ValidationError(f"{self.stage_name} has an unsupported assignment type.")

        candidates = candidates.distinct().order_by("created_at")
        if candidates.count() != 1:
            assignment = (
                f"department head for {requisition.department}"
                if self.assignment_type == self.ASSIGNMENT_DEPARTMENT_HEAD
                else f"employee in the {self.approver_role} role"
            )
            raise ValidationError(
                f"{self.stage_name} requires exactly one active {assignment} "
                f"at {requisition.branch or 'the hotel'}; found {candidates.count()}."
            )
        return candidates.first()

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
        candidates = list(
            rules.select_related("approver", "approver_role", "branch", "department")
            .order_by("stage", "created_at")
        )
        selected = {}
        for rule in candidates:
            specificity = int(bool(rule.branch_id)) + (2 * int(bool(rule.department_id)))
            current = selected.get(rule.stage)
            if current is None or specificity > current[0]:
                selected[rule.stage] = (specificity, rule)
        return [selected[stage][1] for stage in sorted(selected)]


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
    decided_at = models.DateTimeField(null=True, blank=True)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="requisition_approval_decisions",
        null=True,
        blank=True,
    )

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

    def approve(self, comments="", decided_by=None):
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
        self.comments = comments
        self.decided_at = timezone.now()
        self.decided_by = decided_by or self.approver.user
        self.save(
            update_fields=[
                "status",
                "comments",
                "decided_at",
                "decided_by",
                "updated_at",
            ]
        )
        self.requisition.sync_approval_status(
            actor=self.decided_by,
            comments=comments,
        )

    def reject(self, comments="", decided_by=None):
        if self.requisition.status in (PRStatus.CANCELLED, PRStatus.APPROVED):
            raise ValidationError("Cancelled or approved requisitions cannot be rejected.")
        if not comments.strip():
            raise ValidationError("Record a reason before rejecting the requisition.")
        self.status = ApprovalStatus.REJECTED
        self.comments = comments
        self.decided_at = timezone.now()
        self.decided_by = decided_by or self.approver.user
        self.save(
            update_fields=[
                "status",
                "comments",
                "decided_at",
                "decided_by",
                "updated_at",
            ]
        )
        self.requisition.sync_approval_status(
            actor=self.decided_by,
            comments=comments,
        )

    def return_for_correction(self, comments="", decided_by=None):
        if self.requisition.status in (
            PRStatus.CANCELLED,
            PRStatus.APPROVED,
            PRStatus.PARTIALLY_ORDERED,
            PRStatus.ORDERED,
            PRStatus.PARTIALLY_RECEIVED,
            PRStatus.FULFILLED,
            PRStatus.CLOSED,
        ):
            raise ValidationError(
                "Approved, cancelled, or fulfilled requisitions cannot be returned."
            )
        if not comments.strip():
            raise ValidationError(
                "Explain what the requester must correct before returning the requisition."
            )
        incomplete_previous_stages = ApprovalWorkflow.objects.filter(
            requisition=self.requisition,
            stage__lt=self.stage,
        ).exclude(status__in=(ApprovalStatus.APPROVED, ApprovalStatus.SKIPPED))
        if incomplete_previous_stages.exists():
            raise ValidationError("Previous approval stages must be completed first.")
        self.status = ApprovalStatus.RETURNED
        self.comments = comments
        self.decided_at = timezone.now()
        self.decided_by = decided_by or self.approver.user
        self.save(
            update_fields=[
                "status",
                "comments",
                "decided_at",
                "decided_by",
                "updated_at",
            ]
        )
        self.requisition.sync_approval_status(
            actor=self.decided_by,
            comments=comments,
        )
