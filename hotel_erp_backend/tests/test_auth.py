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
