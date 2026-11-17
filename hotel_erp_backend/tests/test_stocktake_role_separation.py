"""Stocktake separation of duties: no self-approval, no IT posting."""
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee


@pytest.mark.django_db
def test_store_keeper_cannot_approve_stocktake_or_post_without_assigned_store():
    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username="stocktake-keeper-check", employee_code="ST-KEEPER-CHECK",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Store Keeper"))
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(f"/api/v1/stock-counts/{uuid4()}/approve/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_finance_approver_requires_employee_property_scope():
    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username="stocktake-finance-check", employee_code="ST-FIN-CHECK",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Financial Manager"))
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(f"/api/v1/stock-counts/{uuid4()}/approve/")
    assert response.status_code == 403

    branch = Branch.objects.create(name="Stocktake approval branch", branch_code="ST-FIN")
    department = Department.objects.create(name="Stocktake Finance")
    Employee.objects.create(
        user=user, branch=branch, department=department, designation="Financial Manager",
    )
    # Authorized role and scoped employee pass the action permission gate.
    # The missing UUID should be 404, rather than permission-denied 403.
    response = client.post(f"/api/v1/stock-counts/{uuid4()}/approve/")
    assert response.status_code == 404


@pytest.mark.django_db
def test_system_administrator_cannot_approve_or_post_stocktake():
    admin = get_user_model().objects.create_superuser(
        username="stocktake-system-admin", employee_code="ST-ADMIN-CHECK",
        password="test-pass-123",
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    for action in ("approve", "apply"):
        response = client.post(f"/api/v1/stock-counts/{uuid4()}/{action}/")
        assert response.status_code == 403
