"""Read-only inventory GL preview should never create posted journals."""
from decimal import Decimal
from uuid import uuid4
import pytest
from django.utils import timezone
from apps.inventory.models import StockLedger
from apps.materials_control.models import FiscalPeriod, GLAccountMapping, GLExport
from core.constants.choices import LedgerReferenceType
from tests.test_materials_control import materials_context

@pytest.mark.django_db
def test_candidate_journals_balanced_exclude_supplier_receipts(materials_context):
    user, employee, department, branch, store, unit, item = materials_context
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(branch=branch, name="Inventory journal preview",
        start_date=today.replace(day=1), end_date=today)
    for source in (LedgerReferenceType.POS_DEPLETION, LedgerReferenceType.WASTE,
                   LedgerReferenceType.GRN_RECEIPT):
        inbound = source == LedgerReferenceType.GRN_RECEIPT
        StockLedger.objects.create(item=item, store=store, reference_type=source,
            reference_id=uuid4(), quantity_in=Decimal("1") if inbound else Decimal("0"),
            quantity_out=Decimal("0") if inbound else Decimal("1"),
            unit_cost_snapshot=Decimal("125.0000"), total_cost_snapshot=Decimal("125.0000"),
            wac_before=Decimal("125.0000"), wac_after=Decimal("125.0000"))
    assert not period.inventory_gl_journal_preview()["ready_for_finance_review"]
    GLAccountMapping.objects.create(branch=branch, source_type=GLAccountMapping.SOURCE_POS_COGS,
        debit_account="COGS", credit_account="STOCK")
    GLAccountMapping.objects.create(branch=branch, source_type=GLAccountMapping.SOURCE_WASTE,
        debit_account="WASTE", credit_account="STOCK")
    result = period.inventory_gl_journal_preview()
    assert result["ready_for_finance_review"]
    assert result["candidate_row_count"] == 4
    assert result["debit_total"] == result["credit_total"] == "250.00"
    assert result["excluded_source_counts"]["grn_receipt"] == 1
    assert result["posted"] is False
    assert GLExport.objects.count() == 0

@pytest.mark.django_db
def test_missing_historical_cost_blocks_all_preview_rows(materials_context):
    user, employee, department, branch, store, unit, item = materials_context
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(branch=branch, name="Unknown cost",
        start_date=today.replace(day=1), end_date=today)
    GLAccountMapping.objects.create(branch=branch, source_type=GLAccountMapping.SOURCE_CONSUMPTION,
        debit_account="DEPT", credit_account="STOCK")
    StockLedger.objects.create(item=item, store=store, reference_type=LedgerReferenceType.STOCK_ISSUE,
        reference_id=uuid4(), quantity_out=Decimal("2"))
    result = period.inventory_gl_journal_preview()
    assert not result["ready_for_finance_review"]
    assert result["draft_rows"] == []
    assert "Missing historical cost" in result["blockers"][0]

@pytest.mark.django_db
def test_stock_count_surplus_reverses_mapping_direction(materials_context):
    user, employee, department, branch, store, unit, item = materials_context
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(branch=branch, name="Surplus",
        start_date=today.replace(day=1), end_date=today)
    GLAccountMapping.objects.create(branch=branch, source_type=GLAccountMapping.SOURCE_VARIANCE,
        debit_account="VARIANCE", credit_account="STOCK")
    StockLedger.objects.create(item=item, store=store, reference_type=LedgerReferenceType.STOCK_COUNT,
        reference_id=uuid4(), quantity_in=Decimal("3"),
        unit_cost_snapshot=Decimal("20.0000"), total_cost_snapshot=Decimal("60.0000"),
        wac_before=Decimal("20.0000"), wac_after=Decimal("20.0000"))
    rows = period.inventory_gl_journal_preview()["draft_rows"]
    assert rows[0]["account"] == "STOCK" and rows[0]["debit"] == "60.00"
    assert rows[1]["account"] == "VARIANCE" and rows[1]["credit"] == "60.00"

