"""Regression: stocktake variance dashboards require read-only Cost Controller access."""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_cost_controller_can_read_stocktake_audit_without_edit_permissions():
    call_command("setup_hotel_roles", verbosity=0)
    role = Group.objects.get(name="Cost Controller")
    user = get_user_model().objects.create_user(
        username="stocktake-cost-auditor",
        employee_code="COST-STOCKTAKE-AUDITOR",
        password="test-pass-123",
    )
    user.groups.add(role)
    client = APIClient()
    client.force_authenticate(user=user)

    # All four resources fetched by the stocktake variance workspace.
    for endpoint in ("stock-counts", "stock-count-items", "items", "stock-ledger"):
        response = client.get(f"/api/v1/{endpoint}/")
        assert response.status_code == 200, (
            f"Cost Controller cannot read {endpoint}: {response.status_code} {response.data}"
        )

    for model in ("stockcount", "stockcountitem", "stockledger"):
        assert user.has_perm(f"inventory.view_{model}")
        assert not user.has_perm(f"inventory.add_{model}")
        assert not user.has_perm(f"inventory.change_{model}")
        assert not user.has_perm(f"inventory.delete_{model}")


@pytest.mark.django_db
def test_department_supervisor_cannot_read_stocktake_audit_by_default():
    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username="stocktake-supervisor",
        employee_code="SUP-STOCKTAKE-TEST",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Department Supervisor"))
    client = APIClient()
    client.force_authenticate(user=user)
    for endpoint in ("stock-counts", "stock-count-items", "stock-ledger"):
        assert client.get(f"/api/v1/{endpoint}/").status_code == 403


@pytest.mark.django_db
def test_cost_controller_can_read_property_stock_on_hand_without_stock_mutation_permissions():
    from decimal import Decimal

    from apps.departments.models import Branch, Department
    from apps.employees.models import Employee
    from apps.inventory.models import Category, InventoryBalance, Item, StoreLocation
    from apps.organization.models import Hotel

    call_command("setup_hotel_roles", verbosity=0)
    hotel = Hotel.objects.create(name="SOH Control Hotel")
    other_hotel = Hotel.objects.create(name="SOH Other Hotel")
    branch = Branch.objects.create(name="SOH Cost Control Branch", hotel=hotel)
    sister = Branch.objects.create(name="SOH Sister Property", hotel=hotel)
    unrelated = Branch.objects.create(name="SOH Unrelated Property", hotel=other_hotel)
    department = Department.objects.create(name="SOH Cost Control Department")
    user = get_user_model().objects.create_user(
        username="soh-cost-controller", employee_code="COST-SOH-01", password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Cost Controller"))
    Employee.objects.create(user=user, department=department, branch=branch, designation="Cost Controller")
    category = Category.objects.create(name="SOH Test Category")
    item = Item.objects.create(category=category, name="SOH Test Water", sku="SOH-WATER-01", unit="bottle", reorder_level=Decimal("0"))
    primary = StoreLocation.objects.create(name="SOH Main Store", branch=branch)
    sibling = StoreLocation.objects.create(name="SOH Sister Store", branch=sister)
    external = StoreLocation.objects.create(name="SOH Restricted Store", branch=unrelated)
    for store in (primary, sibling, external):
        InventoryBalance.objects.create(item=item, store=store, quantity_in_stock=Decimal("10.0000"))
    client = APIClient()
    client.force_authenticate(user=user)

    balances = client.get("/api/v1/inventory-balances/")
    assert balances.status_code == 200, balances.data
    balance_stores = {entry["store"] for entry in balances.data["results"]}
    assert {str(pk) for pk in balance_stores} == {str(primary.pk), str(sibling.pk)}

    stores = client.get("/api/v1/stores/")
    assert stores.status_code == 200, stores.data
    store_ids = {entry["id"] for entry in stores.data["results"]}
    assert {str(pk) for pk in store_ids} == {str(primary.pk), str(sibling.pk)}

    # This grant must never allow Cost Control to edit balances or perform
    # operational reservation reconciliation, even with a valid balance ID.
    record = InventoryBalance.objects.get(store=primary, item=item)
    assert client.patch(f"/api/v1/inventory-balances/{record.pk}/", {"quantity_in_stock": "1000"}, format="json").status_code == 405
    assert client.post(f"/api/v1/inventory-balances/{record.pk}/reconcile-reservation/", {}, format="json").status_code == 403
    for perm in ("add", "change", "delete"):
        assert not user.has_perm(f"inventory.{perm}_inventorybalance")
    assert user.has_perm("inventory.view_inventorybalance")


@pytest.mark.django_db
def test_cost_controller_stock_on_hand_without_employee_branch_returns_no_stock():
    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username="soh-unassigned-controller", employee_code="COST-SOH-NO-BRANCH",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Cost Controller"))
    client = APIClient()
    client.force_authenticate(user=user)
    for path in ("inventory-balances", "stores"):
        response = client.get(f"/api/v1/{path}/")
        assert response.status_code == 200, response.data
        assert response.data["count"] == 0
