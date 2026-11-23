"""Controlled Uganda payroll calculations and period transitions."""

import calendar
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.employees.models import (
    AttendanceRecord,
    PayrollAffector,
    PayrollEntry,
    PayrollPeriod,
    PayrollProfile,
    SalaryAdvance,
    SalaryAdvanceRepayment,
)


MONEY = Decimal("0.01")
HUNDRED = Decimal("100")
PAYE_RULE_VERSION = "UG-FY2026-27"
NSSF_EMPLOYEE_RATE = Decimal("0.05")
NSSF_EMPLOYER_RATE = Decimal("0.10")


def money(value):
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def uganda_monthly_paye(chargeable_income, *, resident=True):
    """FY2026/27 monthly PAYE bands effective 1 July 2026."""
    income = max(money(chargeable_income), Decimal("0.00"))
    if resident:
        if income <= Decimal("335000"):
            tax = Decimal("0")
        elif income <= Decimal("410000"):
            tax = (income - Decimal("335000")) * Decimal("0.20")
        elif income <= Decimal("485000"):
            tax = Decimal("15000") + (income - Decimal("410000")) * Decimal("0.25")
        elif income <= Decimal("10000000"):
            tax = Decimal("33750") + (income - Decimal("485000")) * Decimal("0.30")
        else:
            tax = (
                Decimal("33750")
                + (income - Decimal("485000")) * Decimal("0.30")
                + (income - Decimal("10000000")) * Decimal("0.10")
            )
    else:
        if income <= Decimal("335000"):
            tax = income * Decimal("0.10")
        elif income <= Decimal("410000"):
            tax = Decimal("33500") + (income - Decimal("335000")) * Decimal("0.20")
        elif income <= Decimal("10000000"):
            tax = Decimal("48500") + (income - Decimal("410000")) * Decimal("0.30")
        else:
            tax = (
                Decimal("48500")
                + (income - Decimal("410000")) * Decimal("0.30")
                + (income - Decimal("10000000")) * Decimal("0.10")
            )
    return money(tax)


def _month_bounds(period):
    days = calendar.monthrange(period.year, period.month)[1]
    return date(period.year, period.month, 1), date(period.year, period.month, days), days


def _affector_amount(affector, basic):
    if affector.calculation_method == PayrollAffector.METHOD_PERCENT_BASIC:
        return money(basic * affector.amount / HUNDRED)
    return money(affector.amount)


def _approved_attendance(employee, month_start, month_end):
    """Fail closed until every eligible calendar day has independently approved evidence.

    Scheduled rest/holiday days and approved paid leave remain payable for a
    monthly salaried employee. Unpaid leave and absence reduce prorated pay.
    Overtime is never inferred from hours: the HR Manager approves its gross
    amount from the employer's verified contractual policy.
    """
    first = max(month_start, employee.date_joined or month_start)
    if first > month_end:
        return Decimal("0.00"), Decimal("0.00"), Decimal("0.00"), []
    records = list(AttendanceRecord.objects.select_related("shift", "approved_by").filter(
        employee=employee, work_date__range=(first, month_end),
    ).order_by("work_date"))
    by_date = {row.work_date: row for row in records}
    total_days = (month_end - first).days + 1
    missing = []
    current = first
    for _ in range(total_days):
        if current not in by_date or not by_date[current].approved_at or not by_date[current].approved_by_id:
            missing.append(current.isoformat())
        current += timedelta(days=1)
    if missing:
        name = employee.user.get_full_name() or employee.user.username
        raise ValidationError(
            f"Approved attendance is incomplete for {name}: "
            f"{len(missing)} day(s) missing or pending, starting {missing[0]}. "
            "Record and independently approve all work, rest, leave and absence days."
        )
    paid = Decimal(sum(1 for row in records if row.status in AttendanceRecord.PAYABLE_STATUSES))
    hours = sum((row.overtime_hours for row in records), Decimal("0.00"))
    overtime = money(sum((row.overtime_pay for row in records), Decimal("0.00")))
    evidence = [
        {"id": str(row.pk), "date": row.work_date.isoformat(),
         "status": row.status, "shift_id": str(row.shift_id) if row.shift_id else None,
         "overtime_hours": str(row.overtime_hours), "overtime_pay": str(row.overtime_pay)}
        for row in records
    ]
    return paid, hours, overtime, evidence


