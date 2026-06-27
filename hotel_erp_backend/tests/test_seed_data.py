from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.customers.models import Customer
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import InventoryBalance, Item
from apps.organization.models import Hotel
from apps.vendors.models import Supplier


@pytest.mark.django_db
def test_seed_uganda_data_populates_empty_database_and_refuses_overwrite(monkeypatch):
    monkeypatch.delenv("SEED_EMPLOYEE_PASSWORD", raising=False)
    output = StringIO()

    call_command(
        "seed_uganda_data",
        hotel_name="Pearl Test Hotel",
        stdout=output,
    )

    assert Hotel.objects.get().name == "Pearl Test Hotel"
    assert Branch.objects.count() == 2
    assert Department.objects.count() == 8
    assert Employee.objects.count() == 4
    assert Supplier.objects.count() == 4
    assert Item.objects.count() == 6
    assert InventoryBalance.objects.count() == 5
    assert Customer.objects.count() == 4
    assert not get_user_model().objects.get(username="jokello").has_usable_password()
    assert "created successfully" in output.getvalue()

    with pytest.raises(CommandError, match="already contains application data"):
        call_command("seed_uganda_data", hotel_name="Another Hotel")


@pytest.mark.django_db
def test_seed_uganda_data_reset_replaces_existing_demo_data(monkeypatch):
    monkeypatch.setenv("SEED_EMPLOYEE_PASSWORD", "sample-pass-123")
    call_command("seed_uganda_data", hotel_name="First Hotel", verbosity=0)

    call_command(
        "seed_uganda_data",
        hotel_name="Replacement Hotel",
        reset=True,
        verbosity=0,
    )

    assert list(Hotel.objects.values_list("name", flat=True)) == ["Replacement Hotel"]
    assert get_user_model().objects.get(username="jokello").check_password(
        "sample-pass-123"
    )