@pytest.mark.django_db
def test_closed_period_export_includes_historical_inventory_gl_without_supplier_receipt_double_count(materials_context):
    import csv
    import io
    from uuid import uuid4
    from core.constants.choices import LedgerReferenceType

    user, _employee, _department, branch, store, _unit, item = materials_context
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Balanced stock GL export",
        start_date=today.replace(day=1), end_date=today,
    )
    for source in (LedgerReferenceType.POS_DEPLETION, LedgerReferenceType.WASTE,
                   LedgerReferenceType.GRN_RECEIPT):
        inbound = source == LedgerReferenceType.GRN_RECEIPT
        StockLedger.objects.create(
            item=item, store=store, reference_type=source, reference_id=uuid4(),
            quantity_in=Decimal("1") if inbound else Decimal("0"),
            quantity_out=Decimal("0") if inbound else Decimal("1"),
            unit_cost_snapshot=Decimal("125.0000"),
            total_cost_snapshot=Decimal("125.0000"),
            wac_before=Decimal("125.0000"), wac_after=Decimal("125.0000"),
        )
    GLAccountMapping.objects.create(
        branch=branch, source_type=GLAccountMapping.SOURCE_POS_COGS,
        debit_account="COGS-5100", credit_account="STOCK-1400",
    )
    GLAccountMapping.objects.create(
        branch=branch, source_type=GLAccountMapping.SOURCE_WASTE,
        debit_account="WASTE-5200", credit_account="STOCK-1400",
    )
    period.close(user, "Posted consumption and expense journals reconciled.")
    export = GLExport.generate(period, user)
    rows = list(csv.DictReader(io.StringIO(export.payload)))
    assert export.row_count == 4
    assert {row["source"] for row in rows} == {
        LedgerReferenceType.POS_DEPLETION, LedgerReferenceType.WASTE,
    }
    assert sum(Decimal(row["debit"]) for row in rows) == Decimal("250.00")
    assert sum(Decimal(row["credit"]) for row in rows) == Decimal("250.00")
    assert {row["account"] for row in rows} == {"COGS-5100", "WASTE-5200", "STOCK-1400"}
    assert all(row["description"].startswith("Inventory movement ") for row in rows)
    assert GLExport.generate(period, user).pk == export.pk
    assert GLExport.objects.filter(period=period).count() == 1


@pytest.mark.django_db
def test_missing_stock_valuation_refuses_partial_financial_export(materials_context):
    from uuid import uuid4
    from django.core.exceptions import ValidationError
    from core.constants.choices import LedgerReferenceType

    user, _employee, _department, branch, store, _unit, item = materials_context
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Missing stock cost GL export",
        start_date=today.replace(day=1), end_date=today,
    )
    GLAccountMapping.objects.create(
        branch=branch, source_type=GLAccountMapping.SOURCE_WASTE,
        debit_account="WASTE-5200", credit_account="STOCK-1400",
    )
    StockLedger.objects.create(
        item=item, store=store, reference_type=LedgerReferenceType.WASTE,
        reference_id=uuid4(), quantity_out=Decimal("1"),
    )
    period.close(user, "No unresolved operational documents.")
    with pytest.raises(ValidationError, match="Missing historical cost"):
        GLExport.generate(period, user)
    assert GLExport.objects.count() == 0


@pytest.mark.django_db
def test_finance_only_gl_export_download_and_list(materials_context):
    from django.contrib.auth import get_user_model
    from django.contrib.auth.models import Group
    from django.core.management import call_command
    from rest_framework.test import APIClient
    from apps.employees.models import Employee

    original_user, _employee, department, branch, _store, _unit, _item = materials_context
    call_command("setup_hotel_roles", verbosity=0)
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Private financial evidence",
        start_date=today.replace(day=1), end_date=today,
    )
    import hashlib
    payload = "date,source,reference,department,description,account,debit,credit\\n"
    export = GLExport.objects.create(
        period=period, generated_by=original_user,
        row_count=1, checksum=hashlib.sha256(payload.encode("utf-8")).hexdigest(),
        payload=payload,
    )
    finance_user = get_user_model().objects.create_user(
        username="finance-download-acceptance",
        employee_code="GL-FIN-READ", password="test-password",
    )
    finance_user.groups.add(Group.objects.get(name="Financial Manager"))
    Employee.objects.create(
        user=finance_user, branch=branch, department=department,
        designation="Financial Manager",
    )
    operational = get_user_model().objects.create_user(
        username="store-download-not-allowed",
        employee_code="GL-STORE-DENY", password="test-password",
    )
    operational.groups.add(Group.objects.get(name="Store Keeper"))
    Employee.objects.create(
        user=operational, branch=branch, department=department,
        designation="Store Keeper",
    )
    client = APIClient()
    client.force_authenticate(user=operational)
    assert client.get("/api/v1/gl-exports/").status_code == 403
    assert client.get(f"/api/v1/gl-exports/{export.pk}/").status_code == 403
    assert client.get(f"/api/v1/gl-exports/{export.pk}/download/").status_code == 403

    client.force_authenticate(user=finance_user)
    assert client.get("/api/v1/gl-exports/").status_code == 200
    response = client.get(f"/api/v1/gl-exports/{export.pk}/download/")
    assert response.status_code == 200
    assert response["X-Content-SHA256"] == export.checksum


