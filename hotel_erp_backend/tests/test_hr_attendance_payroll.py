"""Daily payroll evidence, Uganda statutory bands, and independent HR/Finance controls."""
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import (
    AttendanceRecord, Employee, LeaveRequest, PayrollEntry, PayrollPeriod,
    PayrollProfile, ShiftTemplate,
)
from apps.employees.payroll_services import (
    attendance_coverage, calculate_period, money, uganda_monthly_paye,
    approve_period, submit_period, post_period,
)


@pytest.fixture
def payroll_people(db):
    call_command("setup_hotel_roles", verbosity=0)
    branch = Branch.objects.create(name="HR Attendance Test Property")
    other_branch = Branch.objects.create(name="HR Other Property")
    department = Department.objects.create(name="HR Attendance Service")
    def person(code, role=None):
        user = get_user_model().objects.create_user(
            username="hr-test-" + code, employee_code="HR-ATT-" + code,
            password="test-pass-123", first_name=code, last_name="Employee",
        )
        if role:
            user.groups.add(Group.objects.get(name=role))
        employee = Employee.objects.create(
            user=user, department=department, branch=branch,
            designation=role or "Staff", date_joined=date(2026, 10, 1),
        )
        return user, employee
    preparer, _ = person("MAKER", "Payroll Officer")
    manager, _ = person("CHECKER", "HR Manager")
    finance, _ = person("FINANCE", "Financial Manager")
    staff, employee = person("WORKER")
    profile = PayrollProfile.objects.create(
        employee=employee, basic_salary=Decimal("3100000.00"),
        local_service_tax_annual=Decimal("120000.00"), nssf_applicable=True,
    )
    period = PayrollPeriod.objects.create(branch=branch, year=2026, month=10)
    return {
        "branch": branch, "other_branch": other_branch, "department": department,
        "employee": employee, "profile": profile, "period": period,
        "preparer": preparer, "manager": manager, "finance": finance, "staff": staff,
    }


def record_october_days(ctx, *, absent_day=5, leave_day=10, overtime_day=1):
    """Month-wide independent approvals, including paid rest and approved leave."""
    LeaveRequest.objects.create(
        employee=ctx["employee"], leave_type="annual", start_date=date(2026, 10, leave_day),
        end_date=date(2026, 10, leave_day), days=Decimal("1"),
        status="approved", reviewed_by=ctx["manager"], reviewed_at=timezone.now(),
    )
    rows=[]
    for day in range(1, 32):
        status = (
            "absent" if day == absent_day else
            "paid_leave" if day == leave_day else
            "rest" if date(2026, 10, day).weekday() == 6 else
            "present"
        )
        ot = day == overtime_day
        rows.append(AttendanceRecord(
            employee=ctx["employee"], work_date=date(2026, 10, day), status=status,
            worked_hours=Decimal("8") if status == "present" else Decimal("0"),
            overtime_hours=Decimal("2") if ot else Decimal("0"),
            overtime_pay=Decimal("20000") if ot else Decimal("0"),
            note="Approved payroll overtime policy" if ot else "",
            approved_by=ctx["manager"], approved_at=timezone.now(),
            created_by=ctx["preparer"],
        ))
    AttendanceRecord.objects.bulk_create(rows)


@pytest.mark.parametrize(("income", "resident", "expected"), [
    ("0", True, "0"), ("335000", True, "0"),
    ("410000", True, "15000"), ("485000", True, "33750"),
    ("500000", True, "38250"), ("1000000", True, "188250"),
    ("335000", False, "33500"), ("410000", False, "48500"),
])
def test_fy2026_27_ura_paye_bands(income, resident, expected):
    assert uganda_monthly_paye(Decimal(income), resident=resident) == money(expected)


@pytest.mark.django_db
def test_payroll_cannot_guess_worked_days_without_approved_attendance(payroll_people):
    ctx=payroll_people
    readiness=attendance_coverage(ctx["period"])
    assert readiness["ready"] is False
    assert readiness["missing_day_count"] == 31
    with pytest.raises(ValidationError, match="Approved attendance is incomplete"):
        calculate_period(ctx["period"], ctx["preparer"])
    assert not PayrollEntry.objects.filter(period=ctx["period"]).exists()


@pytest.mark.django_db
def test_approved_absence_paid_leave_and_overtime_feed_posted_payroll(payroll_people):
    ctx=payroll_people
    record_october_days(ctx)
    readiness=attendance_coverage(ctx["period"])
    assert readiness["ready"] is True
    assert readiness["missing_day_count"] == 0
    period=calculate_period(ctx["period"], ctx["preparer"])
    entry=PayrollEntry.objects.get(period=period, employee=ctx["employee"])
    assert entry.days_worked == Decimal("30")
    assert entry.overtime_hours == Decimal("2")
    assert entry.overtime_pay == Decimal("20000")
    assert entry.eligible_basic_pay == Decimal("3000000.00")
    assert entry.other_earnings == Decimal("20000.00")
    assert entry.gross_pay == Decimal("3020000.00")
    assert entry.local_service_tax == Decimal("30000.00")
    assert entry.paye == uganda_monthly_paye(Decimal("2990000"), resident=True)
    assert entry.nssf_employee == Decimal("151000.00")
    assert entry.nssf_employer == Decimal("302000.00")
    assert len(entry.calculation_detail["approved_attendance"]) == 31
    assert entry.calculation_detail["overtime_pay"] == "20000.00"
    period=submit_period(period, ctx["preparer"])
    period=approve_period(period, ctx["finance"])
    period=post_period(period, ctx["finance"])
    assert period.status == PayrollPeriod.STATUS_POSTED
    with pytest.raises(ValidationError, match="Finance approval is required"):
        post_period(period, ctx["finance"])


