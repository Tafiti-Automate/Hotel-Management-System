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
        if self.assignment_type == self.ASSIGNMENT_DEPARTMENT_HEAD:
            errors["assignment_type"] = (
                "Department Head routing has been retired. Choose one of the configured operational roles."
            )
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
            if requisition.requester_id == self.approver_id:
                raise ValidationError(
                    f"{self.stage_name} cannot be assigned to the employee who requested "
                    "the purchase. Configure an independent approver."
                )
            return self.approver

        from apps.employees.models import Employee

        candidates = Employee.objects.filter(is_active=True, user__is_active=True)
        if requisition.branch_id:
            candidates = candidates.filter(branch=requisition.branch)
        if requisition.requester_id:
            candidates = candidates.exclude(pk=requisition.requester_id)

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
                f"{self.stage_name} requires exactly one independent active {assignment} "
                f"at {requisition.branch or 'the hotel'}; found {candidates.count()}."
            )
        return candidates.first()

    def resolve_purchase_order_approver(self, purchase_order):
        """Resolve an independent LPO approver within the order's organizational scope."""
        requisition = purchase_order.requisition
        excluded_ids = {
            employee_id
            for employee_id in (
                requisition.requester_id,
                purchase_order.ordered_by_id,
            )
            if employee_id
        }

        if self.assignment_type == self.ASSIGNMENT_FIXED_EMPLOYEE:
            if not self.approver_id or not self.approver.is_active:
                raise ValidationError(
                    f"{self.stage_name} does not have an active assigned employee."
                )
            if self.approver_id in excluded_ids:
                raise ValidationError(
                    f"{self.stage_name} cannot be assigned to the requester or buyer. "
                    "Configure an independent LPO approver."
                )
            return self.approver

        from apps.employees.models import Employee

        candidates = Employee.objects.filter(is_active=True, user__is_active=True)
        if requisition.branch_id:
            candidates = candidates.filter(branch=requisition.branch)
        if excluded_ids:
            candidates = candidates.exclude(pk__in=excluded_ids)

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
                f"{self.stage_name} requires exactly one independent active {assignment} "
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

    @classmethod
    def matching_purchase_order_rules(cls, purchase_order):
        amount = purchase_order.total_amount
        requisition = purchase_order.requisition
        rules = cls.objects.filter(
            document_type=cls.DOCUMENT_PURCHASE_ORDER,
            is_active=True,
            minimum_amount__lte=amount,
        ).filter(
            models.Q(maximum_amount__isnull=True) | models.Q(maximum_amount__gte=amount)
        )
        rules = rules.filter(
            models.Q(department__isnull=True) | models.Q(department=requisition.department)
        )
        rules = rules.filter(
            models.Q(branch__isnull=True) | models.Q(branch=requisition.branch)
        )
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