def attendance_coverage(period):
    """Payroll readiness evidence without exposing or paginating every daily row."""
    first_day, last_day, _days = _month_bounds(period)
    profiles = PayrollProfile.objects.select_related(
        "employee__user", "employee__branch", "employee__department",
    ).filter(
        employee__branch=period.branch,
        employee__is_active=True, employee__user__is_active=True, is_active=True,
    )
    rows = []
    for profile in profiles:
        employee = profile.employee
        first = max(first_day, employee.date_joined or first_day)
        expected = max(0, (last_day - first).days + 1)
        attendance = list(AttendanceRecord.objects.filter(
            employee=employee, work_date__range=(first, last_day),
        ).order_by("work_date")) if expected else []
        approved = [line for line in attendance if line.approved_by_id and line.approved_at]
        missing = max(0, expected - len(approved))
        rows.append({
            "employee": str(employee.pk),
            "employee_name": employee.user.get_full_name() or employee.user.username,
            "employee_code": employee.user.employee_code,
            "department_name": employee.department.name,
            "required_days": expected,
            "approved_days": len(approved),
            "pending_days": len(attendance) - len(approved),
            "missing_days": missing,
            "paid_days": sum(1 for line in approved if line.status in AttendanceRecord.PAYABLE_STATUSES),
            "overtime_hours": str(sum((line.overtime_hours for line in approved), Decimal("0.00"))),
            "overtime_pay": str(money(sum((line.overtime_pay for line in approved), Decimal("0.00")))),
            "ready": expected == len(approved),
        })
    return {
        "period": str(period.pk),
        "ready": bool(rows) and all(line["ready"] for line in rows),
        "employee_count": len(rows),
        "missing_day_count": sum(line["missing_days"] for line in rows),
        "employees": rows,
    }


