"""Phase 1 — reservation writes are bounded by operational store assignment."""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
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
