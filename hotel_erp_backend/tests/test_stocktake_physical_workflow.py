"""Physical stocktake must require explicit count before variance review."""
from decimal import Decimal
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category, InventoryBalance, Item, StockCount, StockCountItem,
    StoreKeeperAssignment, StoreLocation,
)


@pytest.mark.django_db
def test_count_requires_physical_entry_and_stays_distinct_from_stock_balance():
    call_command("setup_hotel_roles", verbosity=0)
    branch = Branch.objects.create(name="Count Physical Branch")
    department = Department.objects.create(name="Count Department")
    store = StoreLocation.objects.create(branch=branch, name="Count Main Store")
    other = StoreLocation.objects.create(branch=branch, name="Unassigned Store")
    user = get_user_model().objects.create_user(
        username="stocktake-explicit-counter", employee_code="COUNT-EXPLICIT-01", password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Store Keeper"))
    employee = Employee.objects.create(user=user, branch=branch, department=department, designation="Store Keeper")
    StoreKeeperAssignment.objects.create(employee=employee, store=store)
    item = Item.objects.create(
        category=Category.objects.create(name="Stocktake test category"),
        name="Count Bottle Water", sku="ST-COUNT-WATER-001", unit="bottle", reorder_level=Decimal("0"),
    )
    balance = InventoryBalance.objects.create(item=item, store=store, quantity_in_stock=Decimal("15"))
    client=APIClient()
    client.force_authenticate(user=user)
    assert client.post("/api/v1/stock-counts/", {"store":str(other.pk)}, format="json").status_code == 403
    result=client.post("/api/v1/stock-counts/", {"store":str(store.pk)}, format="json")
    assert result.status_code == 201, result.data
    count_id=result.data["id"]
    assert client.post(f"/api/v1/stock-counts/{count_id}/populate/", {}, format="json").status_code == 200
    line=StockCountItem.objects.get(stock_count_id=count_id,item=item)
    assert line.system_quantity == Decimal("15")
    assert line.physical_quantity is None
    assert client.post(f"/api/v1/stock-counts/{count_id}/submit/", {}, format="json").status_code == 400
    response=client.patch(f"/api/v1/stock-count-items/{line.pk}/", {"physical_quantity":"0.0000"}, format="json")
    assert response.status_code == 200, response.data
    assert client.post(f"/api/v1/stock-counts/{count_id}/submit/", {}, format="json").status_code == 200
    assert client.patch(f"/api/v1/stock-count-items/{line.pk}/", {"physical_quantity":"11"}, format="json").status_code == 400
    balance.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("15")
    assert not StockCount.objects.get(pk=count_id).inventory_changes_applied