@transaction.atomic
def calculate_period(period, actor):
    period = PayrollPeriod.objects.select_for_update().get(pk=period.pk)
    if period.status not in (PayrollPeriod.STATUS_DRAFT, PayrollPeriod.STATUS_CALCULATED):
        raise ValidationError("Only a draft or calculated payroll can be recalculated.")
    if not ( (2026, 7) <= (period.year, period.month) <= (2027, 6) ):
        raise ValidationError(
            "Installed PAYE rules are verified only for July 2026 through June 2027. "
            "Other periods require an independently validated statutory rule version."
        )
    month_start, month_end, days_in_month = _month_bounds(period)
    profiles = PayrollProfile.objects.select_related(
        "employee__user", "employee__department", "employee__branch",
    ).filter(
        employee__branch=period.branch,
        employee__is_active=True,
        employee__user__is_active=True,
        is_active=True,
    )
    profile_ids = list(profiles.values_list("employee_id", flat=True))
    affectors = list(PayrollAffector.objects.select_related("employee", "department").filter(
        branch=period.branch,
        is_active=True,
        approved_at__isnull=False,
        approved_by__isnull=False,
        effective_from__lte=month_end,
    ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=month_start)))
    advances = list(SalaryAdvance.objects.select_for_update().filter(
        employee_id__in=profile_ids,
        status=SalaryAdvance.STATUS_APPROVED,
        balance__gt=0,
        request_date__lte=month_end,
    ).order_by("request_date", "created_at"))
    advances_by_employee = {}
    for advance in advances:
        advances_by_employee.setdefault(advance.employee_id, []).append(advance)

    active_employee_ids = set()
    for profile in profiles:
        employee = profile.employee
        active_employee_ids.add(employee.pk)
        basic = money(profile.basic_salary)
        matched = [
            affector for affector in affectors
            if affector.employee_id == employee.pk
            or (affector.employee_id is None and affector.department_id == employee.department_id)
        ]
        category_totals = {choice[0]: Decimal("0.00") for choice in PayrollAffector.CATEGORY_CHOICES}
        applied = []
        for affector in matched:
            value = _affector_amount(affector, basic)
            category_totals[affector.category] += value
            applied.append({
                "id": str(affector.pk), "name": affector.name,
                "category": affector.category, "amount": str(value),
            })
        increment = money(category_totals["basic_increment"])
        merit = money(category_totals["merit_increment"])
        new_basic = money(basic + increment + merit)
        days_worked, overtime_hours, overtime_pay, attendance_evidence = _approved_attendance(
            employee, month_start, month_end,
        )
        eligible = money(new_basic * days_worked / Decimal(days_in_month))
        earnings = {
            "arrears": money(category_totals["arrears"]),
            "leave_transport": money(category_totals["leave_transport"]),
            "baggage_allowance": money(category_totals["baggage_allowance"]),
            "service_charge": money(category_totals["service_charge"]),
            "housing_allowance": money(category_totals["housing_allowance"]),
            "other_earnings": money(category_totals["other_earning"] + overtime_pay),
        }
        gross = money(eligible + sum(earnings.values(), Decimal("0.00")))
        nssf_employee = money(gross * NSSF_EMPLOYEE_RATE) if profile.nssf_applicable else Decimal("0.00")
        nssf_employer = money(gross * NSSF_EMPLOYER_RATE) if profile.nssf_applicable else Decimal("0.00")
        local_service_tax = (
            money(profile.local_service_tax_annual / Decimal("4"))
            if period.month in (7, 8, 9, 10) else Decimal("0.00")
        )
        # URA: assessed Local Service Tax is deductible from PAYE chargeable income.
        # Employee NSSF contributions are not deducted when computing PAYE.
        paye = uganda_monthly_paye(
            max(Decimal("0.00"), gross - local_service_tax),
            resident=profile.tax_resident,
        )
        union_dues = money(
            profile.union_dues_monthly + category_totals["union_dues"]
            if profile.union_member else category_totals["union_dues"]
        )
        staff_debtors = money(category_totals["staff_debtor"])
        other_deductions = money(category_totals["other_deduction"])
        advance_plan = []
        advance_deduction = Decimal("0.00")
        for advance in advances_by_employee.get(employee.pk, []):
            instalment = money(min(advance.balance, advance.monthly_installment))
            if instalment <= 0:
                continue
            advance_deduction += instalment
            advance_plan.append({"advance_id": str(advance.pk), "amount": str(instalment)})
        advance_deduction = money(advance_deduction)
        total_deductions = money(
            nssf_employee + paye + local_service_tax + union_dues
            + staff_debtors + advance_deduction + other_deductions
        )
        net = money(gross - total_deductions)
        if net < 0:
            raise ValidationError(
                f"{employee.user.get_full_name() or employee.user.username} has deductions above gross pay."
            )
        defaults = {
            "department": employee.department,
            "joining_date": employee.date_joined,
            "days_in_month": days_in_month,
            "days_worked": days_worked,
            "overtime_hours": overtime_hours,
            "overtime_pay": overtime_pay,
            "old_basic_salary": basic,
            "increment_amount": increment,
            "merit_increment": merit,
            "new_basic_salary": new_basic,
            "eligible_basic_pay": eligible,
            **earnings,
            "gross_pay": gross,
            "nssf_employee": nssf_employee,
            "nssf_employer": nssf_employer,
            "nssf_total": money(nssf_employee + nssf_employer),
            "paye": paye,
            "local_service_tax": local_service_tax,
            "union_dues": union_dues,
            "staff_debtors": staff_debtors,
            "salary_advance": advance_deduction,
            "other_deductions": other_deductions,
            "total_deductions": total_deductions,
            "net_pay": net,
            "bank_name": profile.bank_name,
            "bank_account_name": profile.bank_account_name,
            "bank_account_number": profile.bank_account_number,
            "calculation_detail": {
                "rule_version": PAYE_RULE_VERSION,
                "affectors": applied,
                "advance_repayments": advance_plan,
                "tax_resident": profile.tax_resident,
                "nssf_applicable": profile.nssf_applicable,
                "approved_attendance": attendance_evidence,
                "overtime_pay": str(overtime_pay),
            },
            "created_by": actor,
        }
        entry, _created = PayrollEntry.objects.update_or_create(
            period=period, employee=employee, defaults=defaults,
        )
        entry.full_clean()
    period.entries.exclude(employee_id__in=active_employee_ids).delete()
    period.status = PayrollPeriod.STATUS_CALCULATED
    period.statutory_rule_version = PAYE_RULE_VERSION
    period.calculated_by = actor
    period.calculated_at = timezone.now()
    period.save(update_fields=(
        "status", "statutory_rule_version", "calculated_by", "calculated_at", "updated_at",
    ))
    return period


