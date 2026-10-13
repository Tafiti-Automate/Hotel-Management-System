from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.departments.models import Branch
from apps.inventory.models import Category, InventoryBalance, InventoryBatch, Item, StoreLocation


@pytest.mark.django_db
@pytest.mark.parametrize("path", [
    "daily-crucial-activities", "pending-actions", "exceptions", "user-activity",
    "stock-movement-control", "approval-trail", "direct-workspace",
    "supplier-price-changes", "management-summary",
])
def test_control_reports_are_live_and_available_to_authorized_users(path):
    user = get_user_model().objects.create_superuser(
        username=f"control-{path}", employee_code=f"CTRL-{path[:12]}", password="test-pass-123",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get(f"/api/v1/reports/{path}/")

    assert response.status_code == 200
    assert "results" in response.data
    assert response.data["count"] == len(response.data["results"])


@pytest.mark.django_db
def test_stock_summary_report_returns_valuation_for_permitted_user():
    # This test verifies valuation math. Role/report authorization is covered by
    # test_report_role_access.py, so use an administrator to avoid coupling the
    # calculation assertion to a particular operational role's branch/store scope.
    user = get_user_model().objects.create_superuser(
        username="valuation-admin",
        employee_code="EMP-VAL-ADMIN",
        password="test-pass-123",
    )
    branch = Branch.objects.create(name="Main Hotel")
    store = StoreLocation.objects.create(branch=branch, name="Main Store")
    category = Category.objects.create(name="Food")
    item = Item.objects.create(
        category=category,
        name="Rice",
        sku="RICE-VAL",
        unit="kg",
        reorder_level=Decimal("10.00"),
    )
    InventoryBalance.objects.create(
        item=item,
        store=store,
        quantity_in_stock=Decimal("20.00"),
    )
    InventoryBatch.objects.create(
        item=item,
        store=store,
        quantity=Decimal("20.00"),
        remaining_quantity=Decimal("20.00"),
        unit_cost=Decimal("5000.00"),
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/v1/reports/stock-summary/")

    assert response.status_code == 200
    assert response.data["total_value"] == "100000.00"
    assert response.data["results"][0]["sku"] == "RICE-VAL"


@pytest.mark.django_db
def test_stock_summary_report_can_be_scoped_to_branch():
    # Administrators may explicitly select a property/branch. Operational users
    # remain restricted by their role and employee/store assignment.
    user = get_user_model().objects.create_superuser(
        username="branch-report-admin",
        employee_code="EMP-REPORT-ADMIN",
        password="test-pass-123",
    )
    category = Category.objects.create(name="Beverages")
    first_branch = Branch.objects.create(name="First Hotel")
    second_branch = Branch.objects.create(name="Second Hotel")
    first_store = StoreLocation.objects.create(branch=first_branch, name="First Store")
    second_store = StoreLocation.objects.create(branch=second_branch, name="Second Store")
    first_item = Item.objects.create(
        category=category, name="Tea", sku="TEA-001", unit="kg", reorder_level=Decimal("0.00")
    )
    second_item = Item.objects.create(
        category=category, name="Coffee", sku="COF-001", unit="kg", reorder_level=Decimal("0.00")
    )
    InventoryBalance.objects.create(item=first_item, store=first_store, quantity_in_stock=Decimal("2.00"))
    InventoryBalance.objects.create(item=second_item, store=second_store, quantity_in_stock=Decimal("3.00"))
    InventoryBatch.objects.create(
        item=first_item, store=first_store, quantity=Decimal("2.00"),
        remaining_quantity=Decimal("2.00"), unit_cost=Decimal("100.00"),
    )
    InventoryBatch.objects.create(
        item=second_item, store=second_store, quantity=Decimal("3.00"),
        remaining_quantity=Decimal("3.00"), unit_cost=Decimal("200.00"),
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get(f"/api/v1/reports/stock-summary/?branch={first_branch.id}")

    assert response.status_code == 200
    assert response.data["total_value"] == "200.00"
    assert [row["sku"] for row in response.data["results"]] == ["TEA-001"]
