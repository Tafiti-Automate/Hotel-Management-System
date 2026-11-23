from datetime import datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from core.mixins.models import BaseModel
from core.validators.quantities import validate_non_negative_decimal, validate_positive_decimal


class Designation(BaseModel):
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.CASCADE,
        related_name="designations",
    )
    title = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=("department", "title"),
                name="unique_department_designation",
            )
        ]
        ordering = ("department__name", "title")

    def __str__(self):
        return f"{self.title} ({self.department.name})"


class Employee(BaseModel):
    GENDER_CHOICES = (("Male", "Male"), ("Female", "Female"))
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="employee_profile",
    )
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        related_name="employees",
    )
    branch = models.ForeignKey(
        "departments.Branch",
        on_delete=models.PROTECT,
        related_name="employees",
        null=True,
        blank=True,
    )
    designation_record = models.ForeignKey(
        Designation,
        on_delete=models.SET_NULL,
        related_name="employees",
        null=True,
        blank=True,
    )
    designation = models.CharField(max_length=100)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES, blank=True)
    contact = models.CharField(max_length=30, blank=True)
    address = models.TextField(blank=True)
    date_joined = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    photo = models.ImageField(upload_to="employee_photos/", blank=True, null=True, max_length=500)

    class Meta(BaseModel.Meta):
        ordering = ("user__first_name", "user__last_name", "user__username")

    def __str__(self):
        display_name = self.user.get_full_name() or self.user.username
        return f"{display_name} - {self.designation}"


class PayrollProfile(BaseModel):
    """Current payroll master data for one employee.

    Calculated payroll entries copy these values as immutable period snapshots;
    editing a profile therefore never rewrites an already posted payslip.
    """

    employee = models.OneToOneField(
        Employee, on_delete=models.PROTECT, related_name="payroll_profile",
    )
    basic_salary = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    tax_resident = models.BooleanField(default=True)
    nssf_applicable = models.BooleanField(default=True)
    nssf_number = models.CharField(max_length=50, blank=True)
    tin_number = models.CharField(max_length=50, blank=True)
    local_service_tax_annual = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
        help_text="Annual assessed LST, collected in four equal instalments from July to October.",
    )
    union_member = models.BooleanField(default=False)
    union_dues_monthly = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    bank_name = models.CharField(max_length=120, blank=True)
    bank_branch = models.CharField(max_length=120, blank=True)
    bank_account_name = models.CharField(max_length=150, blank=True)
    bank_account_number = models.CharField(max_length=80, blank=True)
    mobile_money_number = models.CharField(max_length=30, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        ordering = ("employee__department__name", "employee__user__first_name")

    def clean(self):
        super().clean()
        if self.employee_id and not self.employee.branch_id:
            raise ValidationError({"employee": "Assign the employee to a property before enabling payroll."})
        if self.union_dues_monthly and not self.union_member:
            raise ValidationError({"union_member": "Mark the employee as a union member before setting union dues."})

    def __str__(self):
        return f"Payroll profile - {self.employee}"


class PayrollAffector(BaseModel):
    """Approved earning or deduction applied to one employee or department."""

    TYPE_EARNING = "earning"
    TYPE_DEDUCTION = "deduction"
    TYPE_CHOICES = ((TYPE_EARNING, "Earning"), (TYPE_DEDUCTION, "Deduction"))
    METHOD_FIXED = "fixed"
    METHOD_PERCENT_BASIC = "percent_basic"
    METHOD_CHOICES = (
        (METHOD_FIXED, "Fixed amount"),
        (METHOD_PERCENT_BASIC, "Percentage of basic salary"),
    )
    CATEGORY_CHOICES = (
        ("basic_increment", "Basic salary increment"),
        ("merit_increment", "Merit increment"),
        ("arrears", "Arrears"),
        ("leave_transport", "Leave transport"),
        ("baggage_allowance", "Baggage allowance"),
        ("service_charge", "Service charge / breakages"),
        ("housing_allowance", "Housing allowance"),
        ("other_earning", "Other earning"),
        ("union_dues", "Union dues"),
        ("staff_debtor", "Staff debtor"),
        ("other_deduction", "Other deduction"),
    )

    branch = models.ForeignKey(
        "departments.Branch", on_delete=models.PROTECT, related_name="payroll_affectors",
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="payroll_affectors",
        null=True, blank=True,
    )
    department = models.ForeignKey(
        "departments.Department", on_delete=models.PROTECT, related_name="payroll_affectors",
        null=True, blank=True,
    )
    name = models.CharField(max_length=150)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES)
    affector_type = models.CharField(max_length=15, choices=TYPE_CHOICES)
    calculation_method = models.CharField(max_length=20, choices=METHOD_CHOICES, default=METHOD_FIXED)
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[validate_positive_decimal])
    taxable = models.BooleanField(default=True)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    recurring = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="approved_payroll_affectors", null=True, blank=True,
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-effective_from", "name")
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(employee__isnull=False, department__isnull=True)
                    | models.Q(employee__isnull=True, department__isnull=False)
                ),
                name="payroll_affector_exactly_one_target",
            ),
        ]

    def clean(self):
        super().clean()
        if bool(self.employee_id) == bool(self.department_id):
            raise ValidationError("Choose either one employee or one department.")
        if self.employee_id and self.employee.branch_id != self.branch_id:
            raise ValidationError({"employee": "The employee must belong to the selected property."})
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError({"effective_to": "The end date cannot be before the start date."})
        earning_categories = {
            "basic_increment", "merit_increment", "arrears", "leave_transport",
            "baggage_allowance", "service_charge", "housing_allowance", "other_earning",
        }
        expected = self.TYPE_EARNING if self.category in earning_categories else self.TYPE_DEDUCTION
        if self.affector_type != expected:
            raise ValidationError({"affector_type": f"{self.get_category_display()} must be an {expected}."})

    @property
    def is_approved(self):
        return bool(self.approved_at and self.approved_by_id)

    def __str__(self):
        return self.name