@pytest.mark.django_db
def test_gl_export_download_rejects_corrupted_payload_without_leaking_financial_data(materials_context):
    import hashlib
    from django.contrib.auth import get_user_model
    from django.contrib.auth.models import Group
    from django.core.management import call_command
    from rest_framework.test import APIClient
    from apps.employees.models import Employee

    creator, _employee, department, branch, _store, _unit, _item = materials_context
    call_command("setup_hotel_roles", verbosity=0)
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Tampered export validation",
        start_date=today.replace(day=1), end_date=today,
    )
    original = "date,source,reference,department,description,account,debit,credit\\n"
    export = GLExport.objects.create(
        period=period, generated_by=creator, row_count=0,
        checksum=hashlib.sha256(original.encode("utf-8")).hexdigest(),
        payload=original,
    )
    finance_user = get_user_model().objects.create_user(
        username="gl-integrity-finance", employee_code="GL-INTEGRITY",
        password="test-only-password",
    )
    finance_user.groups.add(Group.objects.get(name="Financial Manager"))
    Employee.objects.create(
        user=finance_user, branch=branch, department=department,
        designation="Financial Manager",
    )
    client = APIClient()
    client.force_authenticate(user=finance_user)
    good = client.get(f"/api/v1/gl-exports/{export.pk}/download/")
    assert good.status_code == 200
    assert good["X-Content-SHA256"] == export.checksum
    export.payload = original + "tampered,financial,record\\n"
    export.save(update_fields=["payload"])
    blocked = client.get(f"/api/v1/gl-exports/{export.pk}/download/")
    assert blocked.status_code == 400
    assert b"tampered,financial,record" not in blocked.content
    assert b"integrity check failed" in blocked.content


@pytest.mark.django_db
def test_department_return_reverses_consumption_at_posted_ledger_cost(materials_context):
    """An accepted departmental return reduces the expense and restores stock in GL."""
    user, _employee, _department, branch, store, _unit, item = materials_context
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Department return GL reversal",
        start_date=today.replace(day=1), end_date=today,
    )
    GLAccountMapping.objects.create(
        branch=branch, source_type=GLAccountMapping.SOURCE_CONSUMPTION,
        debit_account="DEPT-EXPENSE", credit_account="STORE-ASSET",
    )
    for source, inbound, amount in (
        (LedgerReferenceType.STOCK_ISSUE, False, Decimal("60.0000")),
        (LedgerReferenceType.STORE_RETURN, True, Decimal("20.0000")),
    ):
        StockLedger.objects.create(
            item=item, store=store, reference_type=source, reference_id=uuid4(),
            quantity_in=Decimal("1.0000") if inbound else Decimal("0"),
            quantity_out=Decimal("0") if inbound else Decimal("1.0000"),
            unit_cost_snapshot=amount, total_cost_snapshot=amount,
            wac_before=amount, wac_after=amount,
        )
    result = period.inventory_gl_journal_preview()
    assert result["ready_for_finance_review"], result["blockers"]
    assert result["debit_total"] == result["credit_total"] == "80.00"
    rows = result["draft_rows"]
    assert len(rows) == 4
    issue = [row for row in rows if row["source"] == LedgerReferenceType.STOCK_ISSUE]
    returned = [row for row in rows if row["source"] == LedgerReferenceType.STORE_RETURN]
    assert [(r["account"], r["debit"], r["credit"]) for r in issue] == [
        ("DEPT-EXPENSE", "60.00", "0.00"),
        ("STORE-ASSET", "0.00", "60.00"),
    ]
    assert [(r["account"], r["debit"], r["credit"]) for r in returned] == [
        ("STORE-ASSET", "20.00", "0.00"),
        ("DEPT-EXPENSE", "0.00", "20.00"),
    ]
    period.close(user, "Consumption and signed return are reconciled.")
    export = GLExport.generate(period, user)
    assert export.row_count == 4
    assert LedgerReferenceType.STORE_RETURN in export.payload


