import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command


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
def test_setup_hotel_roles_creates_operational_groups():
    call_command("setup_hotel_roles")

    stores_manager = Group.objects.get(name="Stores Manager")
    procurement_manager = Group.objects.get(name="Procurement Manager")
    auditor = Group.objects.get(name="Auditor")

    assert stores_manager.permissions.filter(codename="change_stockissue").exists()
    assert stores_manager.permissions.filter(codename="change_stockcount").exists()
    assert procurement_manager.permissions.filter(codename="change_purchaseorder").exists()
    assert procurement_manager.permissions.filter(codename="change_supplierreturn").exists()
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
