import csv
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from apps.employees.models import (
    EmployeeDocument,
    LeaveRequest,
    PayrollAffector,
    PayrollEntry,
    PayrollPeriod,
    PayrollProfile,
    SalaryAdvance,
    SalaryAdvanceRepayment,
)
from apps.employees.payroll_serializers import (
    EmployeeDocumentSerializer,
    LeaveRequestSerializer,
    PayrollAffectorSerializer,
    PayrollEntrySerializer,
    PayrollPeriodSerializer,
    PayrollProfileSerializer,
    SalaryAdvanceRepaymentSerializer,
    SalaryAdvanceSerializer,
)
from apps.employees.payroll_services import (
    approve_period,
    calculate_period,
    post_period,
    submit_period,
)
from core.mixins.viewsets import CreatedByModelMixin


HR_ROLES = {"HR Manager", "Payroll Officer"}
FINANCE_ROLES = {"Financial Manager", "Financial Controller"}
MANAGEMENT_ROLES = {"General Manager"}
ADMIN_ROLES = {"System Administrator"}


def has_role(user, roles):
    return bool(user and user.is_authenticated and user.groups.filter(name__in=roles).exists())


def require_role(user, roles, message):
    if not has_role(user, roles):
        raise PermissionDenied(message)


def employee_for(user):
    return getattr(user, "employee_profile", None)


def payroll_scope(queryset, user, branch_path):
    if user.is_superuser or has_role(user, ADMIN_ROLES):
        return queryset
    employee = employee_for(user)
    if not employee or not employee.branch_id:
        return queryset.none()
    if employee.branch.hotel_id:
        return queryset.filter(**{f"{branch_path}__hotel_id": employee.branch.hotel_id})
    return queryset.filter(**{f"{branch_path}_id": employee.branch_id})


def ensure_branch_scope(user, branch):
    if user.is_superuser or has_role(user, ADMIN_ROLES):
        return
    employee = employee_for(user)
    if not employee or not employee.branch_id:
        raise PermissionDenied("An employee assigned to a property is required.")
    if employee.branch.hotel_id:
        if branch.hotel_id != employee.branch.hotel_id:
            raise PermissionDenied("Cannot manage payroll for another hotel.")
    elif branch.pk != employee.branch_id:
        raise PermissionDenied("Cannot manage payroll for another property.")


def model_error(error):
    detail = getattr(error, "message_dict", None) or getattr(error, "messages", None) or str(error)
    raise ValidationError(detail)


class PayrollProfileViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PayrollProfile.objects.select_related(
        "employee__user", "employee__department", "employee__branch__hotel",
    )
    serializer_class = PayrollProfileSerializer
    filterset_fields = ("employee", "employee__department", "employee__branch", "is_active")
    search_fields = (
        "employee__user__first_name", "employee__user__last_name",
        "employee__user__employee_code", "nssf_number", "tin_number",
    )
    ordering_fields = ("employee__user__first_name", "basic_salary", "created_at")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "employee__branch")

    def _require_hr(self):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may maintain payroll profiles.")

    def perform_create(self, serializer):
        self._require_hr()
        employee = serializer.validated_data["employee"]
        ensure_branch_scope(self.request.user, employee.branch)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_hr()
        employee = serializer.validated_data.get("employee", serializer.instance.employee)
        ensure_branch_scope(self.request.user, employee.branch)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_hr()
        instance.is_active = False
        instance.save(update_fields=("is_active", "updated_at"))


class PayrollAffectorViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PayrollAffector.objects.select_related(
        "branch__hotel", "employee__user", "department", "approved_by",
    )
    serializer_class = PayrollAffectorSerializer
    filterset_fields = (
        "branch", "employee", "department", "category", "affector_type",
        "recurring", "is_active", "approved_by",
    )
    search_fields = ("name", "employee__user__first_name", "employee__user__last_name", "department__name")
    ordering_fields = ("effective_from", "amount", "created_at")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "branch")

    def _require_hr(self):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may prepare payroll affectors.")

    def perform_create(self, serializer):
        self._require_hr()
        ensure_branch_scope(self.request.user, serializer.validated_data["branch"])
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_hr()
        branch = serializer.validated_data.get("branch", serializer.instance.branch)
        ensure_branch_scope(self.request.user, branch)
        serializer.save()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        require_role(request.user, {"HR Manager"}, "Only the HR Manager may approve payroll affectors.")
        with transaction.atomic():
            affector = PayrollAffector.objects.select_for_update().get(pk=self.get_object().pk)
            if affector.is_approved:
                raise ValidationError("This affector is already approved.")
            affector.full_clean()
            affector.approved_by = request.user
            affector.approved_at = timezone.now()
            affector.save(update_fields=("approved_by", "approved_at", "updated_at"))
        return Response(self.get_serializer(affector).data)


class SalaryAdvanceViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = SalaryAdvance.objects.select_related(
        "employee__user", "employee__department", "employee__branch__hotel", "approved_by",
    )
    serializer_class = SalaryAdvanceSerializer
    filterset_fields = ("employee", "employee__department", "employee__branch", "status")
    search_fields = ("employee__user__first_name", "employee__user__last_name", "employee__user__employee_code")
    ordering_fields = ("request_date", "principal_amount", "balance", "created_at")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "employee__branch")

    def _require_hr(self):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may prepare salary advances.")

    def perform_create(self, serializer):
        self._require_hr()
        employee = serializer.validated_data["employee"]
        ensure_branch_scope(self.request.user, employee.branch)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_hr()
        serializer.save()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        require_role(request.user, FINANCE_ROLES, "Only the Financial Manager may approve salary advances.")
        with transaction.atomic():
            advance = SalaryAdvance.objects.select_for_update().get(pk=self.get_object().pk)
            if advance.status != SalaryAdvance.STATUS_DRAFT:
                raise ValidationError("Only a draft salary advance can be approved.")
            if advance.created_by_id == request.user.pk:
                raise ValidationError("The salary-advance preparer cannot approve the same request.")
            advance.status = SalaryAdvance.STATUS_APPROVED
            advance.approved_by = request.user
            advance.approved_at = timezone.now()
            advance.save(update_fields=("status", "approved_by", "approved_at", "updated_at"))
        return Response(self.get_serializer(advance).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        require_role(request.user, HR_ROLES | FINANCE_ROLES, "Human Resources or Finance approval is required.")
        with transaction.atomic():
            advance = SalaryAdvance.objects.select_for_update().get(pk=self.get_object().pk)
            if advance.status not in (SalaryAdvance.STATUS_DRAFT, SalaryAdvance.STATUS_APPROVED):
                raise ValidationError("Only a draft or approved unpaid advance can be cancelled.")
            if advance.balance != advance.principal_amount:
                raise ValidationError("An advance with posted repayments cannot be cancelled.")
            advance.status = SalaryAdvance.STATUS_CANCELLED
            advance.save(update_fields=("status", "updated_at"))
        return Response(self.get_serializer(advance).data)


class PayrollPeriodViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = PayrollPeriod.objects.select_related(
        "branch__hotel", "calculated_by", "submitted_by", "approved_by", "posted_by",
    ).prefetch_related("entries")
    serializer_class = PayrollPeriodSerializer
    filterset_fields = ("branch", "year", "month", "status")
    ordering_fields = ("year", "month", "status", "created_at")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "branch")

    def perform_create(self, serializer):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may open a payroll period.")
        ensure_branch_scope(self.request.user, serializer.validated_data["branch"])
        super().perform_create(serializer)

    def perform_update(self, serializer):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may edit draft payroll periods.")
        serializer.save()

    def perform_destroy(self, instance):
        require_role(self.request.user, {"HR Manager"}, "Only the HR Manager may remove draft payroll periods.")
        if instance.status != PayrollPeriod.STATUS_DRAFT:
            raise ValidationError("Only an empty draft payroll period can be deleted.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def calculate(self, request, pk=None):
        require_role(request.user, HR_ROLES, "Only Human Resources may calculate payroll.")
        try:
            period = calculate_period(self.get_object(), request.user)
        except DjangoValidationError as error:
            model_error(error)
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        require_role(request.user, HR_ROLES, "Only Human Resources may submit payroll to Finance.")
        try:
            period = submit_period(self.get_object(), request.user, request.data.get("note", ""))
        except DjangoValidationError as error:
            model_error(error)
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        require_role(request.user, FINANCE_ROLES, "Only the Financial Manager may approve payroll.")
        try:
            period = approve_period(self.get_object(), request.user, request.data.get("note", ""))
        except DjangoValidationError as error:
            model_error(error)
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=["post"])
    def post(self, request, pk=None):
        require_role(request.user, FINANCE_ROLES, "Only the Financial Manager may post approved payroll.")
        try:
            period = post_period(self.get_object(), request.user)
        except DjangoValidationError as error:
            model_error(error)
        return Response(self.get_serializer(period).data)

    def _csv(self, *, bank_only=False):
        period = self.get_object()
        entries = period.entries.select_related("employee__user", "department").order_by(
            "department__name", "employee__user__first_name",
        )
        response = HttpResponse(content_type="text/csv")
        suffix = "bank-schedule" if bank_only else "payroll-register"
        response["Content-Disposition"] = f'attachment; filename="{suffix}-{period.label}.csv"'
        writer = csv.writer(response)
        if bank_only:
            writer.writerow(("Employee code", "Employee", "Bank", "Account name", "Account number", "Net pay"))
            for entry in entries:
                writer.writerow((
                    entry.employee.user.employee_code,
                    entry.employee.user.get_full_name(), entry.bank_name,
                    entry.bank_account_name, entry.bank_account_number, entry.net_pay,
                ))
        else:
            writer.writerow((
                "S/No", "Department & name", "Joining date", "Department / section", "Status",
                "Days in month", "Old basic salary", "Increment", "Merit increment", "New basic salary",
                "Days worked", "Eligible basic pay", "Arrears", "Leave transport", "Baggage allowance",
                "Service charge / breakages", "Other earnings", "Housing allowance", "Gross pay",
                "NSSF employee", "NSSF employer", "Total NSSF", "PAYE", "Local service tax",
                "Union dues", "Staff debtors", "Salary advance", "Other deductions",
                "Total deductions", "Net pay",
            ))
            for index, entry in enumerate(entries, 1):
                writer.writerow((
                    index, entry.employee.user.get_full_name(), entry.joining_date, entry.department.name, "Active",
                    entry.days_in_month, entry.old_basic_salary, entry.increment_amount, entry.merit_increment,
                    entry.new_basic_salary, entry.days_worked, entry.eligible_basic_pay, entry.arrears,
                    entry.leave_transport, entry.baggage_allowance, entry.service_charge, entry.other_earnings,
                    entry.housing_allowance, entry.gross_pay, entry.nssf_employee, entry.nssf_employer,
                    entry.nssf_total, entry.paye, entry.local_service_tax, entry.union_dues,
                    entry.staff_debtors, entry.salary_advance, entry.other_deductions,
                    entry.total_deductions, entry.net_pay,
                ))
        return response

    @action(detail=True, methods=["get"], url_path="register.csv")
    def register_csv(self, request, pk=None):
        return self._csv()

    @action(detail=True, methods=["get"], url_path="bank-schedule.csv")
    def bank_schedule_csv(self, request, pk=None):
        return self._csv(bank_only=True)


