"""Authorization regression checks for supplier invoice approval actions."""

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.accounts.role_templates import sync_client_roles


@pytest.mark.django_db
def test_invoice_approval_requires_financial_manager_even_for_authenticated_users():
    sync_client_roles()
    url = "/api/v1/supplier-invoices/00000000-0000-0000-0000-000000000001/approve-for-payment/"

    for role in ("Cost Controller", "Procurement Manager", "Store Keeper", "Receiving Clerk"):
        user = get_user_model().objects.create_user(
            username=f"invoice-{role.lower().replace(' ', '-')}",
            employee_code=f"INVOICE-{role.upper().replace(' ', '-')}",
            password="test-password",
        )
        user.groups.add(Group.objects.get(name=role))
        client = APIClient()
        client.force_authenticate(user)
        assert client.post(url, {}, format="json").status_code == 403

    finance_user = get_user_model().objects.create_user(
        username="invoice-finance-manager", employee_code="INVOICE-FM", password="test-password"
    )
    finance_user.groups.add(Group.objects.get(name="Financial Manager"))
    finance_client = APIClient()
    finance_client.force_authenticate(finance_user)
    # The missing record produces 404 only after the Financial Manager authorization gate passes.
    assert finance_client.post(url, {}, format="json").status_code == 404
