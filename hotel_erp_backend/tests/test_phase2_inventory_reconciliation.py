"""Read-only stock movement preflight; never double-book stock into supplier GL."""
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.materials_control.models import FiscalPeriod, GLExport
from apps.inventory.models import StockLedger
from core.constants.choices import LedgerReferenceType
from tests.test_materials_control import materials_context


@pytest.mark.django_db
def test_inventory_reconciliation_accounts_for_unvalued_and_transfer_pairs(materials_context):
    user, employee, department, branch, store, unit, item = materials_context
    date = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Read-only valuation audit",
        start_date=date.replace(day=1), end_date=date,
    )
    transfer_id = uuid4()
    for incoming in (False, True):
        StockLedger.objects.create(
            store=store, item=item, reference_type=LedgerReferenceType.STOCK_TRANSFER,
            reference_id=transfer_id,
            quantity_in=Decimal("2.00") if incoming else Decimal("0.00"),
            quantity_out=Decimal("0.00") if incoming else Decimal("2.00"),
            unit_cost_snapshot=Decimal("123.0000"),
            total_cost_snapshot=Decimal("246.0000"),
            wac_before=Decimal("123.0000"), wac_after=Decimal("123.0000"),
        )
    StockLedger.objects.create(
        store=store, item=item, reference_type=LedgerReferenceType.WASTE,
        reference_id=uuid4(), quantity_out=Decimal("1.00"),
        unit_cost_snapshot=Decimal("123.0000"),
        total_cost_snapshot=Decimal("123.0000"),
        wac_before=Decimal("123.0000"), wac_after=Decimal("123.0000"),
    )
    StockLedger.objects.create(
        store=store, item=item, reference_type=LedgerReferenceType.POS_DEPLETION,
        reference_id=uuid4(), quantity_out=Decimal("1.00"),
    )
    result = period.inventory_valuation_reconciliation()
    assert result["movement_count"] == 4
    assert result["unvalued_count"] == 1
    assert result["categories"]["waste"]["value_out"] == "123.0000"
    assert result["categories"]["stock_transfer"]["value_in"] == "246.0000"
    assert result["categories"]["stock_transfer"]["value_out"] == "246.0000"
    assert result["transfer_period_warnings"] == []
    assert result["ready_for_gl_mapping_review"] is False
    assert result["gl_journals_posted"] is False
    assert GLExport.objects.count() == 0


@pytest.mark.django_db
def test_single_period_transfer_dispatch_is_flagged_without_creating_journal(materials_context):
    user, employee, department, branch, store, unit, item = materials_context
    date = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Transit across period audit",
        start_date=date.replace(day=1), end_date=date,
    )
    StockLedger.objects.create(
        store=store, item=item, reference_type=LedgerReferenceType.STOCK_TRANSFER,
        reference_id=uuid4(), quantity_out=Decimal("3.00"),
        unit_cost_snapshot=Decimal("25.0000"),
        total_cost_snapshot=Decimal("75.0000"),
        wac_before=Decimal("25.0000"), wac_after=Decimal("25.0000"),
    )
    result = period.inventory_valuation_reconciliation()
    assert result["unvalued_count"] == 0
    assert len(result["transfer_period_warnings"]) == 1
    assert result["ready_for_gl_mapping_review"] is False
    assert GLExport.objects.count() == 0


@pytest.mark.django_db
def test_finance_only_inventory_valuation_endpoint_and_property_scope(materials_context):
    user, employee, department, branch, store, unit, item = materials_context
    call_command("setup_hotel_roles", verbosity=0)
    date = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="Finance-access valuation audit",
        start_date=date.replace(day=1), end_date=date,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    url = f"/api/v1/fiscal-periods/{period.pk}/inventory-valuation-reconciliation/"
    assert client.get(url).status_code == 403
    user.groups.add(Group.objects.get(name="Financial Manager"))
    response = client.get(url)
    assert response.status_code == 200, response.data
    assert response.data["gl_journals_posted"] is False