class SalaryAdvance(BaseModel):
    STATUS_DRAFT = "draft"
    STATUS_APPROVED = "approved"
    STATUS_REPAID = "repaid"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Draft"), (STATUS_APPROVED, "Approved"),
        (STATUS_REPAID, "Repaid"), (STATUS_CANCELLED, "Cancelled"),
    )

    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="salary_advances")
    request_date = models.DateField(default=timezone.localdate)
    principal_amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[validate_positive_decimal])
    monthly_installment = models.DecimalField(max_digits=18, decimal_places=2, validators=[validate_positive_decimal])
    balance = models.DecimalField(max_digits=18, decimal_places=2, validators=[validate_non_negative_decimal])
    reason = models.TextField()
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="approved_salary_advances", null=True, blank=True,
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-request_date", "employee__user__first_name")

    def clean(self):
        super().clean()
        if self.balance > self.principal_amount:
            raise ValidationError({"balance": "The outstanding balance cannot exceed the approved advance."})
        if self.monthly_installment > self.principal_amount:
            raise ValidationError({"monthly_installment": "The instalment cannot exceed the advance amount."})

    def __str__(self):
        return f"{self.employee} - {self.principal_amount}"


class PayrollPeriod(BaseModel):
    STATUS_DRAFT = "draft"
    STATUS_CALCULATED = "calculated"
    STATUS_SUBMITTED = "submitted"
    STATUS_APPROVED = "approved"
    STATUS_POSTED = "posted"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Draft"), (STATUS_CALCULATED, "Calculated"),
        (STATUS_SUBMITTED, "Submitted to Finance"), (STATUS_APPROVED, "Approved"),
        (STATUS_POSTED, "Posted"),
    )

    branch = models.ForeignKey(
        "departments.Branch", on_delete=models.PROTECT, related_name="payroll_periods",
    )
    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    statutory_rule_version = models.CharField(max_length=40, default="UG-FY2026-27")
    note = models.TextField(blank=True)
    calculated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="calculated_payroll_periods", null=True, blank=True,
    )
    calculated_at = models.DateTimeField(null=True, blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="submitted_payroll_periods", null=True, blank=True,
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="approved_payroll_periods", null=True, blank=True,
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="posted_payroll_periods", null=True, blank=True,
    )
    posted_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-year", "-month", "branch__name")
        constraints = [
            models.UniqueConstraint(fields=("branch", "year", "month"), name="unique_branch_payroll_period"),
            models.CheckConstraint(condition=models.Q(month__gte=1, month__lte=12), name="payroll_month_1_to_12"),
        ]

    @property
    def label(self):
        return f"{self.year}-{self.month:02d}"

    def __str__(self):
        return f"{self.branch} payroll {self.label}"


