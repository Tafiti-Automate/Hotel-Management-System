from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from rest_framework.test import APIClient

from apps.departments.models import Branch
from apps.inventory.models import Category, InventoryBalance, InventoryBatch, Item, StoreLocation


@pytest.mark.django_db
def test_stock_summary_report_returns_valuation_for_permitted_user():
    user = get_user_model().objects.create_user(
        username="auditor",
        employee_code="EMP-AUD",
        password="test-pass-123",
    )
    user.user_permissions.add(Permission.objects.get(codename="view_inventorybalance"))
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
    user = get_user_model().objects.create_user(
        username="report-viewer",
        employee_code="EMP-REPORT",
        password="test-pass-123",
    )
    user.user_permissions.add(Permission.objects.get(codename="view_inventorybalance"))
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
