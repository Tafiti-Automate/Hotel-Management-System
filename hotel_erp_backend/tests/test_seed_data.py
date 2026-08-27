from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.customers.models import Customer
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.finance.models import Expense, SupplierInvoice
from apps.inventory.models import (
    InventoryBalance,
    Item,
    ItemUnitPrice,
    StoreLocation,
    StockIssue,
    StockTransfer,
    SupplierItemPrice,
)
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


@pytest.mark.django_db(transaction=True)
def test_operational_reseed_preserves_accounts_and_builds_supplier_catalogue():
    user_model = get_user_model()
    call_command("setup_hotel_roles", verbosity=0)
    admin = user_model.objects.create_superuser(
        username="preserved-admin",
        employee_code="PRES-ADMIN",
        email="admin@example.com",
        password="Preserved-Admin-Password-01!",
    )
    requester = user_model.objects.create_user(
        username="preserved-requester",
        employee_code="PRES-REQ",
        email="requester@example.com",
        password="Preserved-Requester-Password-02!",
    )
    requester.groups.add(Group.objects.get(name="Requester"))
    old_hotel = Hotel.objects.create(name="Old production hotel", created_by=admin)
    old_branch = Branch.objects.create(
        hotel=old_hotel,
        name="Old branch",
        created_by=admin,
    )
    old_department = Department.objects.create(
        name="Housekeeping",
        description="Existing requester work context",
        created_by=admin,
    )
    Employee.objects.create(
        user=requester,
        branch=old_branch,
        department=old_department,
        designation="Requester",
        contact="+256700111222",
        created_by=admin,
    )
    Supplier.objects.create(
        name="Old supplier",
        email="old-supplier@example.com",
        phone="+256700000000",
        address="Old address",
        tin_number="OLD-TIN-001",
        registration_number="OLD-REG-001",
        created_by=admin,
    )

    original_admin_hash = admin.password
    original_requester_hash = requester.password

    call_command(
        "reseed_operational_data",
        execute=True,
        confirm="RESEED-OPERATIONAL-DATA",
        allow_non_production=True,
        skip_backup=True,
        verbosity=0,
    )

    assert user_model.objects.count() == 2
    restored_admin = user_model.objects.get(username="preserved-admin")
    restored_requester = user_model.objects.get(username="preserved-requester")
    assert restored_admin.password == original_admin_hash
    assert restored_requester.password == original_requester_hash
    assert restored_admin.check_password("Preserved-Admin-Password-01!")
    assert restored_requester.check_password("Preserved-Requester-Password-02!")
    assert list(restored_requester.groups.values_list("name", flat=True)) == ["Requester"]
    assert restored_requester.employee_profile.branch.name == "Main Branch"
    assert restored_requester.employee_profile.department.name == "Housekeeping"
    assert restored_requester.employee_profile.contact == "+256700111222"

    assert Hotel.objects.count() == 1
    assert Hotel.objects.get().name == "Tafiti Hotel"
    assert Branch.objects.count() == 1
    assert Branch.objects.get().name == "Main Branch"
    assert StoreLocation.objects.count() == 1
    assert StoreLocation.objects.get().name == "Main Store"
    assert not Supplier.objects.filter(email="old-supplier@example.com").exists()
    assert Supplier.objects.count() == 5
    assert list(Supplier.objects.filter(email="mugishawarid@gmail.com").values_list("name", flat=True))
    assert Supplier.objects.filter(email="mugishawarid@gmail.com").count() == 2
    assert set(Supplier.objects.values_list("email", flat=True)) == {
        "mugishawarid@gmail.com",
        "kjapher38@gmail.com",
        "wmugisha@kcca.go.ug",
        "watumwaizaac32@gmail.com",
    }
    assert Item.objects.count() == 4
    assert ItemUnitPrice.objects.count() == 4
    assert SupplierItemPrice.objects.count() == 10
    assert InventoryBalance.objects.count() == 4
    assert not InventoryBalance.objects.exclude(quantity_in_stock=0).exists()

    for sku in ("TAF-RICE-25", "TAF-WATER-500", "TAF-SOAP-5L", "TAF-PAPER-A4"):
        assert Item.objects.get(sku=sku).supplier_prices.count() >= 2


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
    assert Employee.objects.count() == 15
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
    assert list(
        get_user_model().objects.get(username="esther.requester").groups.values_list(
            "name", flat=True
        )
    ) == ["Requester"]
    assert get_user_model().objects.get(username="grace.generalmanager").check_password(
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
        ("esther.requester", "Requester", "DEMO_REQUESTER_PASSWORD", "Requester-Test-Password-01!"),
        (
            "rebecca.departmenthead",
            "Department Head",
            "DEMO_DEPARTMENT_HEAD_PASSWORD",
            "Department-Test-Password-02!",
        ),
        (
            "alice.costcontroller",
            "Cost Controller",
            "DEMO_COST_CONTROLLER_PASSWORD",
            "Cost-Control-Test-Password-03!",
        ),
        (
            "samuel.storekeeper",
            "Store Keeper",
            "DEMO_STORE_KEEPER_PASSWORD",
            "Store-Test-Password-04!",
        ),
        (
            "daniel.procurementmanager",
            "Procurement Manager",
            "DEMO_PROCUREMENT_MANAGER_PASSWORD",
            "Procurement-Test-Password-05!",
        ),
        (
            "ruth.financialmanager",
            "Financial Manager",
            "DEMO_FINANCIAL_MANAGER_PASSWORD",
            "Finance-Test-Password-06!",
        ),
        (
            "grace.generalmanager",
            "General Manager",
            "DEMO_GENERAL_MANAGER_PASSWORD",
            "Manager-Test-Password-07!",
        ),
        (
            "mercy.receivingclerk",
            "Receiving Clerk",
            "DEMO_RECEIVING_CLERK_PASSWORD",
            "Receiving-Test-Password-08!",
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
        assert not user.user_permissions.exists()


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
