"""Cost Controller may create store and department master records, never transact stock."""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import StoreLocation
from apps.organization.models import Hotel


@pytest.fixture
def master_data_users(db):
    call_command("setup_hotel_roles", verbosity=0)
    hotel = Hotel.objects.create(name="Creation Test Hotel")
    other_hotel = Hotel.objects.create(name="Creation Other Hotel")
    branch = Branch.objects.create(name="Creation Main Branch", hotel=hotel)
    sibling = Branch.objects.create(name="Creation Second Branch", hotel=hotel)
    outside = Branch.objects.create(name="Creation Outside Branch", hotel=other_hotel)
    department = Department.objects.create(name="Creation Existing Department")

    def make(code, group):
        user = get_user_model().objects.create_user(
            username=f"creation-{code}", employee_code=f"CREATION-{code}", password="test123",
        )
        user.groups.add(Group.objects.get(name=group))
        Employee.objects.create(
            user=user, branch=branch, department=department, designation=group,
        )
        client = APIClient()
        client.force_authenticate(user=user)
        return user, client

    controller, controller_client = make("controller", "Cost Controller")
    storekeeper, storekeeper_client = make("keeper", "Store Keeper")
    return {
        "hotel": hotel, "branch": branch, "sibling": sibling, "outside": outside,
        "controller": controller, "controller_client": controller_client,
        "storekeeper": storekeeper, "storekeeper_client": storekeeper_client,
    }


@pytest.mark.django_db
def test_cost_controller_can_create_store_within_assigned_hotel(master_data_users):
    ctx = master_data_users
    user, client = ctx["controller"], ctx["controller_client"]
    assert user.has_perm("inventory.view_storelocation")
    assert user.has_perm("inventory.add_storelocation")
    assert user.has_perm("inventory.change_storelocation")
    assert not user.has_perm("inventory.delete_storelocation")

    response = client.post("/api/v1/stores/", {
        "branch": str(ctx["sibling"].pk),
        "name": "Creation Kitchen Store",
        "is_active": True, "is_default": False,
    }, format="json")
    assert response.status_code == 201, response.data
    store = StoreLocation.objects.get(pk=response.data["id"])
    assert store.branch_id == ctx["sibling"].pk
    assert store.created_by_id == user.pk
    assert client.get("/api/v1/stores/").status_code == 200
    renamed = client.patch(
        f"/api/v1/stores/{store.pk}/",
        {"name": "Kitchen Dry Store", "address": "Lower Ground", "is_default": True},
        format="json",
    )
    assert renamed.status_code == 200, renamed.data
    store.refresh_from_db()
    assert store.name == "Kitchen Dry Store"
    assert store.address == "Lower Ground"
    assert store.is_default is True
    assert client.delete(f"/api/v1/stores/{store.pk}/").status_code == 403


@pytest.mark.django_db
def test_cost_controller_cannot_create_store_outside_hotel_or_without_branch(master_data_users):
    ctx = master_data_users
    client = ctx["controller_client"]
    denied = client.post("/api/v1/stores/", {
        "branch": str(ctx["outside"].pk), "name": "Cross-Hotel Store",
    }, format="json")
    assert denied.status_code == 403, denied.data

    missing = client.post("/api/v1/stores/", {
        "name": "Unassigned Store",
    }, format="json")
    assert missing.status_code == 400, missing.data
    assert not StoreLocation.objects.filter(name__in=[
        "Cross-Hotel Store", "Unassigned Store",
    ]).exists()


