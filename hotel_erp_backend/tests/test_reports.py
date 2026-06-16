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
