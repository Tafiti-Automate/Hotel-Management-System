from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.customers.models import Customer
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.finance.models import Expense, SupplierInvoice
from apps.inventory.models import InventoryBalance, Item, StockIssue, StockTransfer
from apps.notifications.models import Notification
from apps.organization.models import Hotel
from apps.procurement.models import (
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseRequisition,
    VendorQuotation,
)
from apps.sales.models import Sale
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


@pytest.mark.django_db
def test_seed_presentation_data_builds_connected_uganda_workflows(monkeypatch):
    monkeypatch.setenv("SEED_EMPLOYEE_PASSWORD", "sample-pass-123")
    output = StringIO()

    call_command(
        "seed_presentation_data",
        hotel_name="Pearl Presentation Hotel",
        stdout=output,
    )

    assert Hotel.objects.get().name == "Pearl Presentation Hotel"
    assert Branch.objects.count() == 2
    assert Employee.objects.count() == 14
    assert Supplier.objects.count() == 6
    assert PurchaseRequisition.objects.count() == 2
    assert VendorQuotation.objects.count() == 3
    assert PurchaseOrder.objects.count() == 1
    assert GoodsReceiptNote.objects.count() == 1
    assert SupplierInvoice.objects.get().status == SupplierInvoice.STATUS_PAID
    assert StockIssue.objects.count() == 1
    assert StockTransfer.objects.count() == 1
    assert Sale.objects.count() == 2
    assert Notification.objects.count() >= 4
    assert Notification.objects.filter(
        title__contains="requires approval"
    ).exists()
    assert get_user_model().objects.get(username="grace.nakato").check_password(
        "sample-pass-123"
    )
    assert "created successfully" in output.getvalue()

    counts = {
        "employees": Employee.objects.count(),
        "requisitions": PurchaseRequisition.objects.count(),
        "sales": Sale.objects.count(),
    }
    call_command("seed_presentation_data", verbosity=0)
    assert Employee.objects.count() == counts["employees"]
    assert PurchaseRequisition.objects.count() == counts["requisitions"]
    assert Sale.objects.count() == counts["sales"]

    account_specs = (
        ("anankya", "Store Keeper", "DEMO_STORE_KEEPER_PASSWORD", "Store-Test-Password-01!"),
        (
            "esther.nambasa",
            None,
            "DEMO_DEPARTMENT_HEAD_PASSWORD",
            "Department-Test-Password-02!",
        ),
        (
            "grace.nakato",
            "General Manager",
            "DEMO_GENERAL_MANAGER_PASSWORD",
            "Manager-Test-Password-03!",
        ),
        (
            "daniel.okello",
            "Procurement Manager",
            "DEMO_PROCUREMENT_MANAGER_PASSWORD",
            "Procurement-Test-Password-04!",
        ),
    )
    for _, _, variable_name, password in account_specs:
        monkeypatch.setenv(variable_name, password)

    call_command("enable_presentation_accounts", verbosity=0)

    for username, role, _, password in account_specs:
        user = get_user_model().objects.get(username=username)
        assert user.check_password(password)
        assert list(user.groups.values_list("name", flat=True)) == ([role] if role else [])
        assert not user.is_staff
        assert not user.is_superuser
        assert user.user_permissions.filter(codename="add_storerequisition").exists()


@pytest.mark.django_db
def test_seed_historical_operations_adds_to_existing_branch_idempotently():
    hotel = Hotel.objects.create(name="Existing Hotel")
    branch = Branch.objects.create(
        hotel=hotel,
        name="Kampala Property",
        branch_code="KLA",
        is_active=True,
    )
    department = Department.objects.create(name="Operations")
    user = get_user_model().objects.create_user(username="history.operator")
    Employee.objects.create(
        user=user,
        department=department,
        branch=branch,
        designation="Operations Manager",
    )

    preview = StringIO()
    call_command("seed_historical_operations", branch="KLA", days=28, stdout=preview)
    assert "PREVIEW ONLY" in preview.getvalue()
    assert Sale.objects.count() == 0

    call_command(
        "seed_historical_operations",
        branch="KLA",
        days=28,
        commit=True,
        verbosity=0,
    )
    assert Sale.objects.count() == 38
    assert Expense.objects.count() == 12
    assert PurchaseRequisition.objects.count() == 15
    assert PurchaseOrder.objects.count() == 15
    assert GoodsReceiptNote.objects.count() == 15
    assert StockIssue.objects.count() == 15
    assert all(sale.inventory_changes_applied for sale in Sale.objects.all())

    call_command(
        "seed_historical_operations",
        branch="KLA",
        days=28,
        commit=True,
        verbosity=0,
    )
    assert Sale.objects.count() == 38
    assert Expense.objects.count() == 12
    assert PurchaseRequisition.objects.count() == 15
    assert StockIssue.objects.count() == 15
