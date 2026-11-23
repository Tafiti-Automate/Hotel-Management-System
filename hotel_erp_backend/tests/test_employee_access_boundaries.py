"""HR employee API security: scoped reads/writes and IT-owned account access."""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.organization.models import Hotel


@pytest.fixture
def hr_security(db):
    call_command("setup_hotel_roles", verbosity=0)
    hotel_a = Hotel.objects.create(name="HR Security Hotel A")
    hotel_b = Hotel.objects.create(name="HR Security Hotel B")
    home = Branch.objects.create(name="HR A Main", hotel=hotel_a)
    sibling = Branch.objects.create(name="HR A Annex", hotel=hotel_a)
    outsider = Branch.objects.create(name="HR B Main", hotel=hotel_b)
    dept = Department.objects.create(name="HR Security Department")
    user_model = get_user_model()

    def person(code, branch, role=None):
        user = user_model.objects.create_user(
            username="hr-security-" + code, employee_code="HR-SEC-" + code,
            password="test-pass-123", first_name=code, last_name="Employee",
        )
        if role:
            user.groups.add(Group.objects.get(name=role))
        employee = Employee.objects.create(
            user=user, branch=branch, department=dept, designation=role or "Staff",
        )
        return user, employee

    manager, manager_employee = person("manager", home, "HR Manager")
    finance, finance_employee = person("finance", sibling, "Financial Manager")
    local, local_employee = person("local", sibling, "Receptionist")
    remote, remote_employee = person("remote", outsider, "Payroll Officer")
    admin = user_model.objects.create_user(
        username="hr-security-admin", employee_code="HR-SEC-ADMIN",
        password="test-pass-123",
    )
    admin.groups.add(Group.objects.get(name="System Administrator"))
    def client(user):
        api = APIClient()
        api.force_authenticate(user=user)
        return api

    return {
        "manager": manager, "manager_employee": manager_employee,
        "finance": finance, "finance_employee": finance_employee,
        "local": local, "local_employee": local_employee,
        "remote_employee": remote_employee, "home": home,
        "sibling": sibling, "outsider": outsider, "dept": dept,
        "hr_client": client(manager), "admin_client": client(admin),
        "remote_client": client(remote),
    }


@pytest.mark.django_db
def test_hr_directory_scoped_to_own_hotel_with_it_access_across_hotels(hr_security):
    ctx = hr_security
    hr_response = ctx["hr_client"].get("/api/v1/employees/")
    assert hr_response.status_code == 200, hr_response.data
    employee_ids = {row["id"] for row in hr_response.data["results"]}
    assert str(ctx["manager_employee"].pk) in employee_ids
    assert str(ctx["local_employee"].pk) in employee_ids
    assert str(ctx["finance_employee"].pk) in employee_ids
    assert str(ctx["remote_employee"].pk) not in employee_ids
    other = ctx["remote_client"].get("/api/v1/employees/")
    assert other.status_code == 200, other.data
    assert {row["id"] for row in other.data["results"]} == {str(ctx["remote_employee"].pk)}
    admin = ctx["admin_client"].get("/api/v1/employees/")
    assert admin.status_code == 200
    assert str(ctx["remote_employee"].pk) in {row["id"] for row in admin.data["results"]}