class ShiftTemplate(BaseModel):
    """Scheduled hotel shift, including shifts that cross midnight."""

    branch = models.ForeignKey(
        "departments.Branch", on_delete=models.PROTECT, related_name="hr_shifts",
    )
    name = models.CharField(max_length=100)
    starts_at = models.TimeField()
    ends_at = models.TimeField()
    unpaid_break_minutes = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta(BaseModel.Meta):
        ordering = ("branch__name", "starts_at", "name")
        constraints = [
            models.UniqueConstraint(fields=("branch", "name"), name="unique_hr_shift_per_branch"),
        ]

    def clean(self):
        super().clean()
        if self.starts_at and self.ends_at:
            start = datetime.combine(timezone.localdate(), self.starts_at)
            end = datetime.combine(timezone.localdate(), self.ends_at)
            if end <= start:
                end += timedelta(days=1)
            minutes = int((end - start).total_seconds() // 60)
            if self.unpaid_break_minutes >= minutes:
                raise ValidationError({"unpaid_break_minutes": "Break time must be shorter than the scheduled shift."})

    def __str__(self):
        return f"{self.branch}: {self.name}"


class AttendanceRecord(BaseModel):
    """Approved daily payroll evidence, including paid rest and unpaid absence.

    Overtime payment is an explicitly approved monetary amount; the system
    does not guess hotel-specific overtime multipliers or time-off policies.
    """

    STATUS_PRESENT = "present"
    STATUS_PAID_LEAVE = "paid_leave"
    STATUS_UNPAID_LEAVE = "unpaid_leave"
    STATUS_ABSENT = "absent"
    STATUS_REST = "rest"
    STATUS_PUBLIC_HOLIDAY = "public_holiday"
    STATUS_CHOICES = (
        (STATUS_PRESENT, "Present"), (STATUS_PAID_LEAVE, "Approved paid leave"),
        (STATUS_UNPAID_LEAVE, "Approved unpaid leave"), (STATUS_ABSENT, "Unpaid absence"),
        (STATUS_REST, "Paid rest day"), (STATUS_PUBLIC_HOLIDAY, "Paid public holiday"),
    )
    PAYABLE_STATUSES = {
        STATUS_PRESENT, STATUS_PAID_LEAVE, STATUS_REST, STATUS_PUBLIC_HOLIDAY,
    }

    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name="attendance_records",
    )
    work_date = models.DateField()
    shift = models.ForeignKey(
        ShiftTemplate, on_delete=models.PROTECT, related_name="attendance_records",
        null=True, blank=True,
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)
    worked_hours = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    overtime_hours = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
    )
    overtime_pay = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("0.00"),
        validators=[validate_non_negative_decimal],
        help_text="Approved gross overtime in UGX; calculated from a verified employer policy outside payroll.",
    )
    note = models.TextField(blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="approved_hr_attendance", null=True, blank=True,
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-work_date", "employee__user__first_name")
        constraints = [
            models.UniqueConstraint(fields=("employee", "work_date"), name="unique_employee_daily_attendance"),
        ]

    def clean(self):
        super().clean()
        if self.employee_id and self.shift_id:
            if not self.employee.branch_id or self.shift.branch_id != self.employee.branch_id:
                raise ValidationError({"shift": "The shift must belong to the employee's property."})
        if self.employee_id and self.work_date and self.employee.date_joined:
            if self.work_date < self.employee.date_joined:
                raise ValidationError({"work_date": "Attendance cannot predate employment."})
        if self.work_date and self.work_date > timezone.localdate():
            raise ValidationError({"work_date": "Future attendance cannot be confirmed."})
        if self.status == self.STATUS_PRESENT and not self.worked_hours:
            raise ValidationError({"worked_hours": "Present attendance requires a positive worked-hours entry."})
        if self.status != self.STATUS_PRESENT and (
            self.worked_hours or self.overtime_hours or self.overtime_pay
        ):
            raise ValidationError("Only present attendance can include worked hours or overtime.")
        if bool(self.overtime_hours) != bool(self.overtime_pay):
            raise ValidationError("Overtime hours and approved overtime pay must both be positive or both zero.")
        if self.overtime_hours and not self.note.strip():
            raise ValidationError({"note": "Provide the approved shift, contract, or overtime policy evidence for this payment."})
        if self.work_date and self.employee_id and self.status in (
            self.STATUS_PAID_LEAVE, self.STATUS_UNPAID_LEAVE,
        ):
            leave = LeaveRequest.objects.filter(
                employee_id=self.employee_id, status="approved",
                start_date__lte=self.work_date, end_date__gte=self.work_date,
            )
            if self.status == self.STATUS_PAID_LEAVE:
                leave = leave.exclude(leave_type="unpaid")
            else:
                leave = leave.filter(leave_type="unpaid")
            if not leave.exists():
                raise ValidationError({"status": "An approved matching leave request must cover this date."})
            if self.status == self.STATUS_UNPAID_LEAVE:
                # Whole-day attendance cannot silently round fractional unpaid
                # leave into a full day's salary deduction.
                if any(request.days != request.days.to_integral_value() for request in leave):
                    raise ValidationError({
                        "status": "Partial-day unpaid leave needs a separately approved payroll adjustment; "
                        "do not classify the entire day as unpaid.",
                    })

    def __str__(self):
        return f"{self.employee} - {self.work_date} ({self.status})"


class PayrollEntry(BaseModel):
    """Immutable after posting; forms the payroll register and payslip snapshot."""

    period = models.ForeignKey(PayrollPeriod, on_delete=models.PROTECT, related_name="entries")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="payroll_entries")
    department = models.ForeignKey(
        "departments.Department", on_delete=models.PROTECT, related_name="payroll_entries",
    )
    joining_date = models.DateField(null=True, blank=True)
    days_in_month = models.PositiveSmallIntegerField()
    days_worked = models.DecimalField(max_digits=6, decimal_places=2, validators=[validate_non_negative_decimal])
    overtime_hours = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0.00"))
    overtime_pay = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    old_basic_salary = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    increment_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    merit_increment = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    new_basic_salary = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    eligible_basic_pay = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    arrears = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    leave_transport = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    baggage_allowance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    service_charge = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    housing_allowance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    other_earnings = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    gross_pay = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    nssf_employee = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    nssf_employer = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    nssf_total = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    paye = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    local_service_tax = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    union_dues = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    staff_debtors = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    salary_advance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    other_deductions = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    total_deductions = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    net_pay = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"))
    bank_name = models.CharField(max_length=120, blank=True)
    bank_account_name = models.CharField(max_length=150, blank=True)
    bank_account_number = models.CharField(max_length=80, blank=True)
    calculation_detail = models.JSONField(default=dict, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("department__name", "employee__user__first_name")
        constraints = [
            models.UniqueConstraint(fields=("period", "employee"), name="unique_employee_payroll_period"),
        ]

    def clean(self):
        super().clean()
        if self.days_worked > self.days_in_month:
            raise ValidationError({"days_worked": "Days worked cannot exceed the days in this payroll month."})
        if self.net_pay < 0:
            raise ValidationError({"net_pay": "Net pay cannot be negative."})

    def __str__(self):
        return f"{self.employee} - {self.period.label}"


class SalaryAdvanceRepayment(BaseModel):
    advance = models.ForeignKey(SalaryAdvance, on_delete=models.PROTECT, related_name="repayments")
    payroll_entry = models.ForeignKey(
        PayrollEntry, on_delete=models.PROTECT, related_name="advance_repayments",
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[validate_positive_decimal])
    posted_at = models.DateTimeField(default=timezone.now)

    class Meta(BaseModel.Meta):
        ordering = ("-posted_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("advance", "payroll_entry"), name="unique_advance_payroll_repayment",
            ),
        ]


