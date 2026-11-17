"""Cost controllers and finance managers must never see another property's stock audit."""
from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category, Item, StockCount, StockCountItem, StockLedger, StoreLocation,
)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["Cost Controller", "Financial Manager"])
def test_stock_audit_collections_are_limited_to_assigned_property(role):
    call_command("setup_hotel_roles", verbosity=0)
    property_a = Branch.objects.create(name=f"{role} scope hotel A")
    property_b = Branch.objects.create(name=f"{role} scope hotel B")
    department = Department.objects.create(name=f"{role} scope department")
    owner = get_user_model().objects.create_user(
        username=f"scope-{role.replace(' ', '-').lower()}",
        employee_code=f"PH1-{role.replace(' ', '-').upper()}",
        password="test-pass-123",
    )
    owner.groups.add(Group.objects.get(name=role))
    employee_a = Employee.objects.create(
        user=owner, branch=property_a, department=department, designation=role
    )
    other = get_user_model().objects.create_user(
        username=f"other-{role.replace(' ', '-').lower()}",
        employee_code=f"PH1-OTHER-{role.replace(' ', '-').upper()}",
        password="test-pass-123",
    )
    employee_b = Employee.objects.create(
        user=other, branch=property_b, department=department, designation=role
    )
    store_a = StoreLocation.objects.create(branch=property_a, name="A Store")
    store_b = StoreLocation.objects.create(branch=property_b, name="B Store")
    article = Item.objects.create(
        category=Category.objects.create(name=f"{role} scope category"),
        name="Property isolation rice", sku=f"ISO-{role[0]}-{uuid4().hex[:8]}",
        unit="kg", reorder_level=Decimal("0.00"),
    )
    count_a = StockCount.objects.create(store=store_a, conducted_by=employee_a)
    count_b = StockCount.objects.create(store=store_b, conducted_by=employee_b)
    line_a = StockCountItem.objects.create(stock_count=count_a, item=article, physical_quantity=Decimal("1"))
    line_b = StockCountItem.objects.create(stock_count=count_b, item=article, physical_quantity=Decimal("2"))
    ledger_a = StockLedger.objects.create(
        item=article, store=store_a, quantity_in=Decimal("1"),
        reference_type="stock_adjustment", reference_id=uuid4(),
    )
    ledger_b = StockLedger.objects.create(
        item=article, store=store_b, quantity_in=Decimal("2"),
        reference_type="stock_adjustment", reference_id=uuid4(),
    )
    client = APIClient()
    client.force_authenticate(user=owner)
    for endpoint, expected, excluded in (
        ("stock-counts", count_a.pk, count_b.pk),
        ("stock-count-items", line_a.pk, line_b.pk),
        ("stock-ledger", ledger_a.pk, ledger_b.pk),
    ):
        response = client.get(f"/api/v1/{endpoint}/")
        assert response.status_code == 200
        records = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        identifiers = {str(row["id"]) for row in records}
        assert str(expected) in identifiers, endpoint
        assert str(excluded) not in identifiers, endpoint
