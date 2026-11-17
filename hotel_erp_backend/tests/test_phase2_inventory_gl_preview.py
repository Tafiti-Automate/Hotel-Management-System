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
