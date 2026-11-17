"""Transfer in-transit costs, stocktake WAC and verified adjustment valuation."""
from decimal import Decimal

import pytest

from apps.departments.models import Branch
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
    transfer.dispatch(require_approval=False)
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
