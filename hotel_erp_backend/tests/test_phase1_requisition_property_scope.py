"""Phase 1: management roles must not see PRs without a valid property assignment."""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.departments.models import Branch
from apps.procurement.models import PurchaseRequisition


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["Procurement Manager", "Financial Manager"])
def test_management_without_employee_property_cannot_list_purchase_requisitions(role):
    call_command("setup_hotel_roles", verbosity=0)
    branch = Branch.objects.create(name=f"Isolated requisition branch {role}")
    requisition = PurchaseRequisition.objects.create(
        branch=branch, reason="Scope test for missing management assignment",
    )
    user = get_user_model().objects.create_user(
        username=f"unscoped-{role.lower().replace(' ', '-')}",
        employee_code=f"UNSCOPED-{role[:4].upper()}",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name=role))
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/v1/requisitions/")
    assert response.status_code == 200
    rows = response.data["results"] if isinstance(response.data, dict) else response.data
    assert str(requisition.pk) not in {str(row["id"]) for row in rows}
    assert rows == []
