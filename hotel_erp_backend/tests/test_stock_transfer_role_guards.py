"""API-level guards for the store transfer separation of duties."""

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.accounts.role_templates import sync_client_roles


@pytest.mark.django_db
def test_transfer_write_actions_reject_non_store_keeper_roles():
    sync_client_roles()
    missing = "00000000-0000-0000-0000-000000000001"
    paths = (
        f"/api/v1/stock-transfers/{missing}/approve/",
        f"/api/v1/stock-transfers/{missing}/dispatch/",
        f"/api/v1/stock-transfers/{missing}/receive/",
        f"/api/v1/stock-transfers/{missing}/apply/",
    )
    for role in ("Cost Controller", "Procurement Manager", "Receiving Clerk"):
        user = get_user_model().objects.create_user(
            username=f"transfer-{role.lower().replace(' ', '-')}",
            employee_code=f"TRANSFER-{role.upper().replace(' ', '-')}",
            password="test-password",
        )
        user.groups.add(Group.objects.get(name=role))
        client = APIClient()
        client.force_authenticate(user)
        for url in paths:
            assert client.post(url, {}, format="json").status_code == 403


@pytest.mark.django_db
def test_transfer_apply_shortcut_is_forbidden_even_to_store_keeper():
    sync_client_roles()
    user = get_user_model().objects.create_user(
        username="transfer-keeper", employee_code="TRANSFER-KEEPER", password="test-password"
    )
    user.groups.add(Group.objects.get(name="Store Keeper"))
    client = APIClient()
    client.force_authenticate(user)
    missing = "00000000-0000-0000-0000-000000000001"
    assert client.post(f"/api/v1/stock-transfers/{missing}/apply/", {}, format="json").status_code == 403
