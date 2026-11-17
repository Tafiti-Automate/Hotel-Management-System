"""Phase 1 — reservation writes are bounded by operational store assignment."""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from decimal import Decimal

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import Category, Item, InventoryBalance, StoreLocation
from django.core.management import call_command
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_it_administrator_cannot_reconcile_reserved_stock():
    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username="stock-reservation-it", employee_code="SCOPE-IT-01",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="System Administrator"))
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post("/api/v1/inventory-balances/00000000-0000-0000-0000-000000000001/reconcile-reservation/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_unassigned_store_keeper_cannot_reconcile_reserved_stock():
    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username="stock-reservation-keeper", employee_code="SCOPE-KEEPER-01",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Store Keeper"))
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post("/api/v1/inventory-balances/00000000-0000-0000-0000-000000000001/reconcile-reservation/")
    # The unknown record must never be changed; its absence is expected.
    assert response.status_code in (403, 404)


@pytest.mark.django_db
def test_store_keeper_cannot_reconcile_another_store_balance():
    call_command("setup_hotel_roles", verbosity=0)
    branch = Branch.objects.create(name="Reservation scope test property")
    assigned = StoreLocation.objects.create(branch=branch, name="Assigned test store")
    other = StoreLocation.objects.create(branch=branch, name="Other test store")
    category = Category.objects.create(name="Reservation scope test category")
    item = Item.objects.create(category=category, name="Reservation scope rice",
                               sku="RSCOPE-RICE-001", unit="kg")
    balance = InventoryBalance.objects.create(
        item=item, store=other, quantity_in_stock=Decimal("10.00"),
        quantity_reserved=Decimal("2.00"),
    )
    user = get_user_model().objects.create_user(
        username="reservation-scope-assigned", employee_code="SCOPE-KPR-02",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Store Keeper"))
    employee = Employee.objects.create(
        user=user, branch=branch,
        department=Department.objects.create(name="Reservation scope department"),
        designation="Store Keeper",
    )
    from apps.inventory.models import StoreKeeperAssignment
    StoreKeeperAssignment.objects.create(
        employee=employee, store=assigned, is_active=True,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(f"/api/v1/inventory-balances/{balance.pk}/reconcile-reservation/")
    assert response.status_code in (403, 404)
    balance.refresh_from_db()
    assert balance.quantity_reserved == Decimal("2.00")