class LeaveRequest(BaseModel):
    TYPE_CHOICES = (
        ("annual", "Annual leave"), ("sick", "Sick leave"),
        ("maternity", "Maternity leave"), ("paternity", "Paternity leave"),
        ("compassionate", "Compassionate leave"), ("unpaid", "Unpaid leave"),
    )
    STATUS_CHOICES = (
        ("pending", "Pending"), ("approved", "Approved"),
        ("rejected", "Rejected"), ("cancelled", "Cancelled"),
    )
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="leave_requests")
    leave_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.DecimalField(max_digits=6, decimal_places=2, validators=[validate_positive_decimal])
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="pending")
    review_note = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="reviewed_leave_requests", null=True, blank=True,
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-start_date", "employee__user__first_name")

    def clean(self):
        super().clean()
        if self.end_date < self.start_date:
            raise ValidationError({"end_date": "Leave cannot end before it starts."})


class EmployeeDocument(BaseModel):
    CATEGORY_CHOICES = (
        ("contract", "Employment contract"), ("identification", "Identification"),
        ("appointment", "Appointment letter"), ("qualification", "Qualification"),
        ("tax", "Tax / statutory"), ("disciplinary", "Disciplinary"),
        ("other", "Other"),
    )
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="hr_documents")
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    title = models.CharField(max_length=180)
    file = models.FileField(upload_to="employee_documents/%Y/%m/", max_length=500)
    original_name = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=150, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    expiry_date = models.DateField(null=True, blank=True)
    note = models.TextField(blank=True)

    class Meta(BaseModel.Meta):
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.employee} - {self.title}"