@pytest.mark.django_db
def test_unvalued_department_return_blocks_finance_export(materials_context):
    from django.core.exceptions import ValidationError
    user, _employee, _department, branch, store, _unit, item = materials_context
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Unvalued department return",
        start_date=today.replace(day=1), end_date=today,
    )
    GLAccountMapping.objects.create(
        branch=branch, source_type=GLAccountMapping.SOURCE_CONSUMPTION,
        debit_account="DEPT-EXPENSE", credit_account="STORE-ASSET",
    )
    StockLedger.objects.create(
        item=item, store=store, reference_type=LedgerReferenceType.STORE_RETURN,
        reference_id=uuid4(), quantity_in=Decimal("1.0000"),
    )
    preview = period.inventory_gl_journal_preview()
    assert not preview["ready_for_finance_review"]
    assert any("Missing historical cost" in m for m in preview["blockers"])
    period.close(user, "Return valuation needs correction before journal export.")
    with pytest.raises(ValidationError, match="Missing historical cost"):
        GLExport.generate(period, user)


@pytest.mark.django_db
def test_signed_pickup_uses_classified_department_account_and_not_dispatch(materials_context):
    from apps.inventory.models import StoreRequisition, StoreRequisitionItem, StockIssue, StockIssueItem, DepartmentConsumption, StoreLocation, MonthEndCycle, MonthEndInventory
    from calendar import monthrange
    user, employee, department, branch, store, unit, item = materials_context
    today = timezone.localdate()
    cutoff = today.replace(day=monthrange(today.year, today.month)[1])
    period = FiscalPeriod.objects.create(branch=branch, name="Department GL", start_date=today.replace(day=1), end_date=cutoff)
    cycle = MonthEndCycle.objects.create(branch=branch, cutoff=cutoff, memo_reference="TEST", memo="Test", status="booked", created_by=user)
    MonthEndInventory.objects.create(cycle=cycle, department=department, location_name=department.name,
                                     department_cost_snapshot={"classification":"cost_of_sales"})
    transit = StoreLocation.objects.create(branch=branch, name="Transit GL", is_virtual_transit=True, is_active=False)
    req = StoreRequisition.objects.create(department=department, store=store, requested_by=employee)
    req_line = StoreRequisitionItem.objects.create(requisition=req, item=item, quantity_requested=Decimal("2"))
    issue = StockIssue.objects.create(requisition=req, store=store, issued_by=employee, transit_store=transit,
                                      fulfillment_status=StockIssue.STATUS_COMPLETED, signed_at=timezone.now(), inventory_changes_applied=True)
    line = StockIssueItem.objects.create(issue=issue, requisition_item=req_line, item=item, unit=item.base_unit,
                                        quantity=Decimal("2"), dispatched_unit_cost=Decimal("125.0000"))
    DepartmentConsumption.objects.create(department=department, stock_issue_item=line, item=item,
                                         quantity=line.base_quantity, unit_cost=Decimal("125"), consumed_on=today)
    for location, source in ((store, LedgerReferenceType.TRANSIT_DISPATCH), (transit, LedgerReferenceType.TRANSIT_PICKUP)):
        StockLedger.objects.create(store=location, item=item, reference_type=source, reference_id=issue.pk,
                                   quantity_out=line.base_quantity)
    GLAccountMapping.objects.create(branch=branch, source_type=GLAccountMapping.SOURCE_CONSUMPTION, debit_account="GENERAL", credit_account="STOCK")
    blocked = period.inventory_gl_journal_preview()
    assert not blocked["ready_for_finance_review"]
    assert any("department_cogs" in blocker for blocker in blocked["blockers"])
    GLAccountMapping.objects.create(branch=branch, department=department, source_type=GLAccountMapping.SOURCE_DEPARTMENT_COGS,
                                     debit_account="FOOD-COST", credit_account="STOCK")
    preview = period.inventory_gl_journal_preview()
    assert preview["ready_for_finance_review"], preview["blockers"]
    assert preview["excluded_source_counts"]["transit_dispatch"] == 1
    assert preview["debit_total"] == preview["credit_total"] == "250.00"
    assert [row["account"] for row in preview["draft_rows"]] == ["FOOD-COST", "STOCK"]
    assert all(row["department"] == department.name for row in preview["draft_rows"])
    assert not GLExport.objects.exists()