class PayrollEntryViewSet(ReadOnlyModelViewSet):
    queryset = PayrollEntry.objects.select_related(
        "period__branch__hotel", "employee__user", "department",
    )
    serializer_class = PayrollEntrySerializer
    filterset_fields = ("period", "employee", "department", "period__status")
    search_fields = (
        "employee__user__first_name", "employee__user__last_name",
        "employee__user__employee_code", "department__name",
    )
    ordering_fields = ("employee__user__first_name", "department__name", "gross_pay", "net_pay")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "period__branch")


class SalaryAdvanceRepaymentViewSet(ReadOnlyModelViewSet):
    queryset = SalaryAdvanceRepayment.objects.select_related(
        "advance__employee__user", "advance__employee__branch__hotel", "payroll_entry__period",
    )
    serializer_class = SalaryAdvanceRepaymentSerializer
    filterset_fields = ("advance", "payroll_entry", "payroll_entry__period")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "advance__employee__branch")


class LeaveRequestViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = LeaveRequest.objects.select_related(
        "employee__user", "employee__department", "employee__branch__hotel", "reviewed_by",
    )
    serializer_class = LeaveRequestSerializer
    filterset_fields = ("employee", "employee__department", "employee__branch", "leave_type", "status")
    search_fields = ("employee__user__first_name", "employee__user__last_name", "reason")
    ordering_fields = ("start_date", "end_date", "status", "created_at")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "employee__branch")

    def perform_create(self, serializer):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may record leave requests.")
        employee = serializer.validated_data["employee"]
        ensure_branch_scope(self.request.user, employee.branch)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may edit pending leave requests.")
        serializer.save()

    def _review(self, request, status):
        require_role(request.user, {"HR Manager"}, "Only the HR Manager may review leave requests.")
        with transaction.atomic():
            leave = LeaveRequest.objects.select_for_update().get(pk=self.get_object().pk)
            if leave.status != "pending":
                raise ValidationError("Only pending leave can be reviewed.")
            note = str(request.data.get("note", "")).strip()
            if status == "rejected" and not note:
                raise ValidationError("Provide a rejection reason.")
            leave.status = status
            leave.review_note = note
            leave.reviewed_by = request.user
            leave.reviewed_at = timezone.now()
            leave.save(update_fields=("status", "review_note", "reviewed_by", "reviewed_at", "updated_at"))
        return Response(self.get_serializer(leave).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._review(request, "approved")

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._review(request, "rejected")


class EmployeeDocumentViewSet(CreatedByModelMixin, ModelViewSet):
    parser_classes = (JSONParser, FormParser, MultiPartParser)
    queryset = EmployeeDocument.objects.select_related(
        "employee__user", "employee__department", "employee__branch__hotel",
    )
    serializer_class = EmployeeDocumentSerializer
    filterset_fields = ("employee", "employee__department", "employee__branch", "category", "expiry_date")
    search_fields = ("title", "original_name", "employee__user__first_name", "employee__user__last_name")
    ordering_fields = ("created_at", "expiry_date", "title")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "employee__branch")

    def _require_hr(self):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may manage employee documents.")

    def perform_create(self, serializer):
        self._require_hr()
        employee = serializer.validated_data["employee"]
        ensure_branch_scope(self.request.user, employee.branch)
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_hr()
        serializer.save()

    def perform_destroy(self, instance):
        self._require_hr()
        instance.delete()