@transaction.atomic
def submit_period(period, actor, note=""):
    period = PayrollPeriod.objects.select_for_update().get(pk=period.pk)
    if period.status != PayrollPeriod.STATUS_CALCULATED or not period.entries.exists():
        raise ValidationError("Calculate at least one employee before submitting payroll.")
    period.status = PayrollPeriod.STATUS_SUBMITTED
    period.submitted_by = actor
    period.submitted_at = timezone.now()
    period.note = str(note or period.note).strip()
    period.save(update_fields=("status", "submitted_by", "submitted_at", "note", "updated_at"))
    return period


@transaction.atomic
def approve_period(period, actor, note=""):
    period = PayrollPeriod.objects.select_for_update().get(pk=period.pk)
    if period.status != PayrollPeriod.STATUS_SUBMITTED:
        raise ValidationError("Only submitted payroll can be approved.")
    if period.submitted_by_id == actor.pk:
        raise ValidationError("The payroll preparer cannot approve the same payroll.")
    period.status = PayrollPeriod.STATUS_APPROVED
    period.approved_by = actor
    period.approved_at = timezone.now()
    period.note = str(note or period.note).strip()
    period.save(update_fields=("status", "approved_by", "approved_at", "note", "updated_at"))
    return period


@transaction.atomic
def post_period(period, actor):
    period = PayrollPeriod.objects.select_for_update().get(pk=period.pk)
    if period.status != PayrollPeriod.STATUS_APPROVED:
        raise ValidationError("Finance approval is required before payroll posting.")
    entries = list(period.entries.select_for_update())
    if not entries:
        raise ValidationError("This payroll has no employee entries.")
    for entry in entries:
        plans = entry.calculation_detail.get("advance_repayments", [])
        for plan in plans:
            advance = SalaryAdvance.objects.select_for_update().get(
                pk=plan["advance_id"], employee=entry.employee,
            )
            amount = money(plan["amount"])
            if amount <= 0 or amount > advance.balance:
                raise ValidationError("A salary advance balance changed after calculation. Recalculate payroll.")
            SalaryAdvanceRepayment.objects.create(
                advance=advance, payroll_entry=entry, amount=amount, created_by=actor,
            )
            advance.balance = money(advance.balance - amount)
            if advance.balance == 0:
                advance.status = SalaryAdvance.STATUS_REPAID
            advance.save(update_fields=("balance", "status", "updated_at"))
    period.status = PayrollPeriod.STATUS_POSTED
    period.posted_by = actor
    period.posted_at = timezone.now()
    period.save(update_fields=("status", "posted_by", "posted_at", "updated_at"))
    return period
