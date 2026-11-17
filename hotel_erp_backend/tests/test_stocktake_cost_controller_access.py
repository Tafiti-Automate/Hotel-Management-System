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
