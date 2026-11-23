"""Regression checks for salary-advance creation and draft validation."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee, SalaryAdvance
from apps.employees.payroll_serializers import SalaryAdvanceSerializer


@pytest.fixture
def salary_advance_context(db):
    call_command("setup_hotel_roles", verbosity=0)
    branch = Branch.objects.create(name="Salary Advance API Property")
    department = Department.objects.create(name="Salary Advance API Department")
    hr = get_user_model().objects.create_user(
        username="salary-advance-hr",
        employee_code="SA-HR-001",
        password="test-pass-123",
    )
    hr.groups.add(Group.objects.get(name="HR Manager"))
    Employee.objects.create(user=hr, branch=branch, department=department, designation="HR Manager")
    recipient_user = get_user_model().objects.create_user(
        username="salary-advance-staff",
        employee_code="SA-STAFF-001",
        password="test-pass-123",
    )
    recipient = Employee.objects.create(
        user=recipient_user, branch=branch, department=department, designation="Receptionist",
    )
    client = APIClient()
    client.force_authenticate(user=hr)
    return client, hr, recipient


@pytest.mark.django_db
def test_salary_advance_draft_creates_with_balance_equal_to_principal(salary_advance_context):
    client, actor, employee = salary_advance_context
    response = client.post("/api/v1/salary-advances/", {
        "employee": str(employee.pk),
        "principal_amount": "4000000.00",
        "monthly_installment": "200000.00",
        "request_date": "2026-11-23",
        "reason": "Approved staff request awaiting Finance review",
    }, format="json")

    assert response.status_code == 201, response.data
    advance = SalaryAdvance.objects.get(pk=response.data["id"])
    assert advance.balance == Decimal("4000000.00")
    assert advance.principal_amount == Decimal("4000000.00")
    assert advance.monthly_installment == Decimal("200000.00")
    assert advance.created_by_id == actor.pk
    assert advance.status == SalaryAdvance.STATUS_DRAFT
    assert advance.approved_by is None

    listing = client.get("/api/v1/salary-advances/")
    assert listing.status_code == 200, listing.data
    assert str(advance.pk) in {str(row["id"]) for row in listing.data["results"]}


@pytest.mark.django_db
def test_salary_advance_overlarge_instalment_returns_validation_error_not_500(salary_advance_context):
    client, _, employee = salary_advance_context
    response = client.post("/api/v1/salary-advances/", {
        "employee": str(employee.pk),
        "principal_amount": "100000.00",
        "monthly_installment": "200000.00",
        "request_date": "2026-11-23",
        "reason": "Should fail validation",
    }, format="json")
    assert response.status_code == 400, response.data
    assert "monthly_installment" in str(response.data)
    assert not SalaryAdvance.objects.exists()


@pytest.mark.django_db
def test_salary_advance_balance_cannot_be_supplied_by_hr(salary_advance_context):
    client, _, employee = salary_advance_context
    response = client.post("/api/v1/salary-advances/", {
        "employee": str(employee.pk),
        "principal_amount": "100000.00",
        "monthly_installment": "25000.00",
        "balance": "0.00",
        "request_date": "2026-11-23",
        "reason": "Check server-owned initial balance",
    }, format="json")
    assert response.status_code == 201, response.data
    advance = SalaryAdvance.objects.get(pk=response.data["id"])
    assert advance.balance == Decimal("100000.00")


def test_new_salary_advance_serializer_keeps_balance_server_owned():
    serializer = SalaryAdvanceSerializer()
    assert serializer.fields["balance"].read_only is True
