import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import override_settings


@pytest.mark.django_db
def test_custom_user_uses_employee_code():
    user = get_user_model().objects.create_user(
        username="jane",
        employee_code="EMP-001",
        password="test-pass-123",
    )

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

    response = client.post(
        "/api/v1/auth/login/",
        {"username": "EMP-001", "password": "test-pass-123"},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json()["user"]["username"] == user.username


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

    stores_manager = Group.objects.get(name="Stores Manager")
    procurement_manager = Group.objects.get(name="Procurement Manager")
    auditor = Group.objects.get(name="Auditor")

    assert stores_manager.permissions.filter(codename="change_stockissue").exists()
    assert stores_manager.permissions.filter(codename="change_stockcount").exists()
    assert procurement_manager.permissions.filter(codename="change_purchaseorder").exists()
    assert procurement_manager.permissions.filter(codename="change_supplierreturn").exists()
    assert procurement_manager.permissions.filter(codename="view_goodsreceiptnote").exists()
    assert procurement_manager.permissions.filter(codename="view_goodsreceiptitem").exists()
    assert not procurement_manager.permissions.filter(codename="change_goodsreceiptnote").exists()
    assert not procurement_manager.permissions.filter(codename="view_supplierinvoice").exists()
    assert auditor.permissions.filter(codename="view_stockledger").exists()


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
