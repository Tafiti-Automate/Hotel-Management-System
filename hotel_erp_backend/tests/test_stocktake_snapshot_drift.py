"""Stocktaking must not overwrite real stock movements after a blind count."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category, InventoryBalance, Item, StockCount, StockLedger, StoreLocation,
)
from apps.materials_control.models import FiscalPeriod
from django.utils import timezone


@pytest.fixture
def stocktake_snapshot(db):
    now = timezone.localdate()
    branch = Branch.objects.create(name="Snapshot reconciliation test")
    FiscalPeriod.objects.create(
        branch=branch, name="Snapshot open fiscal period",
        start_date=now.replace(day=1), end_date=now,
    )
    store = StoreLocation.objects.create(branch=branch, name="Physical Count Store")
    dept = Department.objects.create(name="Physical count audit")
    user = get_user_model().objects.create_user(
        username="snapshot-counter", employee_code="SNAP-COUNT-001",
        password="test-password",
    )
    counter = Employee.objects.create(
        user=user, branch=branch, department=dept, designation="Store Keeper",
    )
    category = Category.objects.create(name="Snapshot test catalogue")
    item = Item.objects.create(
        category=category, name="Counting accuracy coffee",
        sku="SNAP-COFFEE-001", unit="kg", reorder_level=Decimal("0"),
    )
    balance = InventoryBalance.objects.create(
        item=item, store=store, quantity_in_stock=Decimal("12.3456"),
        weighted_average_cost=Decimal("5000.0000"),
    )
    count = StockCount.objects.create(store=store, conducted_by=counter)
    count.populate_from_system_balances()
    line = count.items.get(item=item)
    assert line.system_quantity == Decimal("12.3456")
    line.physical_quantity = Decimal("11.1111")
    line.save(update_fields=["physical_quantity", "updated_at"])
    count.submit()
    count.approve(approved_by=counter)  # Model-level setup; API enforces independent Finance actor.
    return count, balance, line


@pytest.mark.django_db
def test_stale_stocktake_snapshot_rejects_variance_without_touching_stock(stocktake_snapshot):
    count, balance, line = stocktake_snapshot
    # A legitimate stock movement took place while Finance was reviewing the count.
    balance.quantity_in_stock = Decimal("15.3456")
    balance.save(update_fields=["quantity_in_stock", "updated_at"])
    with pytest.raises(ValidationError, match="changed since the physical count snapshot"):
        count.apply_variances()
    balance.refresh_from_db()
    count.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("15.3456")
    assert count.status == "approved"
    assert count.inventory_changes_applied is False
    assert not StockLedger.objects.filter(reference_id=count.pk).exists()
    assert line.physical_quantity == Decimal("11.1111")


@pytest.mark.django_db
def test_unchanged_stocktake_snapshot_books_four_decimal_variance_once(stocktake_snapshot):
    count, balance, _line = stocktake_snapshot
    count.apply_variances()
    balance.refresh_from_db()
    count.refresh_from_db()
    assert count.status == "applied"
    assert balance.quantity_in_stock == Decimal("11.1111")
    ledger = StockLedger.objects.get(reference_id=count.pk)
    assert ledger.quantity_out == Decimal("1.2345")
    with pytest.raises(ValidationError):
        count.apply_variances()
    assert StockLedger.objects.filter(reference_id=count.pk).count() == 1
