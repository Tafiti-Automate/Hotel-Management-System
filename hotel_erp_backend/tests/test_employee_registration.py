import base64

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import serializers
from rest_framework.test import APIRequestFactory

from apps.departments.models import Department
from apps.employees.models import Employee
from apps.employees.serializers import EmployeeSerializer
from apps.employees.views import EmployeeViewSet


@pytest.mark.django_db
def test_employee_registration_creates_linked_user_account():
    department = Department.objects.create(name="Front Office")
    serializer = EmployeeSerializer(
        data={
            "first_name": "Grace",
            "last_name": "Atim",
            "email": "grace.atim@example.com",
            "password": "Temporary-pass-123",
            "department": str(department.id),
            "designation": "Reception Supervisor",
            "contact": "+256700100200",
            "date_joined": "2026-07-27",
            "is_active": True,
        }
    )

    assert serializer.is_valid(), serializer.errors
    employee = serializer.save()

    assert Employee.objects.get(pk=employee.pk).user.get_full_name() == "Grace Atim"
    assert employee.user.employee_code.startswith("EMP-")
    assert employee.user.check_password("Temporary-pass-123")


@pytest.mark.django_db
def test_employee_update_keeps_account_and_changes_personal_details():
    department = Department.objects.create(name="Housekeeping")
    create_serializer = EmployeeSerializer(
        data={
            "first_name": "Sarah",
            "last_name": "Nabirye",
            "password": "Temporary-pass-123",
            "department": str(department.id),
            "designation": "Room Attendant",
        }
    )
    assert create_serializer.is_valid(), create_serializer.errors
    employee = create_serializer.save()
    user_id = employee.user_id

    update_serializer = EmployeeSerializer(
        employee,
        data={
            "first_name": "Sarah",
            "last_name": "Nabirye-Kato",
            "department": str(department.id),
            "designation": "Housekeeping Supervisor",
        },
        partial=True,
    )
    assert update_serializer.is_valid(), update_serializer.errors
    updated = update_serializer.save()

    assert updated.user_id == user_id
    assert updated.user.last_name == "Nabirye-Kato"
    assert updated.designation == "Housekeeping Supervisor"


@pytest.mark.django_db
def test_employee_removal_is_a_soft_deactivation():
    department = Department.objects.create(name="Security")
    serializer = EmployeeSerializer(
        data={
            "first_name": "Peter",
            "last_name": "Okello",
            "password": "Temporary-pass-123",
            "department": str(department.id),
            "designation": "Security Officer",
        }
    )
    assert serializer.is_valid(), serializer.errors
    employee = serializer.save()

    view = EmployeeViewSet()
    view.request = APIRequestFactory().delete("/")
    view.perform_destroy(employee)
    employee.refresh_from_db()
    employee.user.refresh_from_db()

    assert employee.is_active is False
    assert employee.user.is_active is False


@pytest.mark.django_db
def test_employee_photo_accepts_supported_small_image():
    department = Department.objects.create(name="People Operations")
    photo = SimpleUploadedFile("employee.png", base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), content_type="image/png")
    serializer = EmployeeSerializer(
        data={
            "first_name": "Mercy",
            "last_name": "Akello",
            "password": "Temporary-pass-123",
            "department": str(department.id),
            "designation": "Receiving Clerk",
            "photo": photo,
        }
    )
    assert serializer.is_valid(), serializer.errors


def test_employee_photo_rejects_unsupported_content_type():
    photo = SimpleUploadedFile("employee.svg", b"<svg></svg>", content_type="image/svg+xml")
    serializer = EmployeeSerializer()
    with pytest.raises(serializers.ValidationError):
        serializer.validate_photo(photo)
