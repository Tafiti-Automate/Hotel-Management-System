"""Client-reference hotel payroll register.

The 23-Nov-2026 image provides headings and ordering, NOT workbook formulas.
All populated amounts come from the approved payroll entry snapshot. Ambiguous
reference columns remain blank rather than fabricating a separate calculation.
Both the REST register, CSV and Excel use the exact same dataset.
"""
from datetime import date
from decimal import Decimal
from io import BytesIO

from django.http import HttpResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


# key, client-reference heading, cell type, Excel width
REGISTER_COLUMNS = (
    ("serial", "S/No.", "number", 7),
    ("department_and_name", "Department & Name", "text", 29),
    ("joining_date", "Joining Date", "date", 14),
    ("dept_section", "Dept/Section", "text", 23),
    ("status", "Status", "text", 13),
    ("days_in_month", "Days in Month", "number", 12),
    ("old_basic_salary", "Old Basic Salary", "money", 19),
    ("increment_10_pct", "Increment 10%", "money", 17),
    ("merit_increment", "Incr. Merit", "money", 16),
    ("new_basic_salary", "New Basic Salary", "money", 20),
    ("days_worked", "Days Worked", "number", 13),
    ("eligible_basic_pay", "Eligible Basic Pay", "money", 20),
    ("arrears", "Arrears", "money", 16),
    ("leave_transport", "Leave Transport", "money", 17),
    ("baggage_allowance", "Baggage Allow.", "money", 18),
    ("service_charge", "Service Chrg. & Breakages", "money", 23),
    ("other_long_service", "Others / Long Service", "money", 20),
    ("housing_allowance", "Housing Allowance", "money", 19),
    ("gross_pay", "Gross Pay", "money", 20),
    ("nssf_employee", "5% N.S.S.F.", "money", 17),
    ("nssf_employer", "N.S.S.F. Cont.", "money", 17),
    ("nssf_total", "Total NSSF", "money", 18),
    ("gross_income", "Gross Income", "money", 20),
    ("paye", "P.A.Y.E.", "money", 19),
    ("gross_pay_repeat", "Gross Pay", "money", 20),
    ("union_dues", "Union Dues", "money", 16),
    ("staff_debtors", "Staff Debtors", "money", 18),
    ("salary_advance", "Salary Advance", "money", 19),
    ("other_advances", "Advances", "money", 18),
    ("total_deductions", "Total Deduct.", "money", 20),
    ("net_pay", "Net Pay", "money", 20),
    ("tin", "TIN", "text", 20),
)
REGISTER_NOTES = (
    "CLIENT TEMPLATE: Columns follow the supplied payroll header image; this does not establish the source spreadsheet's formulas.",
    "Increment 10%: Shows only an individually approved basic increment, NOT an automatic 10% increase.",
    "Others / Long Service: Currently includes the payroll engine's Other Earnings (including approved overtime); no separate long-service formula is assumed.",
    "Gross Income: Blank until the client confirms how it differs from Gross Pay and statutory chargeable income.",
    "Second Gross Pay: Repeats the original Gross Pay for visual parity, not as an additional earning.",
    "Advances: Blank until the client explains how this differs from Salary Advance; no duplicate deduction is made.",
    "NSSF Contribution and Total NSSF include the employer contribution as informational amounts; only employee NSSF is deducted from Net Pay.",
    "TIN and employee status are frozen when payroll is calculated; legacy payrolls without snapshots leave these fields blank.",
    "All amounts are UGX. Only calculated, submitted, approved or posted periods are exportable. Exports are not payment instructions.",
)

INTEGER_FORMAT = '#,##0'
MONEY_FORMAT = '#,##0.00;[Red](#,##0.00);"-"'


def _snapshot(entry):
    return entry.calculation_detail or {}


def _display_name(entry, details):
    # Legacy periods did not capture names: retain a display-only fallback.
    user = entry.employee.user
    return details.get("employee_name") or user.get_full_name() or user.username


