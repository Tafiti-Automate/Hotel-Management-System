"""Transfer in-transit costs, stocktake WAC and verified adjustment valuation."""
from decimal import Decimal

import pytest

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from django.contrib.auth import get_user_model
from apps.inventory.models import (
    Category, InventoryBalance, Item, StockAdjustment, StockAdjustmentItem,
    StockCount, StockCountItem, StockLedger, StockTransfer,
    StockTransferItem, StoreLocation,
)
from core.constants.choices import LedgerReferenceType, StockAdjustmentStatus, StockCountStatus
from tests.test_inventory import create_inventory_operations_context


@pytest.mark.django_db
def test_transfer_preserves_source_cost_across_transit_and_revalues_destination():
    branch = Branch.objects.create(name="Transfer valuation property")
    source = StoreLocation.objects.create(branch=branch, name="Valuation source")
    target = StoreLocation.objects.create(branch=branch, name="Valuation destination")
    item = Item.objects.create(
        category=Category.objects.create(name="Transfer valuation category"),
        name="Transfer rice", sku="PH2-TRANSFER-RICE", unit="kg",
        reorder_level=Decimal("0"),
    )
    source_balance = InventoryBalance.objects.create(
        item=item, store=source, quantity_in_stock=Decimal("20"),
        weighted_average_cost=Decimal("5000.0000"),
    )
    destination = InventoryBalance.objects.create(
        item=item, store=target, quantity_in_stock=Decimal("10"),
        weighted_average_cost=Decimal("6500.0000"),
    )
    transfer = StockTransfer.objects.create(from_store=source, to_store=target)
    StockTransferItem.objects.create(stock_transfer=transfer, item=item, quantity=Decimal("4"))
    approver = Employee.objects.create(
        user=get_user_model().objects.create_user(
            username="valuation-transfer-approver", employee_code="VAL-TRF",
            password="transfer-test-only",
        ),
        department=Department.objects.create(name="Transfer valuation approvals"),
        branch=branch, designation="Store Keeper",
    )
    transfer.approve(approved_by=approver)
    transfer.dispatch(dispatched_by=approver)
    out = StockLedger.objects.get(reference_id=transfer.pk, store=source)
    assert out.unit_cost_snapshot == Decimal("5000.0000")
    assert out.total_cost_snapshot == Decimal("20000.0000")
    source_balance.refresh_from_db()
    assert source_balance.quantity_in_stock == Decimal("16.00")

    # Later change in the source cost must not reprice goods already in transit.
    source_balance.weighted_average_cost = Decimal("9000.0000")
    source_balance.save(update_fields=["weighted_average_cost", "updated_at"])
    transfer.receive()
    incoming = StockLedger.objects.get(reference_id=transfer.pk, store=target)
    destination.refresh_from_db()
    assert incoming.unit_cost_snapshot == Decimal("5000.0000")
    assert incoming.total_cost_snapshot == out.total_cost_snapshot
    assert incoming.wac_before == Decimal("6500.0000")
    assert incoming.wac_after == Decimal("6071.4286")
    assert destination.weighted_average_cost == Decimal("6071.4286")
    assert destination.quantity_in_stock == Decimal("14.00")


@pytest.mark.django_db
def test_approved_adjustment_records_explicit_receipt_cost_then_wac_variance():
    department, employee, store, item = create_inventory_operations_context()
    balance = InventoryBalance.objects.get(item=item, store=store)
    balance.weighted_average_cost = Decimal("1000.0000")
    balance.save(update_fields=["weighted_average_cost", "updated_at"])
    old_qty = balance.quantity_in_stock
    adjustment = StockAdjustment.objects.create(
        store=store, status=StockAdjustmentStatus.APPROVED, reason="Found stock",
    )
    StockAdjustmentItem.objects.create(
        stock_adjustment=adjustment, item=item,
        quantity_change=Decimal("4.00"), unit_cost=Decimal("1500.00"),
    )
    adjustment.apply()
    entry = StockLedger.objects.get(
        reference_id=adjustment.pk, reference_type=LedgerReferenceType.STOCK_ADJUSTMENT
    )
    expected_wac = (
        (old_qty * Decimal("1000") + Decimal("4") * Decimal("1500")) /
        (old_qty + Decimal("4"))
    ).quantize(Decimal("0.0001"))
    assert entry.unit_cost_snapshot == Decimal("1500.0000")
    assert entry.total_cost_snapshot == Decimal("6000.0000")
    assert entry.wac_before == Decimal("1000.0000")
    assert entry.wac_after == expected_wac


@pytest.mark.django_db
def test_stock_count_variance_preserves_known_store_wac():
    department, employee, store, item = create_inventory_operations_context()
    balance = InventoryBalance.objects.get(item=item, store=store)
    balance.weighted_average_cost = Decimal("1200.0000")
    balance.save(update_fields=["weighted_average_cost", "updated_at"])
    count = StockCount.objects.create(
        store=store, conducted_by=employee, status=StockCountStatus.APPROVED,
    )
    StockCountItem.objects.create(
        stock_count=count, item=item, system_quantity=balance.quantity_in_stock,
        physical_quantity=balance.quantity_in_stock - Decimal("3"),
    )
    count.apply_variances()
    entry = StockLedger.objects.get(
        reference_id=count.pk, reference_type=LedgerReferenceType.STOCK_COUNT
    )
    assert entry.quantity_out == Decimal("3.00")
    assert entry.unit_cost_snapshot == Decimal("1200.0000")
    assert entry.total_cost_snapshot == Decimal("3600.0000")
    assert entry.wac_before == entry.wac_after == Decimal("1200.0000")


