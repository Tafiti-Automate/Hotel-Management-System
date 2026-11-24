"""Client payroll-header reference tests: exact order, amounts and export safety."""
import csv
from datetime import date
from decimal import Decimal
from io import BytesIO, StringIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from openpyxl import load_workbook
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.employees.models import PayrollPeriod
from apps.employees.payroll_register import (
    REGISTER_COLUMNS, build_register, export_register_csv, export_register_xlsx,
)
from apps.employees.payroll_views import PayrollPeriodViewSet

def fake_user(*role_names):
    user = SimpleNamespace(is_authenticated=True)
    memberships = set(role_names)
    groups = Mock()
    groups.filter.side_effect = lambda **kwargs: SimpleNamespace(
        exists=lambda: bool(memberships.intersection(kwargs.get("name__in", [])))
    )
    user.groups = groups
    return user



class EntryList(list):
    def select_related(self, *_args):
        return self

    def order_by(self, *_args):
        return self


def payroll_fixture(name="Example Worker"):
    user = SimpleNamespace(
        get_full_name=lambda: name, username="example.worker",
        employee_code="HR-009",
    )
    employee = SimpleNamespace(user=user)
    department = SimpleNamespace(name="Housekeeping")
    amounts = {
        "old_basic_salary": "1000000", "increment_amount": "20000",
        "merit_increment": "0", "new_basic_salary": "1020000",
        "eligible_basic_pay": "1020000", "arrears": "0",
        "leave_transport": "0", "baggage_allowance": "0",
        "service_charge": "100000", "other_earnings": "25000",
        "housing_allowance": "0", "gross_pay": "1145000",
        "nssf_employee": "57250", "nssf_employer": "114500",
        "nssf_total": "171750", "paye": "50000",
        "union_dues": "5000", "staff_debtors": "0",
        "salary_advance": "30000", "total_deductions": "142250",
        "net_pay": "1002750",
    }
    entry = SimpleNamespace(
        pk="entry-1", employee=employee, department=department,
        joining_date=date(2026, 2, 15), days_in_month=30,
        days_worked=Decimal("30"), calculation_detail={
            "employee_name": name, "employee_code": "HR-009",
            "department_name": "Housekeeping", "employment_status": "Active",
            "tin_number": "0012345678",
        },
        **{k: Decimal(v) for k, v in amounts.items()},
    )
    period = SimpleNamespace(
        pk="period-1", label="2026-11", year=2026, month=11,
        branch=SimpleNamespace(name="Example Main Property"),
        status=PayrollPeriod.STATUS_POSTED,
        entries=EntryList([entry]),
    )
    return period


def test_client_register_column_order_and_ambiguous_fields_are_explicit():
    headers = [item[1] for item in REGISTER_COLUMNS]
    assert len(headers) == 32
    assert headers[:6] == [
        "S/No.", "Department & Name", "Joining Date",
        "Dept/Section", "Status", "Days in Month",
    ]
    assert headers[7] == "Increment 10%"
    assert headers[16] == "Others / Long Service"
    assert headers[22] == "Gross Income"
    assert headers[23] == "P.A.Y.E."
    assert headers[24] == "Gross Pay"
    assert headers[28] == "Advances"
    assert headers[-2:] == ["Net Pay", "TIN"]


def test_register_uses_snapshots_and_does_not_invent_missing_formulas():
    register = build_register(payroll_fixture())
    row = register["rows"][0]
    assert row["entry_id"] == "entry-1"
    assert row["increment_10_pct"] == Decimal("20000")  # not a forced 10%
    assert row["other_long_service"] == Decimal("25000")  # includes approved OT
    assert row["gross_income"] is None  # client formula unavailable
    assert row["other_advances"] is None  # not a second deduction
    assert row["gross_pay_repeat"] == row["gross_pay"]
    assert row["tin"] == "0012345678"
    assert row["status"] == "Active"
    assert register["totals"]["gross_pay"] == Decimal("1145000")
    assert register["totals"]["total_deductions"] == Decimal("142250")
    assert register["totals"]["net_pay"] == Decimal("1002750")
    assert row["gross_pay"] - row["total_deductions"] == row["net_pay"]
    assert "gross_pay_repeat" not in register["totals"]
    assert "other_advances" not in register["totals"]


def test_csv_export_follows_same_client_layout_and_escapes_spreadsheet_formulas():
    data = build_register(payroll_fixture(name="=SUM(10,10)"))
    response = export_register_csv(data)
    rows = list(csv.reader(StringIO(response.content.decode("utf-8"))))
    headers = [column["label"] for column in data["columns"]]
    assert rows[0] == headers
    assert rows[1][1] == "'=SUM(10,10)"
    assert rows[1][22] == ""
    assert rows[1][28] == ""
    assert rows[1][24] == rows[1][18]  # duplicate visual gross, no extra pay
    assert rows[2][1] == "TOTAL"
    assert "gross_income" in data["unconfirmed"]


def test_xlsx_export_is_landscape_frozen_and_has_numeric_totals():
    data = build_register(payroll_fixture())
    response = export_register_xlsx(data)
    assert response["Content-Type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    workbook = load_workbook(BytesIO(response.content))
    worksheet = workbook.active
    assert worksheet.max_column == 32
    assert worksheet["B5"].value == "Department & Name"
    assert worksheet["W5"].value == "Gross Income"
    assert worksheet["AC5"].value == "Advances"
    assert worksheet["A6"].value == 1
    assert worksheet["G6"].value == 1000000
    assert worksheet["W6"].value is None
    assert worksheet["AC6"].value is None
    assert worksheet["AE6"].value == 1002750
    assert worksheet["AE7"].value == 1002750
    assert worksheet["B7"].value == "TOTAL"
    assert worksheet["AF6"].value == "0012345678"
    assert worksheet.freeze_panes == "C6"
    assert worksheet.page_setup.orientation == "landscape"
    # openpyxl may normalize this OOXML numeric code to int on reload.
    assert str(worksheet.page_setup.paperSize) == str(worksheet.PAPERSIZE_A3)
    assert worksheet.page_setup.fitToWidth == 2
    assert worksheet.print_title_rows == "1:5"


def test_excel_name_is_literal_text_even_if_it_starts_with_equals():
    response = export_register_xlsx(build_register(payroll_fixture(name="=1+2")))
    cell = load_workbook(BytesIO(response.content)).active["B6"]
    assert cell.data_type == "s"
    assert cell.value == "'=1+2"


@pytest.mark.parametrize("method", ("register_csv", "register_xlsx"))
def test_draft_payroll_export_blocked(method):
    view = PayrollPeriodViewSet()
    view.get_object = lambda: SimpleNamespace(status=PayrollPeriod.STATUS_DRAFT)
    with pytest.raises(ValidationError, match="Calculate payroll"):
        getattr(view, method)(SimpleNamespace(user=fake_user("HR Manager")))


@pytest.mark.parametrize("method", ("register_csv", "register_xlsx", "register_layout"))
def test_register_endpoint_rejects_unauthorized_storekeeper(method):
    view = PayrollPeriodViewSet()
    with pytest.raises(PermissionDenied, match="Only"):
        getattr(view, method)(SimpleNamespace(user=fake_user("Store Keeper")))