@pytest.mark.django_db
def test_cost_controller_can_create_department_but_not_edit_or_delete(master_data_users):
    ctx = master_data_users
    user, client = ctx["controller"], ctx["controller_client"]
    assert user.has_perm("departments.add_department")
    assert user.has_perm("departments.view_department")
    assert user.has_perm("departments.change_department")
    assert not user.has_perm("departments.delete_department")

    response = client.post("/api/v1/departments/", {
        "name": "Creation Housekeeping", "description": "Rooms and public areas",
    }, format="json")
    assert response.status_code == 201, response.data
    dept = Department.objects.get(pk=response.data["id"])
    assert dept.created_by_id == user.pk
    updated = client.patch(
        f"/api/v1/departments/{dept.pk}/",
        {"name": "Creation Housekeeping Services", "description": "Rooms and facilities"},
        format="json",
    )
    assert updated.status_code == 200, updated.data
    dept.refresh_from_db()
    assert dept.name == "Creation Housekeeping Services"
    assert dept.description == "Rooms and facilities"
    assert client.delete(f"/api/v1/departments/{dept.pk}/").status_code == 403


@pytest.mark.django_db
def test_store_keeper_cannot_create_stores_or_departments(master_data_users):
    ctx = master_data_users
    user, client = ctx["storekeeper"], ctx["storekeeper_client"]
    assert not user.has_perm("inventory.add_storelocation")
    assert not user.has_perm("departments.add_department")
    assert client.post("/api/v1/stores/", {
        "branch": str(ctx["branch"].pk), "name": "Unauthorized Store",
    }, format="json").status_code == 403
    assert client.post("/api/v1/departments/", {
        "name": "Unauthorized Department",
    }, format="json").status_code == 403

    existing_store = StoreLocation.objects.create(
        name="Protected Existing Store", branch=ctx["branch"],
    )
    existing_dept = Department.objects.create(name="Protected Existing Department")
    assert client.patch(
        f"/api/v1/stores/{existing_store.pk}/", {"name": "Forbidden Store Edit"},
        format="json",
    ).status_code == 403
    assert client.patch(
        f"/api/v1/departments/{existing_dept.pk}/",
        {"name": "Forbidden Department Edit"}, format="json",
    ).status_code == 403


@pytest.mark.django_db
def test_cost_controller_cannot_reassign_existing_store_to_another_branch(master_data_users):
    ctx = master_data_users
    store = StoreLocation.objects.create(name="Bound Store", branch=ctx["branch"])
    client = ctx["controller_client"]
    for new_branch in (ctx["sibling"], ctx["outside"]):
        response = client.patch(
            f"/api/v1/stores/{store.pk}/", {"branch": str(new_branch.pk)},
            format="json",
        )
        assert response.status_code in (400, 403), response.data
        store.refresh_from_db()
        assert store.branch_id == ctx["branch"].pk
    assert client.patch(
        f"/api/v1/stores/{store.pk}/", {"is_virtual_transit": True},
        format="json",
    ).status_code == 400


@pytest.mark.django_db
def test_cost_controller_cannot_deactivate_store_with_live_stock(master_data_users):
    from decimal import Decimal
    from apps.inventory.models import Category, InventoryBalance, Item

    ctx = master_data_users
    store = StoreLocation.objects.create(name="Stocked Store", branch=ctx["branch"])
    item = Item.objects.create(
        category=Category.objects.create(name="Creation Store Category"),
        name="Creation Stock Water", sku="CREATION-STOCK-WATER",
        unit="bottle", reorder_level=Decimal("0"),
    )
    InventoryBalance.objects.create(
        item=item, store=store, quantity_in_stock=Decimal("25.0000"),
    )
    response = ctx["controller_client"].patch(
        f"/api/v1/stores/{store.pk}/", {"is_active": False}, format="json",
    )
    assert response.status_code == 400, response.data
    store.refresh_from_db()
    assert store.is_active is True


@pytest.mark.django_db
def test_cost_controller_cannot_deactivate_department_with_active_employees(master_data_users):
    ctx = master_data_users
    department = ctx["controller"].employee_profile.department
    response = ctx["controller_client"].patch(
        f"/api/v1/departments/{department.pk}/",
        {"is_active": False}, format="json",
    )
    assert response.status_code == 400, response.data
    department.refresh_from_db()
    assert department.is_active is True