@pytest.mark.django_db
def test_transfer_receipt_fails_closed_if_dispatch_ledger_no_longer_reconciles():
    from django.core.exceptions import ValidationError

    branch = Branch.objects.create(name="Transfer dispatch audit property")
    source = StoreLocation.objects.create(branch=branch, name="Audit source")
    destination = StoreLocation.objects.create(branch=branch, name="Audit destination")
    article = Item.objects.create(
        category=Category.objects.create(name="Audit transfer articles"),
        name="Audit transferred article", sku="AUD-TRANSFER-01", unit="kg",
        reorder_level=Decimal("0"),
    )
    source_balance = InventoryBalance.objects.create(
        item=article, store=source,
        quantity_in_stock=Decimal("15.0000"),
        weighted_average_cost=Decimal("2500.0000"),
    )
    transfer = StockTransfer.objects.create(from_store=source, to_store=destination)
    StockTransferItem.objects.create(
        stock_transfer=transfer, item=article, quantity=Decimal("5.0000"),
    )
    keeper = Employee.objects.create(
        user=get_user_model().objects.create_user(
            username="transfer-audit-approver", employee_code="TRF-AUD-001",
            password="test-credential",
        ),
        department=Department.objects.create(name="Transfer audit team"),
        branch=branch, designation="Store Keeper",
    )
    transfer.approve(approved_by=keeper)
    transfer.dispatch(dispatched_by=keeper)
    outgoing = StockLedger.objects.get(reference_id=transfer.pk, store=source)
    assert outgoing.quantity_out == Decimal("5.0000")
    assert source_balance.pk is not None

    # Simulate legacy/corrupt ledger evidence; QuerySet.update() bypasses
    # model save signals in this isolated test database only.
    StockLedger.objects.filter(pk=outgoing.pk).update(quantity_out=Decimal("2.0000"))
    with pytest.raises(ValidationError, match="does not reconcile"):
        transfer.receive(received_by=keeper)
    transfer.refresh_from_db()
    assert transfer.status == "in_transit"
    assert not InventoryBalance.objects.filter(item=article, store=destination).exists()
    assert not StockLedger.objects.filter(reference_id=transfer.pk, store=destination).exists()


@pytest.mark.django_db
def test_transfer_receipt_rejects_missing_historical_cost_evidence():
    from django.core.exceptions import ValidationError

    branch = Branch.objects.create(name="Transfer cost audit property")
    source = StoreLocation.objects.create(branch=branch, name="Cost source")
    destination = StoreLocation.objects.create(branch=branch, name="Cost destination")
    article = Item.objects.create(
        category=Category.objects.create(name="Transfer cost audit category"),
        name="Audit cost article", sku="AUD-TRANSFER-02", unit="kg",
        reorder_level=Decimal("0"),
    )
    InventoryBalance.objects.create(
        item=article, store=source, quantity_in_stock=Decimal("5.0000"),
        weighted_average_cost=Decimal("2500.0000"),
    )
    transfer = StockTransfer.objects.create(from_store=source, to_store=destination)
    StockTransferItem.objects.create(
        stock_transfer=transfer, item=article, quantity=Decimal("2.0000"),
    )
    keeper = Employee.objects.create(
        user=get_user_model().objects.create_user(
            username="transfer-cost-audit-approver", employee_code="TRF-AUD-002",
            password="test-credential",
        ),
        department=Department.objects.create(name="Transfer cost audit team"),
        branch=branch, designation="Store Keeper",
    )
    transfer.approve(approved_by=keeper)
    transfer.dispatch(dispatched_by=keeper)
    StockLedger.objects.filter(
        reference_id=transfer.pk, store=source,
    ).update(unit_cost_snapshot=None)
    with pytest.raises(ValidationError, match="source valuation is missing"):
        transfer.receive(received_by=keeper)
    assert not InventoryBalance.objects.filter(item=article, store=destination).exists()


@pytest.mark.django_db
def test_transfer_without_source_valuation_never_reaches_transit_or_debits_soh():
    from django.core.exceptions import ValidationError

    branch = Branch.objects.create(name="Unvalued transfer control")
    source = StoreLocation.objects.create(branch=branch, name="Source with unknown cost")
    destination = StoreLocation.objects.create(branch=branch, name="Destination with known cost")
    item = Item.objects.create(
        category=Category.objects.create(name="Unvalued transfer item group"),
        name="Unvalued transfer item", sku="UNVALUED-TRANSFER-01",
        unit="kg", reorder_level=Decimal("0"),
    )
    balance = InventoryBalance.objects.create(
        store=source, item=item, quantity_in_stock=Decimal("5.0000"),
        weighted_average_cost=Decimal("0.0000"),
    )
    transfer = StockTransfer.objects.create(from_store=source, to_store=destination)
    StockTransferItem.objects.create(
        stock_transfer=transfer, item=item, quantity=Decimal("2.0000"),
    )
    approver = Employee.objects.create(
        user=get_user_model().objects.create_user(
            username="unvalued-transfer-approver",
            employee_code="UNVALUED-TRF-01", password="test-password",
        ),
        branch=branch, department=Department.objects.create(name="Transfer approvers"),
        designation="Store Keeper",
    )
    transfer.approve(approved_by=approver)
    with pytest.raises(ValidationError, match="Missing verified historical cost"):
        transfer.dispatch(dispatched_by=approver)
    transfer.refresh_from_db()
    balance.refresh_from_db()
    assert transfer.status == "pending"
    assert balance.quantity_in_stock == Decimal("5.0000")
    assert not StockLedger.objects.filter(reference_id=transfer.pk).exists()
