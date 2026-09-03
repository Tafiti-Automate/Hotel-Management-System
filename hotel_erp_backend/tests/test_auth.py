import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.files.base import ContentFile as SimpleContentFile
from django.core.management import call_command
from django.test import override_settings
from apps.departments.models import Branch, Department
from apps.employees.models import Employee


def link_employee(user, suffix):
    branch = Branch.objects.create(
        name=f"Auth Branch {suffix}",
        branch_code=f"AUTH-{suffix}",
    )
    department = Department.objects.create(name=f"Auth Department {suffix}")
    return Employee.objects.create(
        user=user,
        branch=branch,
        department=department,
        designation="Test Employee",
    )


@pytest.mark.django_db
def test_custom_user_uses_employee_code():
    user = get_user_model().objects.create_user(
        username="jane",
        employee_code="EMP-001",
        password="test-pass-123",
    )
    link_employee(user, "CODE")

    assert user.employee_code == "EMP-001"
    assert user.check_password("test-pass-123")


@pytest.mark.django_db
def test_api_login_accepts_superuser_username(client):
    user = get_user_model().objects.create_superuser(
        username="admin",
        employee_code="EMP-ADMIN",
        password="test-pass-123",
    )

    response = client.post(
        "/api/v1/auth/login/",
        {"username": "admin", "password": "test-pass-123"},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json()["user"]["username"] == user.username
    assert response.json()["user"]["is_superuser"] is True
    assert response.json()["token"]


@pytest.mark.django_db
def test_api_login_accepts_employee_code(client):
    user = get_user_model().objects.create_user(
        username="jane",
        employee_code="EMP-001",
        password="test-pass-123",
    )
    link_employee(user, "LOGIN")

    response = client.post(
        "/api/v1/auth/login/",
        {"username": "EMP-001", "password": "test-pass-123"},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json()["user"]["username"] == user.username


@pytest.mark.django_db
def test_role_permission_changes_are_returned_on_next_login(client):
    admin = get_user_model().objects.create_superuser(
        username="access-admin", employee_code="EMP-ACCESS-ADMIN", password="test-pass-123"
    )
    user = get_user_model().objects.create_user(
        username="store-user", employee_code="EMP-STORE", password="test-pass-123"
    )
    link_employee(user, "ROLE")
    role = Group.objects.create(name="Custom Store Role")
    user.groups.set([role])
    permission = Permission.objects.get(
        content_type__app_label="employees", codename="view_employee"
    )

    client.force_login(admin)
    response = client.patch(
        f"/api/v1/roles/{role.pk}/",
        {"permission_ids": [permission.pk]},
        content_type="application/json",
    )
    assert response.status_code == 200

    client.logout()
    response = client.post(
        "/api/v1/auth/login/",
        {"username": user.username, "password": "test-pass-123"},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert "employees.view_employee" in response.json()["user"]["permissions"]


@override_settings(CORS_ALLOWED_ORIGINS=["https://hotel.example.com"])
def test_api_login_allows_configured_frontend_origin(client):
    response = client.options(
        "/api/v1/auth/login/",
        HTTP_ORIGIN="https://hotel.example.com",
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://hotel.example.com"


@pytest.mark.django_db
def test_setup_hotel_roles_creates_operational_groups():
    call_command("setup_hotel_roles")

    assert set(Group.objects.values_list("name", flat=True)) == {
        "System Administrator",
        "Requester",
        "Department Head",
        "Cost Controller",
        "Store Keeper",
        "Receiving Clerk",
        "Financial Manager",
        "Procurement Manager",
        "General Manager",
    }
    requester = Group.objects.get(name="Requester")
    store_keeper = Group.objects.get(name="Store Keeper")
    department_head = Group.objects.get(name="Department Head")
    financial_manager = Group.objects.get(name="Financial Manager")
    receiving_clerk = Group.objects.get(name="Receiving Clerk")
    procurement_manager = Group.objects.get(name="Procurement Manager")

    assert requester.permissions.filter(codename="add_storerequisition").exists()
    assert requester.permissions.filter(codename="add_storerequisitionitem").exists()
    assert store_keeper.permissions.filter(codename="change_storerequisition").exists()
    assert not store_keeper.permissions.filter(codename="add_storerequisition").exists()
    assert store_keeper.permissions.filter(codename="change_storerequisitionitem").exists()
    assert department_head.permissions.filter(codename="change_storerequisition").exists()
    assert department_head.permissions.filter(codename="change_storerequisitionitem").exists()
    assert not department_head.permissions.filter(codename="view_inventorybalance").exists()
    assert financial_manager.permissions.filter(codename="change_purchaseorder").exists()
    assert financial_manager.permissions.filter(codename="change_purchaseorderapprovalworkflow").exists()
    assert receiving_clerk.permissions.filter(codename="change_goodsreceiptnote").exists()
    assert procurement_manager.permissions.filter(codename="change_purchaseorder").exists()
    assert procurement_manager.permissions.filter(codename="add_vendorquotation").exists()
    assert procurement_manager.permissions.filter(codename="change_vendorquotationitem").exists()
    assert not procurement_manager.permissions.filter(codename="change_goodsreceiptnote").exists()
    assert not procurement_manager.permissions.filter(codename="view_supplierinvoice").exists()


@pytest.mark.django_db
def test_setup_hotel_roles_migrates_legacy_assignments_before_removal():
    finance_user = get_user_model().objects.create_user(
        username="legacy-finance",
        employee_code="LEGACY-FIN",
    )
    stores_user = get_user_model().objects.create_user(
        username="legacy-stores",
        employee_code="LEGACY-STORES",
    )
    director_user = get_user_model().objects.create_user(
        username="legacy-director",
        employee_code="LEGACY-DIRECTOR",
    )
    finance_user.groups.add(Group.objects.create(name="Finance Controller"))
    stores_user.groups.add(Group.objects.create(name="Stores Manager"))
    director_user.groups.add(Group.objects.create(name="Director"))

    call_command("setup_hotel_roles", verbosity=0)

    assert list(finance_user.groups.values_list("name", flat=True)) == ["Financial Manager"]
    assert list(stores_user.groups.values_list("name", flat=True)) == ["Store Keeper"]
    assert list(director_user.groups.values_list("name", flat=True)) == ["General Manager"]
    assert not Group.objects.filter(
        name__in=("Finance Controller", "Stores Manager", "Director")
    ).exists()


@pytest.mark.django_db
def test_ensure_superuser_creates_and_updates_from_env(monkeypatch):
    monkeypatch.setenv("DJANGO_SUPERUSER_USERNAME", "admin2")
    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "123")
    monkeypatch.setenv("DJANGO_SUPERUSER_EMPLOYEE_CODE", "EMP-ADMIN2")
    monkeypatch.setenv("DJANGO_SUPERUSER_EMAIL", "admin2@example.com")

    call_command("ensure_superuser")

    user = get_user_model().objects.get(username="admin2")
    assert user.employee_code == "EMP-ADMIN2"
    assert user.email == "admin2@example.com"
    assert user.is_staff
    assert user.is_superuser
    assert user.check_password("123")

    monkeypatch.setenv("DJANGO_SUPERUSER_PASSWORD", "new-password")
    call_command("ensure_superuser")

    user.refresh_from_db()
    assert user.check_password("new-password")

@pytest.mark.django_db
def test_current_user_payload_has_stable_user_and_employee_identifiers(client):
    from apps.departments.models import Branch, Department
    from apps.employees.models import Employee

    branch = Branch.objects.create(name="Main Branch", branch_code="MAIN")
    department = Department.objects.create(name="Housekeeping")
    user = get_user_model().objects.create_user(
        username="payload-user",
        employee_code="EMP-PAYLOAD",
        password="test-pass-123",
    )
    employee = Employee.objects.create(
        user=user,
        department=department,
        branch=branch,
        designation="Attendant",
    )
    client.force_login(user)
    response = client.get("/api/v1/auth/me/")
    assert response.status_code == 200
    assert response.data["id"] == str(user.pk)
    assert response.data["user_id"] == str(user.pk)
    assert response.data["employee_id"] == str(employee.pk)
    assert response.data["employee_code"] == "EMP-PAYLOAD"
    assert response.data["branch_id"] == str(branch.pk)
    assert response.data["department_id"] == str(department.pk)


@pytest.mark.django_db
def test_current_user_payload_contains_employee_photo_url(client, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    settings.MEDIA_URL = "/media/"
    user = get_user_model().objects.create_user(
        username="photo-user", employee_code="EMP-PHOTO", password="test-pass-123"
    )
    employee = link_employee(user, "PHOTO")
    employee.photo.save("profile.jpg", SimpleContentFile(b"profile"), save=True)
    client.force_login(user)

    response = client.get("/api/v1/auth/me/")

    assert response.status_code == 200
    assert response.json()["photo_url"].endswith("/media/employee_photos/profile.jpg")