@pytest.mark.django_db
def test_paid_leave_requires_matching_approved_leave_record(payroll_people):
    ctx=payroll_people
    record=AttendanceRecord(
        employee=ctx["employee"], work_date=date(2026, 10, 12), status="paid_leave",
    )
    with pytest.raises(ValidationError, match="approved matching leave"):
        record.full_clean()
    leave=LeaveRequest.objects.create(
        employee=ctx["employee"], leave_type="annual", start_date=date(2026, 10, 12),
        end_date=date(2026, 10, 12), days=Decimal("1"),
        status="approved", reviewed_by=ctx["manager"], reviewed_at=timezone.now(),
    )
    record.full_clean()


@pytest.mark.django_db
def test_attendance_api_maker_checker_and_lock_after_calculation(payroll_people):
    ctx=payroll_people
    creator=APIClient()
    creator.force_authenticate(ctx["preparer"])
    reviewer=APIClient()
    reviewer.force_authenticate(ctx["manager"])
    path="/api/v1/attendance-records/"
    created=creator.post(path,{
        "employee":str(ctx["employee"].pk),
        "work_date":"2026-10-02","status":"present",
        "worked_hours":"8.00","overtime_hours":"0.00","overtime_pay":"0.00",
    },format="json")
    assert created.status_code == 201, created.data
    identifier=created.data["id"]
    assert creator.post(f"{path}{identifier}/approve/",{},format="json").status_code == 403
    reviewed=reviewer.post(f"{path}{identifier}/approve/",{},format="json")
    assert reviewed.status_code == 200, reviewed.data
    assert reviewer.patch(f"{path}{identifier}/",{"worked_hours":"10.00"},format="json").status_code == 400
    with pytest.raises(ValidationError, match="Approved attendance is incomplete"):
        calculate_period(ctx["period"],ctx["preparer"])
    # The period becomes locked after a valid payroll calculation.
    AttendanceRecord.objects.filter(pk=identifier).delete()
    record_october_days(ctx)
    calculate_period(ctx["period"],ctx["preparer"])
    attempted=creator.post(path,{
        "employee":str(ctx["employee"].pk),
        "work_date":"2026-10-03","status":"present",
        "worked_hours":"8.00","overtime_hours":"0.00","overtime_pay":"0.00",
    },format="json")
    assert attempted.status_code == 400, attempted.data


@pytest.mark.django_db
def test_night_shift_handles_midnight_and_rejects_invalid_break(payroll_people):
    ctx=payroll_people
    shift=ShiftTemplate(
        branch=ctx["branch"], name="Night", starts_at=time(22, 0),
        ends_at=time(6, 0), unpaid_break_minutes=30,
    )
    shift.full_clean()
    shift.unpaid_break_minutes=500
    with pytest.raises(ValidationError, match="Break time"):
        shift.full_clean()


@pytest.mark.django_db
def test_overtime_requires_policy_evidence_and_positive_worked_hours(payroll_people):
    ctx=payroll_people
    row=AttendanceRecord(
        employee=ctx["employee"], work_date=date(2026, 10, 4),
        status="present", worked_hours=Decimal("8"),
        overtime_hours=Decimal("2"), overtime_pay=Decimal("20000"),
    )
    with pytest.raises(ValidationError, match="approved shift"):
        row.full_clean()
    row.note="Approved manager overtime reference"
    row.full_clean()
    row.worked_hours=Decimal("0")
    with pytest.raises(ValidationError, match="positive worked-hours"):
        row.full_clean()


@pytest.mark.django_db
def test_partial_unpaid_leave_does_not_deduct_whole_day(payroll_people):
    ctx=payroll_people
    LeaveRequest.objects.create(
        employee=ctx["employee"], leave_type="unpaid", start_date=date(2026, 10, 8),
        end_date=date(2026, 10, 8), days=Decimal("0.50"),
        status="approved", reviewed_by=ctx["manager"], reviewed_at=timezone.now(),
    )
    row=AttendanceRecord(
        employee=ctx["employee"], work_date=date(2026, 10, 8),
        status="unpaid_leave",
    )
    with pytest.raises(ValidationError, match="Partial-day unpaid leave"):
        row.full_clean()


@pytest.mark.django_db
def test_payroll_rejects_periods_outside_verifiable_fy2026_27_rules(payroll_people):
    ctx=payroll_people
    period=ctx["period"]
    period.year=2027
    period.month=7
    period.save(update_fields=["year", "month", "updated_at"])
    with pytest.raises(ValidationError, match="verified only for July 2026 through June 2027"):
        calculate_period(period, ctx["preparer"])
    assert not PayrollEntry.objects.filter(period=period).exists()