def build_register(period):
    """Generate snapshot-derived rows and independent column totals.

    Unknown source-formula fields stay null, and a duplicate Gross Pay is a
    display-only copy rather than a second addition to earnings.
    """
    entries = period.entries.select_related(
        "employee__user", "department",
    ).order_by("department__name", "employee__user__first_name", "employee__user__last_name", "pk")

    columns = [
        {"key": key, "label": heading, "kind": kind, "width": width}
        for key, heading, kind, width in REGISTER_COLUMNS
    ]
    rows = []
    totalable = {
        "old_basic_salary", "increment_10_pct", "merit_increment",
        "new_basic_salary", "eligible_basic_pay", "arrears", "leave_transport",
        "baggage_allowance", "service_charge", "other_long_service",
        "housing_allowance", "gross_pay", "nssf_employee", "nssf_employer",
        "nssf_total", "paye", "union_dues", "staff_debtors", "salary_advance",
        "total_deductions", "net_pay",
    }
    totals = {key: Decimal("0.00") for key in totalable}
    for index, entry in enumerate(entries, 1):
        detail = _snapshot(entry)
        name = _display_name(entry, detail)
        department = detail.get("department_name") or entry.department.name
        row = {
            # UI metadata, not columns in client payroll template.
            "entry_id": str(entry.pk),
            "employee_code": detail.get("employee_code") or entry.employee.user.employee_code,
            "serial": index,
            "department_and_name": name,
            "joining_date": entry.joining_date.isoformat() if entry.joining_date else "",
            "dept_section": department,
            "status": detail.get("employment_status", ""),
            "days_in_month": entry.days_in_month,
            "old_basic_salary": entry.old_basic_salary,
            "increment_10_pct": entry.increment_amount,
            "merit_increment": entry.merit_increment,
            "new_basic_salary": entry.new_basic_salary,
            "days_worked": entry.days_worked,
            "eligible_basic_pay": entry.eligible_basic_pay,
            "arrears": entry.arrears,
            "leave_transport": entry.leave_transport,
            "baggage_allowance": entry.baggage_allowance,
            "service_charge": entry.service_charge,
            "other_long_service": entry.other_earnings,
            "housing_allowance": entry.housing_allowance,
            "gross_pay": entry.gross_pay,
            "nssf_employee": entry.nssf_employee,
            "nssf_employer": entry.nssf_employer,
            "nssf_total": entry.nssf_total,
            "gross_income": None,
            "paye": entry.paye,
            "gross_pay_repeat": entry.gross_pay,
            "union_dues": entry.union_dues,
            "staff_debtors": entry.staff_debtors,
            "salary_advance": entry.salary_advance,
            "other_advances": None,
            "total_deductions": entry.total_deductions,
            "net_pay": entry.net_pay,
            "tin": detail.get("tin_number", ""),
        }
        # Preserve existing amounts and independently reconcile them to the
        # immutable entry. These columns are not computed from the screenshot.
        for key in totalable:
            totals[key] += row[key]
        rows.append(row)
    return {
        "period": str(period.pk),
        "period_label": period.label,
        "property": period.branch.name,
        "status": period.status,
        "currency": "UGX",
        "columns": columns,
        "rows": rows,
        "totals": totals,
        "notes": list(REGISTER_NOTES),
        "unconfirmed": ["gross_income", "other_advances"],
    }


def _safe_csv_text(value):
    """Prevent formula injection from employee, department and TIN fields."""
    content = str(value) if value is not None else ""
    if content.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + content
    return content


def export_register_csv(register):
    import csv

    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = (
        'attachment; filename="payroll-register-%s.csv"' % register["period_label"]
    )
    writer = csv.writer(response)
    columns = register["columns"]
    writer.writerow([column["label"] for column in columns])
    for row in register["rows"]:
        writer.writerow([
            _safe_csv_text(row.get(column["key"]))
            if column["kind"] in ("text", "date") else row.get(column["key"])
            for column in columns
        ])
    writer.writerow([
        register["totals"].get(column["key"], "")
        if column["kind"] == "money" else "TOTAL" if column["key"] == "department_and_name" else ""
        for column in columns
    ])
    writer.writerow([])
    for note in register["notes"]:
        writer.writerow(["NOTE", note])
    return response


