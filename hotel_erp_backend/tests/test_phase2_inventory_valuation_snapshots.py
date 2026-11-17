"""Transaction-time stock valuation snapshots; legacy unknown costs remain NULL."""
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.inventory.models import InventoryBalance, StockLedger
from core.constants.choices import LedgerReferenceType
from tests.test_phase2_supplier_return_quantities import posted_receipt, make_return


@pytest.mark.django_db
def test_posted_grn_uses_receipt_cost_and_preserves_wac_before_after(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    balance = InventoryBalance.objects.get(item=item, store=store)
    entries = StockLedger.objects.filter(
        item=item, store=store, reference_id=grn.pk,
        reference_type=LedgerReferenceType.GRN_RECEIPT,
    )
    assert entries.count() == 1
    entry = entries.get()
    assert entry.quantity_in == Decimal("7.00")
    assert entry.unit_cost_snapshot == Decimal("1000.0000")
    assert entry.total_cost_snapshot == Decimal("7000.0000")
    assert entry.wac_before == Decimal("0.0000")
    assert entry.wac_after == Decimal("1000.0000")
    assert balance.weighted_average_cost == entry.wac_after
    assert entry.total_cost_snapshot == entry.quantity_in * entry.unit_cost_snapshot
    with pytest.raises(ValidationError, match="immutable"):
        entry.save()
    with pytest.raises(ValidationError, match="cannot be deleted"):
        entry.delete()


@pytest.mark.django_db
def test_vendor_return_uses_dispatch_time_store_wac(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    returned = make_return(posted_receipt, "2")
    returned.apply_inventory_changes(dispatched_by=employee)
    entry = StockLedger.objects.get(
        reference_id=returned.pk, reference_type=LedgerReferenceType.RETURN_TO_VENDOR,
    )
    assert entry.quantity_out == Decimal("2.00")
    assert entry.unit_cost_snapshot == Decimal("1000.0000")
    assert entry.total_cost_snapshot == Decimal("2000.0000")
    assert entry.wac_before == entry.wac_after == Decimal("1000.0000")
    balance = InventoryBalance.objects.get(item=item, store=store)
    assert balance.quantity_in_stock == Decimal("5.00")


@pytest.mark.django_db
def test_legacy_stock_ledger_without_cost_does_not_fabricate_valuation(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    historical = StockLedger.objects.create(
        item=item, store=store, quantity_out=Decimal("1.00"),
        reference_type=LedgerReferenceType.STOCK_ADJUSTMENT,
        reference_id=grn.pk,
        note="Historical movement: no known transaction cost",
    )
    assert historical.unit_cost_snapshot is None
    assert historical.total_cost_snapshot is None
    assert historical.wac_before is None
    assert historical.wac_after is None


@pytest.mark.django_db
def test_partial_or_inconsistent_valued_snapshot_rejected(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    with pytest.raises(ValidationError, match="requires unit"):
        StockLedger.objects.create(
            item=item, store=store, quantity_out=Decimal("2.00"),
            reference_type=LedgerReferenceType.STOCK_ADJUSTMENT,
            reference_id=grn.pk, unit_cost_snapshot=Decimal("1000.0000"),
        )
    with pytest.raises(ValidationError, match="total valuation disagree"):
        StockLedger.objects.create(
            item=item, store=store, quantity_out=Decimal("2.00"),
            reference_type=LedgerReferenceType.STOCK_ADJUSTMENT,
            reference_id=grn.pk, unit_cost_snapshot=Decimal("1000.0000"),
            total_cost_snapshot=Decimal("1.0000"),
            wac_before=Decimal("1000.0000"),
            wac_after=Decimal("1000.0000"),
        )
