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
    other = StoreLocation.objects.create(branch=Branch.objects.create(name="Other Count Property"), name="Unassigned Store")
    user = get_user_model().objects.create_user(
        username="stocktake-explicit-counter", employee_code="COUNT-EXPLICIT-01", password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Cost Controller"))
    employee = Employee.objects.create(user=user, branch=branch, department=department, designation="Cost Controller")
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
    # Store Keeper sees the article master name, SKU and actual count unit,
    # never only the raw UUID or confidential theoretical quantities.
    response = client.get(f"/api/v1/stock-count-items/?stock_count={count_id}")
    assert response.status_code == 200, response.data
    records = response.data["results"]
    assert len(records) == 1
    assert str(records[0]["item"]) == str(item.pk)
    assert records[0]["item_name"] == "Count Bottle Water"
    assert records[0]["item_sku"] == "ST-COUNT-WATER-001"
    assert records[0]["unit_name"] == "bottle"
    assert "system_quantity" not in records[0]
    assert line.system_quantity == Decimal("15")
    assert line.physical_quantity is None
    found = Item.objects.create(category=item.category,name="Unrecorded article",sku="COUNT-FOUND",unit="kg",reorder_level=Decimal("0"))
    added = client.post("/api/v1/stock-count-items/", {"stock_count":count_id,"item":str(found.pk),"physical_quantity":"7.1250","system_quantity":"999"},format="json")
    assert added.status_code == 201, added.data
    extra = StockCountItem.objects.get(stock_count_id=count_id,item=found)
    assert extra.system_quantity == 0 and extra.physical_quantity == Decimal("7.1250")
    assert not InventoryBalance.objects.filter(store=store,item=found).exists()
    assert client.post(f"/api/v1/stock-counts/{count_id}/submit/", {}, format="json").status_code == 400
    response=client.patch(f"/api/v1/stock-count-items/{line.pk}/", {"physical_quantity":"0.0000"}, format="json")
    assert response.status_code == 200, response.data
    assert client.post(f"/api/v1/stock-counts/{count_id}/submit/", {}, format="json").status_code == 200
    assert client.patch(f"/api/v1/stock-count-items/{line.pk}/", {"physical_quantity":"11"}, format="json").status_code == 400
    balance.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("15")
    assert not StockCount.objects.get(pk=count_id).inventory_changes_applied


@pytest.mark.django_db
def test_storekeeper_cannot_access_count_workspace_even_with_assignment():
    call_command("setup_hotel_roles", verbosity=0)
    user=get_user_model().objects.create_user(username="keeper-count-denied",employee_code="KEEP-COUNT-DENIED",password="test-password")
    user.groups.add(Group.objects.get(name="Store Keeper"))
    branch=Branch.objects.create(name="Keeper denied property")
    store=StoreLocation.objects.create(branch=branch,name="Keeper assigned store")
    department=Department.objects.create(name="Keeper denied department")
    employee=Employee.objects.create(user=user,branch=branch,department=department,designation="Store Keeper")
    StoreKeeperAssignment.objects.create(employee=employee,store=store)
    client=APIClient();client.force_authenticate(user)
    for endpoint in ("stock-counts","stock-count-items"):
        assert client.get(f"/api/v1/{endpoint}/").status_code == 403
        assert client.post(f"/api/v1/{endpoint}/",{},format="json").status_code == 403

    assert client.post("/api/v1/stock-counts/",{"store":str(store.pk)},format="json").status_code == 403
