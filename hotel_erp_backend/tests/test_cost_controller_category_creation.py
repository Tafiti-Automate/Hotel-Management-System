"""Cost Controller category creation works even with an unsynced role template.

The system administrator does not have to grant uncontrolled inventory access.
Only the canonical master-data role can create Major/Item Groups.
"""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from rest_framework.test import APIClient

from apps.inventory.models import Category


def client_for_group(name, suffix):
    user = get_user_model().objects.create_user(
        username=f"category-setup-{suffix}",
        employee_code=f"CAT-SETUP-{suffix.upper()}",
        password="test-pass-123",
    )
    group, _ = Group.objects.get_or_create(name=name)
    user.groups.add(group)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


@pytest.mark.django_db
def test_cost_controller_can_create_major_and_item_group_without_stale_permission_grants():
    client, user = client_for_group("Cost Controller", "cost")
    # Reproduces a Cost Controller whose role exists but the production Django
    # permissions have not yet been synchronized.
    assert not user.has_perm("inventory.add_category")
    major = client.post(
        "/api/v1/categories/",
        {"name": "Fresh Hotel Supplies", "parent": None, "description": "Major category"},
        format="json",
    )
    assert major.status_code == 201, major.data
    assert major.data["group_type"] == "Major Group"
    assert major.data["parent"] is None
    assert major.data["code"]
    assert Category.objects.get(pk=major.data["id"]).created_by_id == user.pk

    child = client.post(
        "/api/v1/categories/",
        {"name": "Fresh Produce", "parent": major.data["id"]},
        format="json",
    )
    assert child.status_code == 201, child.data
    assert child.data["group_type"] == "Item Group"
    assert child.data["parent_name"] == "Fresh Hotel Supplies"
    assert child.data["hierarchy_path"] == "Fresh Hotel Supplies › Fresh Produce"
    listed = client.get("/api/v1/categories/")
    assert listed.status_code == 200, listed.data
    assert listed.data["count"] == 2

    edited = client.patch(
        f"/api/v1/categories/{child.data['id']}/",
        {"description": "Reviewed in Cost Control"},
        format="json",
    )
    assert edited.status_code == 200, edited.data
    assert edited.data["description"] == "Reviewed in Cost Control"

    duplicate = client.post(
        "/api/v1/categories/", {"name": "Fresh Produce", "parent": major.data["id"]},
        format="json",
    )
    assert duplicate.status_code == 400
    invalid_depth = client.post(
        "/api/v1/categories/", {"name": "Invalid Sub-group", "parent": child.data["id"]},
        format="json",
    )
    assert invalid_depth.status_code == 400


@pytest.mark.django_db
def test_other_employee_cannot_create_or_change_groups_with_view_only_permission():
    cost_client, _ = client_for_group("Cost Controller", "author")
    major = cost_client.post("/api/v1/categories/", {"name": "Stationery"}, format="json")
    assert major.status_code == 201, major.data
    client, user = client_for_group("Store Keeper", "reader")
    user.user_permissions.add(Permission.objects.get(
        content_type__app_label="inventory", codename="view_category",
    ))
    assert client.get("/api/v1/categories/").status_code == 200
    assert client.post(
        "/api/v1/categories/", {"name": "Unauthorized Parent"}, format="json",
    ).status_code == 403
    assert client.patch(
        f"/api/v1/categories/{major.data['id']}/", {"name": "Renamed"}, format="json",
    ).status_code == 403
    assert client.delete(f"/api/v1/categories/{major.data['id']}/").status_code == 403
    assert Category.objects.filter(name="Stationery").exists()


@pytest.mark.django_db
def test_category_user_without_role_cannot_read_ungranted_catalogue():
    client, _ = client_for_group("Department Supervisor", "ungranted")
    assert client.get("/api/v1/categories/").status_code == 403
    assert client.post("/api/v1/categories/", {"name": "Unapproved"}, format="json").status_code == 403
