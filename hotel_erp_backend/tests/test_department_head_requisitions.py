from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.accounts.role_templates import sync_client_roles
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category,
    Item,
    StoreKeeperAssignment,
    StoreLocation,
    StoreRequisition,
    StoreRequisitionItem,
    UnitOfMeasure,
)
from core.constants.choices import StoreRequisitionStatus


User = get_user_model()


def make_employee(*, username, code, department, branch, role):
    user = User.objects.create_user(
        username=username,
        employee_code=code,
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get_or_create(name=role)[0])
    employee = Employee.objects.create(
        user=user,
        department=department,
        branch=branch,
        designation=role,
        is_active=True,
    )
    return user, employee


@pytest.mark.django_db
def test_department_head_creates_and_submits_directly_to_stores():
    department = Department.objects.create(name="Food and Beverage")
    branch = Branch.objects.create(name="Main Property")
    store = StoreLocation.objects.create(branch=branch, name="Main Store", is_active=True)
    unit = UnitOfMeasure.objects.create(name="Pieces", abbreviation="pcs")
    category = Category.objects.create(name="Department request test")
    item = Item.objects.create(
        category=category,
        name="Department request article",
        sku="HOD-REQ-001",
        unit="pcs",
        base_unit=unit,
        reorder_level=Decimal("2.00"),
    )
    hod_user, hod = make_employee(
        username="hod-originator",
        code="HOD-001",
        department=department,
        branch=branch,
        role="Department Head",
    )
    keeper_user, keeper = make_employee(
        username="keeper",
        code="KEEP-001",
        department=department,
        branch=branch,
        role="Store Keeper",
    )
    StoreKeeperAssignment.objects.create(store=store, employee=keeper, is_active=True)

    client = APIClient()
    client.force_authenticate(hod_user)
    created = client.post(
        "/api/v1/store-requisitions/",
        {
            "store": str(store.pk),
            "purpose": "Breakfast service",
        },
        format="json",
    )
    assert created.status_code == 201, created.data
    request_id = created.data["id"]
    assert created.data["status"] == StoreRequisitionStatus.DRAFT
    assert str(created.data["requested_by"]) == str(hod.pk)
    assert str(created.data["department"]) == str(department.pk)

    line = client.post(
        "/api/v1/store-requisition-items/",
        {
            "requisition": request_id,
            "item": str(item.pk),
            "unit": str(unit.pk),
            "quantity_requested": "10.00",
            "quantity_approved": "0.00",
            "quantity_issued": "0.00",
            "remarks": "For breakfast setup",
        },
        format="json",
    )
    assert line.status_code == 201, line.data

    submitted = client.post(
        f"/api/v1/store-requisitions/{request_id}/submit/",
        {},
        format="json",
    )
    assert submitted.status_code == 200, submitted.data

    requisition = StoreRequisition.objects.get(pk=request_id)
    request_line = StoreRequisitionItem.objects.get(pk=line.data["id"])
    assert requisition.status == StoreRequisitionStatus.SUBMITTED
    assert requisition.department_approved_by == hod
    assert requisition.department_approved_at is not None
    assert request_line.hod_approved_quantity == Decimal("10.00")
    assert request_line.quantity_approved == Decimal("0.00")

    # The assigned Store Keeper receives the HOD-originated request immediately.
    client.force_authenticate(keeper_user)
    queue = client.get("/api/v1/store-requisitions/")
    assert queue.status_code == 200
    rows = queue.data.get("results", queue.data)
    assert str(request_id) in {str(row["id"]) for row in rows}


@pytest.mark.django_db
def test_store_keeper_quantity_can_only_stay_same_or_reduce_after_first_decision():
    department = Department.objects.create(name="Housekeeping")
    branch = Branch.objects.create(name="Quantity Property")
    store = StoreLocation.objects.create(branch=branch, name="Housekeeping Store", is_active=True)
    unit = UnitOfMeasure.objects.create(name="Bottles", abbreviation="btl")
    category = Category.objects.create(name="Cleaning")
    item = Item.objects.create(
        category=category,
        name="Surface cleaner",
        sku="HOD-QTY-001",
        unit="btl",
        base_unit=unit,
        reorder_level=Decimal("2.00"),
    )
    hod_user, _ = make_employee(
        username="quantity-hod",
        code="HOD-QTY",
        department=department,
        branch=branch,
        role="Department Head",
    )
    keeper_user, keeper = make_employee(
        username="quantity-keeper",
        code="KEEP-QTY",
        department=department,
        branch=branch,
        role="Store Keeper",
    )
    StoreKeeperAssignment.objects.create(store=store, employee=keeper, is_active=True)

    client = APIClient()
    client.force_authenticate(hod_user)
    request_response = client.post(
        "/api/v1/store-requisitions/",
        {"store": str(store.pk), "purpose": "Cleaning supplies"},
        format="json",
    )
    request_id = request_response.data["id"]
    line_response = client.post(
        "/api/v1/store-requisition-items/",
        {
            "requisition": request_id,
            "item": str(item.pk),
            "unit": str(unit.pk),
            "quantity_requested": "10.00",
            "quantity_approved": "0.00",
            "quantity_issued": "0.00",
        },
        format="json",
    )
    line_id = line_response.data["id"]
    assert client.post(f"/api/v1/store-requisitions/{request_id}/submit/", {}, format="json").status_code == 200

    client.force_authenticate(keeper_user)
    first = client.patch(
        f"/api/v1/store-requisition-items/{line_id}/",
        {"quantity_approved": "6.00", "storekeeper_comment": "Carry six"},
        format="json",
    )
    assert first.status_code == 200, first.data

    increase = client.patch(
        f"/api/v1/store-requisition-items/{line_id}/",
        {"quantity_approved": "8.00"},
        format="json",
    )
    assert increase.status_code == 400
    assert "cannot be increased" in str(increase.data).lower()

    reduce_again = client.patch(
        f"/api/v1/store-requisition-items/{line_id}/",
        {"quantity_approved": "4.00"},
        format="json",
    )
    assert reduce_again.status_code == 200, reduce_again.data

    zero = client.patch(
        f"/api/v1/store-requisition-items/{line_id}/",
        {"quantity_approved": "0.00", "storekeeper_comment": "Do not carry this line"},
        format="json",
    )
    assert zero.status_code == 200, zero.data

    restore = client.patch(
        f"/api/v1/store-requisition-items/{line_id}/",
        {"quantity_approved": "1.00"},
        format="json",
    )
    assert restore.status_code == 400
    assert "cannot be increased" in str(restore.data).lower()


@pytest.mark.django_db
def test_requester_role_is_retired_without_automatic_hod_promotion():
    department = Department.objects.create(name="Legacy Department")
    branch = Branch.objects.create(name="Legacy Property")
    user, _ = make_employee(
        username="legacy-requester",
        code="LEGACY-REQ",
        department=department,
        branch=branch,
        role="Requester",
    )

    sync_client_roles()
    user.refresh_from_db()

    assert not Group.objects.filter(name="Requester").exists()
    assert not user.groups.filter(name="Department Head").exists()