def export_register_xlsx(register):
    """A3 landscape Excel workbook with frozen names and repeated headings."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Payroll Register"
    ws.sheet_view.showGridLines = False
    last_col = get_column_letter(len(register["columns"]))
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(register["columns"]))
    ws["A1"] = "HOTEL ERP · MONTHLY PAYROLL REGISTER"
    ws["A1"].font = Font(name="Aptos", size=15, bold=True, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor="174B37")
    ws["A1"].alignment = Alignment(vertical="center")
    ws.row_dimensions[1].height = 31
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(register["columns"]))
    ws["A2"] = (
        f'{register["property"]}  |  {register["period_label"]}  |  '
        f'{register["status"].upper()}  |  Currency: UGX'
    )
    ws["A2"].font = Font(name="Aptos", size=11, bold=True, color="2B4B3E")
    ws.row_dimensions[2].height = 22
    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=len(register["columns"]))
    ws["A3"] = "CONFIDENTIAL · HR / FINANCE ONLY · Client-reference columns; unconfirmed formula fields left blank"
    ws["A3"].font = Font(name="Aptos", italic=True, size=10, color="925F1D")
    ws.row_dimensions[3].height = 22

    header_row = 5
    ws.row_dimensions[header_row].height = 43
    header_fill = PatternFill("solid", fgColor="E7F0E9")
    foot_fill = PatternFill("solid", fgColor="DFEEE3")
    border = Border(bottom=Side(style="hair", color="CBDAD0"))
    for col_num, col in enumerate(register["columns"], 1):
        key, label, kind = col["key"], col["label"], col["kind"]
        letter = get_column_letter(col_num)
        ws.column_dimensions[letter].width = col["width"]
        cell = ws.cell(header_row, col_num, label)
        cell.fill = header_fill
        cell.font = Font(name="Aptos", size=9, bold=True, color="214937")
        cell.alignment = Alignment(vertical="center", horizontal="center", wrap_text=True)
        cell.border = border
        if key in register["unconfirmed"]:
            cell.fill = PatternFill("solid", fgColor="FFF0D2")
    for row_index, row in enumerate(register["rows"], header_row + 1):
        ws.row_dimensions[row_index].height = 21
        for column_index, col in enumerate(register["columns"], 1):
            key, kind = col["key"], col["kind"]
            value = row.get(key)
            cell = ws.cell(row_index, column_index)
            if kind == "money" and value is not None:
                cell.value = float(value)
                cell.number_format = MONEY_FORMAT
            elif kind == "number" and value is not None:
                cell.value = float(value)
                cell.number_format = INTEGER_FORMAT if key in ("serial", "days_in_month") else MONEY_FORMAT
            elif kind == "date" and value:
                cell.value = date.fromisoformat(value)
                cell.number_format = "dd mmm yyyy"
            else:
                cell.value = _safe_csv_text(value)
                cell.data_type = "s"
            cell.alignment = Alignment(
                vertical="center", horizontal="right" if kind in ("money", "number") else "left",
                indent=1 if kind == "text" else 0,
            )
            cell.border = border
            cell.font = Font(name="Aptos", size=9, color="223A30")
            if row_index % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F5F8F5")
    total_row = header_row + 1 + len(register["rows"])
    for column_index, col in enumerate(register["columns"], 1):
        key = col["key"]
        cell = ws.cell(total_row, column_index)
        if key == "department_and_name":
            cell.value = "TOTAL"
        elif key in register["totals"]:
            cell.value = float(register["totals"][key])
            cell.number_format = MONEY_FORMAT
        cell.fill = foot_fill
        cell.font = Font(name="Aptos", size=9, bold=True, color="153F29")
        cell.alignment = Alignment(vertical="center", horizontal="right" if key in register["totals"] else "left")
    ws.row_dimensions[total_row].height = 26

    note_row = total_row + 2
    for number, note in enumerate(register["notes"]):
        current = note_row + number
        ws.merge_cells(start_row=current, start_column=1, end_row=current, end_column=len(register["columns"]))
        cell = ws.cell(current, 1, note)
        cell.font = Font(name="Aptos", italic=True, size=9, color="6F5837")
        cell.alignment = Alignment(wrap_text=True, vertical="center")
        ws.row_dimensions[current].height = 25

    ws.freeze_panes = "C6"
    ws.auto_filter.ref = f"A5:{last_col}{max(header_row + 1, total_row - 1)}"
    ws.print_title_rows = "1:5"
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    # Two landscape sheets across for legible 32-column payroll review.
    ws.page_setup.fitToWidth = 2
    ws.page_setup.fitToHeight = 0
    ws.print_options.horizontalCentered = False
    ws.print_area = f"A1:{last_col}{note_row + len(register['notes']) - 1}"

    stream = BytesIO()
    wb.save(stream)
    stream.seek(0)
    response = HttpResponse(
        stream.read(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = (
        'attachment; filename="payroll-register-%s.xlsx"' % register["period_label"]
    )
    return response