@pytest.mark.django_db
def test_hr_cannot_edit_other_hotel_or_create_staff_there(hr_security):
    ctx = hr_security
    endpoint = "/api/v1/employees/"
    denied_edit = ctx["hr_client"].patch(
        endpoint + str(ctx["remote_employee"].pk) + "/",
        {"designation": "Unauthorized"}, format="json",
    )
    assert denied_edit.status_code == 404, denied_edit.data
    ctx["remote_employee"].refresh_from_db()
    assert ctx["remote_employee"].designation == "Payroll Officer"
    # Even a visible employee cannot be transferred out of HR's hotel.
    move_other_hotel = ctx["hr_client"].patch(
        endpoint + str(ctx["local_employee"].pk) + "/",
        {"branch": str(ctx["outsider"].pk)}, format="json",
    )
    assert move_other_hotel.status_code == 403, move_other_hotel.data
    ctx["local_employee"].refresh_from_db()
    assert ctx["local_employee"].branch_id == ctx["sibling"].pk
    wrong_hotel = ctx["hr_client"].post(endpoint, {
        "first_name": "Cross", "last_name": "Hotel",
        "department": str(ctx["dept"].pk), "branch": str(ctx["outsider"].pk),
        "designation": "Test", "password": "temporary-pass-123",
    }, format="json")
    assert wrong_hotel.status_code == 403, wrong_hotel.data
    assert not get_user_model().objects.filter(first_name="Cross", last_name="Hotel").exists()
    new_local = ctx["hr_client"].post(endpoint, {
        "first_name": "New", "last_name": "Colleague",
        "department": str(ctx["dept"].pk), "branch": str(ctx["sibling"].pk),
        "designation": "Room Attendant", "password": "temporary-pass-123",
    }, format="json")
    assert new_local.status_code == 201, new_local.data
    saved = Employee.objects.get(pk=new_local.data["id"])
    assert saved.branch_id == ctx["sibling"].pk
    assert not saved.user.groups.exists()
    assert saved.user.employee_code.startswith("EMP-")


@pytest.mark.django_db
def test_hr_cannot_assign_roles_reset_password_or_change_account_ids(hr_security):
    ctx = hr_security
    endpoint = "/api/v1/employees/"
    finance_role = Group.objects.get(name="Financial Manager")
    role_creation = ctx["hr_client"].post(endpoint, {
        "first_name": "Fake", "last_name": "Finance",
        "department": str(ctx["dept"].pk), "branch": str(ctx["home"].pk),
        "designation": "Finance Manager", "password": "temporary-pass-123",
        "role": finance_role.pk,
    }, format="json")
    assert role_creation.status_code == 400, role_creation.data
    assert not get_user_model().objects.filter(first_name="Fake", last_name="Finance").exists()
    local_id = str(ctx["local_employee"].pk)
    assert ctx["hr_client"].patch(endpoint + local_id + "/", {
        "role": finance_role.pk,
    }, format="json").status_code == 400
    assert ctx["hr_client"].patch(endpoint + local_id + "/", {
        "password": "attacker-password-123",
    }, format="json").status_code == 400
    assert ctx["hr_client"].patch(endpoint + local_id + "/", {
        "employee_code": "NEW-ADMIN-CODE",
    }, format="json").status_code == 400
    ctx["local"].refresh_from_db()
    assert ctx["local"].check_password("test-pass-123")
    assert ctx["local"].employee_code == "HR-SEC-local"
    assert list(ctx["local"].groups.values_list("name", flat=True)) == ["Receptionist"]
    # HR cannot choose custom account identities for new staff.
    custom_id = ctx["hr_client"].post(endpoint, {
        "first_name": "Privileged", "last_name": "Identity",
        "department": str(ctx["dept"].pk), "branch": str(ctx["home"].pk),
        "designation": "Staff", "password": "temporary-pass-123",
        "employee_code": "SYS-ATTEMPT",
    }, format="json")
    assert custom_id.status_code == 400, custom_id.data


@pytest.mark.django_db
def test_it_can_assign_role_and_reset_credentials_hr_cannot_deactivate_finance(hr_security):
    ctx = hr_security
    endpoint = "/api/v1/employees/"
    local_id = str(ctx["local_employee"].pk)
    role = Group.objects.get(name="Department Supervisor")
    changed = ctx["admin_client"].patch(endpoint + local_id + "/", {
        "role": role.pk, "password": "admin-reset-pass-123",
    }, format="json")
    assert changed.status_code == 200, changed.data
    ctx["local"].refresh_from_db()
    assert ctx["local"].groups.filter(pk=role.pk).exists()
    assert ctx["local"].check_password("admin-reset-pass-123")
    finance_id = str(ctx["finance_employee"].pk)
    denied = ctx["hr_client"].patch(endpoint + finance_id + "/", {
        "is_active": False,
    }, format="json")
    assert denied.status_code == 400, denied.data
    denied_delete = ctx["hr_client"].delete(endpoint + finance_id + "/")
    assert denied_delete.status_code == 403, denied_delete.data
    ctx["finance_employee"].refresh_from_db()
    assert ctx["finance_employee"].is_active