class PurchaseOrderApprovalWorkflow(BaseModel):
    """A value-routed maker-checker decision for a supplier-facing LPO."""

    purchase_order = models.ForeignKey(
        "procurement.PurchaseOrder",
        on_delete=models.CASCADE,
        related_name="approval_workflow",
    )
    approver = models.ForeignKey(
        "employees.Employee",
        on_delete=models.PROTECT,
        related_name="purchase_order_approval_steps",
        null=True,
        blank=True,
    )
    approver_role = models.ForeignKey(
        Group,
        on_delete=models.PROTECT,
        related_name="purchase_order_approval_steps",
        null=True,
        blank=True,
    )
    stage = models.PositiveIntegerField()
    stage_name = models.CharField(max_length=100, blank=True)
    matrix_rule = models.ForeignKey(
        ApprovalMatrixRule,
        on_delete=models.SET_NULL,
        related_name="generated_purchase_order_steps",
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
        related_name="purchase_order_approval_decisions",
        null=True,
        blank=True,
    )

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("purchase_order", "stage"),
                name="unique_purchase_order_approval_stage",
            )
        ]
        ordering = ("purchase_order", "stage")

    def __str__(self):
        return f"{self.purchase_order} stage {self.stage}: {self.status}"

    def _validate_current_stage(self):
        from core.constants.choices import POStatus

        if self.purchase_order.status != POStatus.PENDING_APPROVAL:
            raise ValidationError("The LPO is not pending approval.")
        if self.status != ApprovalStatus.PENDING:
            raise ValidationError("This LPO approval stage has already been decided.")
        incomplete_previous_stages = PurchaseOrderApprovalWorkflow.objects.filter(
            purchase_order=self.purchase_order,
            stage__lt=self.stage,
        ).exclude(status__in=(ApprovalStatus.APPROVED, ApprovalStatus.SKIPPED))
        if incomplete_previous_stages.exists():
            raise ValidationError("Previous LPO approval stages must be completed first.")

    def approve(self, comments="", decided_by=None):
        from core.constants.choices import POStatus

        self._validate_current_stage()
        previous_order_status = self.purchase_order.status
        remaining_after_this = PurchaseOrderApprovalWorkflow.objects.filter(
            purchase_order=self.purchase_order,
        ).exclude(pk=self.pk).exclude(
            status__in=(ApprovalStatus.APPROVED, ApprovalStatus.SKIPPED)
        )
        if not remaining_after_this.exists():
            blockers = self.purchase_order.quantity_commitment_blockers()
            if blockers:
                raise ValidationError(blockers)
        self.status = ApprovalStatus.APPROVED
        self.comments = comments
        self.decided_at = timezone.now()
        if decided_by is None and self.approver_id:
            decided_by = self.approver.user
        if decided_by is None:
            raise ValidationError("An authenticated approver is required for this LPO decision.")
        self.decided_by = decided_by
        self.save(
            update_fields=(
                "status",
                "comments",
                "decided_at",
                "decided_by",
                "updated_at",
            )
        )
        remaining = PurchaseOrderApprovalWorkflow.objects.filter(
            purchase_order=self.purchase_order,
        ).exclude(status__in=(ApprovalStatus.APPROVED, ApprovalStatus.SKIPPED))
        if remaining.exists():
            next_step = remaining.order_by("stage").first()
            if next_step and next_step.approver_role_id:
                try:
                    from apps.notifications.services import notify_roles
                    notify_roles(
                        [next_step.approver_role.name],
                        branch=self.purchase_order.requisition.branch,
                        title=f"LPO {self.purchase_order.lpo_number} requires {next_step.approver_role.name} approval",
                        message=f"{next_step.stage_name} is ready for your decision.",
                        created_by=self.decided_by,
                    )
                except Exception:
                    pass
        if not remaining.exists():
            self.purchase_order.status = POStatus.APPROVED
            self.purchase_order.approved_at = timezone.now()
            from apps.employees.models import Employee
            decision_employee = Employee.objects.filter(user=self.decided_by).first()
            self.purchase_order.approved_by = decision_employee or self.approver
            self.purchase_order.rejected_at = None
            self.purchase_order.save(
                update_fields=(
                    "status",
                    "approved_at",
                    "approved_by",
                    "rejected_at",
                    "updated_at",
                )
            )
            from apps.notifications.services import notify_employee

            notify_employee(
                self.purchase_order.ordered_by,
                title=f"LPO {self.purchase_order.lpo_number} finally approved",
                message=(
                    "The General Manager has given final approval. Open Procurement "
                    "Workbench, choose Approved · Print & Send, print the ORIGINAL LPO, "
                    "then email it to the supplier to start the lead-time clock."
                ),
                created_by=self.decided_by,
            )
        self.purchase_order.record_activity(
            action="approval_stage_approved",
            actor=self.decided_by,
            comments=comments,
            previous_status=previous_order_status,
            new_status=self.purchase_order.status,
            metadata={
                "stage": self.stage,
                "stage_name": self.stage_name,
                "approver": (
                    (self.decided_by.get_full_name() or self.decided_by.username)
                    if self.decided_by_id
                    else str(self.approver or self.approver_role or "")
                ),
                "assigned_role": self.approver_role.name if self.approver_role_id else "",
            },
        )

    def reject(self, comments="", decided_by=None):
        from core.constants.choices import POStatus

        self._validate_current_stage()
        previous_order_status = self.purchase_order.status
        if not comments.strip():
            raise ValidationError("Record a reason before rejecting the LPO.")
        self.status = ApprovalStatus.REJECTED
        self.comments = comments
        self.decided_at = timezone.now()
        if decided_by is None and self.approver_id:
            decided_by = self.approver.user
        if decided_by is None:
            raise ValidationError("An authenticated approver is required for this LPO decision.")
        self.decided_by = decided_by
        self.save(
            update_fields=(
                "status",
                "comments",
                "decided_at",
                "decided_by",
                "updated_at",
            )
        )
        self.purchase_order.status = POStatus.REJECTED
        self.purchase_order.rejected_at = timezone.now()
        self.purchase_order.approved_at = None
        self.purchase_order.approved_by = None
        self.purchase_order.save(
            update_fields=(
                "status",
                "rejected_at",
                "approved_at",
                "approved_by",
                "updated_at",
            )
        )
        # Rejection is terminal for this LPO. Preserve Procurement and Finance
        # quantities exactly as they stood at the decision point for audit.
        self.purchase_order.record_activity(
            action="rejected",
            actor=self.decided_by,
            comments=comments,
            previous_status=previous_order_status,
            new_status=POStatus.REJECTED,
            metadata={
                "stage": self.stage,
                "stage_name": self.stage_name,
                "approver": (
                    (self.decided_by.get_full_name() or self.decided_by.username)
                    if self.decided_by_id
                    else str(self.approver or self.approver_role or "")
                ),
                "assigned_role": self.approver_role.name if self.approver_role_id else "",
            },
        )
