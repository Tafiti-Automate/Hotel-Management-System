"""Property-scoped attendance and shift services with independent approvals."""
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.employees.models import AttendanceRecord, PayrollPeriod, ShiftTemplate
from apps.employees.payroll_serializers import AttendanceRecordSerializer, ShiftTemplateSerializer
from apps.employees.payroll_views import (
    HR_ROLES, ensure_branch_scope, payroll_scope, require_role,
)
from core.mixins.viewsets import CreatedByModelMixin


def assert_unlocked_attendance(employee, work_date):
    if not employee.branch_id:
        raise ValidationError("Assign the employee to a property before recording attendance.")
    period = PayrollPeriod.objects.select_for_update().filter(
        branch_id=employee.branch_id, year=work_date.year, month=work_date.month,
    ).first()
    if period and period.status != PayrollPeriod.STATUS_DRAFT:
        raise ValidationError(
            "This payroll month has already been calculated or submitted. "
            "Attendance cannot be changed without a controlled payroll reopening."
        )


class ShiftTemplateViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = ShiftTemplate.objects.select_related("branch__hotel")
    serializer_class = ShiftTemplateSerializer
    filterset_fields = ("branch", "is_active")
    search_fields = ("name", "branch__name")
    ordering_fields = ("starts_at", "name")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "branch")

    def perform_create(self, serializer):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may manage shifts.")
        ensure_branch_scope(self.request.user, serializer.validated_data["branch"])
        super().perform_create(serializer)

    def perform_update(self, serializer):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may manage shifts.")
        ensure_branch_scope(self.request.user, serializer.validated_data.get("branch", serializer.instance.branch))
        if serializer.instance.attendance_records.exists():
            raise ValidationError("A used shift is historical evidence. Create a new shift rather than changing it.")
        serializer.save()

    def perform_destroy(self, instance):
        require_role(self.request.user, {"HR Manager"}, "Only an HR Manager may retire shifts.")
        if instance.attendance_records.exists():
            raise ValidationError("A shift with attendance records cannot be deleted.")
        instance.delete()


class AttendanceRecordViewSet(CreatedByModelMixin, ModelViewSet):
    queryset = AttendanceRecord.objects.select_related(
        "employee__user", "employee__branch__hotel", "employee__department",
        "shift", "approved_by",
    )
    serializer_class = AttendanceRecordSerializer
    filterset_fields = (
        "employee", "employee__branch", "work_date", "status", "shift", "approved_by",
    )
    search_fields = (
        "employee__user__first_name", "employee__user__last_name",
        "employee__user__employee_code", "note",
    )
    ordering_fields = ("work_date", "employee__user__first_name", "created_at")

    def get_queryset(self):
        return payroll_scope(super().get_queryset(), self.request.user, "employee__branch")

    @transaction.atomic
    def perform_create(self, serializer):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may prepare daily attendance.")
        employee = serializer.validated_data["employee"]
        ensure_branch_scope(self.request.user, employee.branch)
        assert_unlocked_attendance(employee, serializer.validated_data["work_date"])
        super().perform_create(serializer)

    @transaction.atomic
    def perform_update(self, serializer):
        require_role(self.request.user, HR_ROLES, "Only Human Resources may correct unapproved attendance.")
        old = serializer.instance
        if old.approved_at:
            raise ValidationError("Approved attendance is immutable.")
        assert_unlocked_attendance(old.employee, old.work_date)
        employee = serializer.validated_data.get("employee", old.employee)
        date = serializer.validated_data.get("work_date", old.work_date)
        ensure_branch_scope(self.request.user, employee.branch)
        assert_unlocked_attendance(employee, date)
        serializer.save()

    @transaction.atomic
    def perform_destroy(self, instance):
        require_role(self.request.user, {"HR Manager"}, "Only the HR Manager may remove unapproved attendance.")
        if instance.approved_at:
            raise ValidationError("Approved attendance is immutable.")
        assert_unlocked_attendance(instance.employee, instance.work_date)
        instance.delete()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        require_role(request.user, {"HR Manager"}, "Only an HR Manager may approve daily attendance.")
        with transaction.atomic():
            row = AttendanceRecord.objects.select_for_update().get(pk=self.get_object().pk)
            ensure_branch_scope(request.user, row.employee.branch)
            assert_unlocked_attendance(row.employee, row.work_date)
            if row.approved_at or row.approved_by_id:
                raise ValidationError("This attendance line is already approved.")
            if row.created_by_id == request.user.pk:
                raise ValidationError("The person recording attendance cannot approve their own line.")
            row.full_clean()
            row.approved_by = request.user
            row.approved_at = timezone.now()
            row.save(update_fields=("approved_by", "approved_at", "updated_at"))
        return Response(self.get_serializer(row).data)
