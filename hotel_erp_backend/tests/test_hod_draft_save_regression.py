from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import Category, Item, StoreLocation, UnitOfMeasure


User = get_user_model()


@pytest.mark.django_db
def test_hod_can_save_existing_draft_requisition_details():
    department = Department.objects.create(name="Housekeeping Draft Save")
    branch = Branch.objects.create(name="Draft Save Property")
    store = StoreLocation.objects.create(branch=branch, name="Main Store", is_active=True)
    unit = UnitOfMeasure.objects.create(name="Rolls", abbreviation="roll")
    major = Category.objects.create(name="Kitchen Supplies")
    group = Category.objects.create(name="Disposable Papers", parent=major)
    Item.objects.create(
        category=group,
        name="Air Frying Paper",
        sku="AFP-001",
        unit="roll",
        base_unit=unit,
        reorder_level=Decimal("1.00"),
    )

    user = User.objects.create_user(
        username="hod-draft-save",
        employee_code="HOD-DS-001",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get_or_create(name="Department Head")[0])
    Employee.objects.create(
        user=user,
        department=department,
        branch=branch,
        designation="Department Head",
        is_active=True,
    )

    client = APIClient()
    client.force_authenticate(user)
    created = client.post(
        "/api/v1/store-requisitions/",
        {"purpose": "", "store": str(store.pk)},
        format="json",
    )
    assert created.status_code == 201, created.data

    request_id = created.data["id"]
    saved = client.patch(
        f"/api/v1/store-requisitions/{request_id}/",
        {
            "purpose": "Housekeeping supplies",
            "required_date": "2026-10-13",
            "store": str(store.pk),
        },
        format="json",
    )

    assert saved.status_code == 200, saved.data
    assert saved.data["purpose"] == "Housekeeping supplies"
    assert saved.data["required_date"] == "2026-10-13"
    assert str(saved.data["store"]) == str(store.pk)
