from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.departments.models import Branch
from apps.inventory.models import Category, InventoryBalance, InventoryBatch, Item, StoreLocation


@pytest.mark.django_db
@pytest.mark.parametrize("path", [
    "daily-crucial-activities", "pending-actions", "exceptions", "user-activity",
    "stock-movement-control", "approval-trail", "direct-workspace",
    "supplier-price-changes", "management-summary",
])
def test_control_reports_are_live_and_available_to_authorized_users(path):
    user = get_user_model().objects.create_superuser(
        username=f"control-{path}", employee_code=f"CTRL-{path[:12]}", password="test-pass-123",
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get(f"/api/v1/reports/{path}/")

    assert response.status_code == 200
    assert "results" in response.data
    assert response.data["count"] == len(response.data["results"])


@pytest.mark.django_db
def test_stock_summary_report_returns_valuation_for_permitted_user():
    # This test verifies valuation math. Role/report authorization is covered by
    # test_report_role_access.py, so use an administrator to avoid coupling the
    # calculation assertion to a particular operational role's branch/store scope.
    user = get_user_model().objects.create_superuser(
        username="valuation-admin",
        employee_code="EMP-VAL-ADMIN",
        password="test-pass-123",
    )
    branch = Branch.objects.create(name="Main Hotel")
    store = StoreLocation.objects.create(branch=branch, name="Main Store")
    category = Category.objects.create(name="Food")
    item = Item.objects.create(
        category=category,
        name="Rice",
        sku="RICE-VAL",
        unit="kg",
        reorder_level=Decimal("10.00"),
    )
    InventoryBalance.objects.create(
        item=item,
        store=store,
        quantity_in_stock=Decimal("20.00"),
    )
    InventoryBatch.objects.create(
        item=item,
        store=store,
        quantity=Decimal("20.00"),
        remaining_quantity=Decimal("20.00"),
        unit_cost=Decimal("5000.00"),
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/v1/reports/stock-summary/")

    assert response.status_code == 200
    assert response.data["total_value"] == "100000.00"
    assert response.data["results"][0]["sku"] == "RICE-VAL"


@pytest.mark.django_db
def test_stock_summary_report_can_be_scoped_to_branch():
    # Administrators may explicitly select a property/branch. Operational users
    # remain restricted by their role and employee/store assignment.
    user = get_user_model().objects.create_superuser(
        username="branch-report-admin",
        employee_code="EMP-REPORT-ADMIN",
        password="test-pass-123",
    )
    category = Category.objects.create(name="Beverages")
    first_branch = Branch.objects.create(name="First Hotel")
    second_branch = Branch.objects.create(name="Second Hotel")
    first_store = StoreLocation.objects.create(branch=first_branch, name="First Store")
    second_store = StoreLocation.objects.create(branch=second_branch, name="Second Store")
    first_item = Item.objects.create(
        category=category, name="Tea", sku="TEA-001", unit="kg", reorder_level=Decimal("0.00")
    )
    second_item = Item.objects.create(
        category=category, name="Coffee", sku="COF-001", unit="kg", reorder_level=Decimal("0.00")
    )
    InventoryBalance.objects.create(item=first_item, store=first_store, quantity_in_stock=Decimal("2.00"))
    InventoryBalance.objects.create(item=second_item, store=second_store, quantity_in_stock=Decimal("3.00"))
    InventoryBatch.objects.create(
        item=first_item, store=first_store, quantity=Decimal("2.00"),
        remaining_quantity=Decimal("2.00"), unit_cost=Decimal("100.00"),
    )
    InventoryBatch.objects.create(
        item=second_item, store=second_store, quantity=Decimal("3.00"),
        remaining_quantity=Decimal("3.00"), unit_cost=Decimal("200.00"),
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get(f"/api/v1/reports/stock-summary/?branch={first_branch.id}")

    assert response.status_code == 200
    assert response.data["total_value"] == "200.00"
    assert [row["sku"] for row in response.data["results"]] == ["TEA-001"]


@pytest.mark.django_db
def test_materials_analysis_catalogue_returns_live_abc_stock_data():
    user = get_user_model().objects.create_superuser(
        username="abc-analysis-admin",
        employee_code="EMP-ABC-ADMIN",
        password="test-pass-123",
    )
    branch = Branch.objects.create(name="Analysis Hotel")
    store = StoreLocation.objects.create(branch=branch, name="Analysis Store")
    category = Category.objects.create(name="Analysis Food")
    item = Item.objects.create(
        category=category,
        name="Analysis Rice",
        sku="ABC-RICE",
        unit="kg",
        reorder_level=Decimal("0.00"),
    )
    InventoryBalance.objects.create(item=item, store=store, quantity_in_stock=Decimal("10.00"))
    InventoryBatch.objects.create(
        item=item,
        store=store,
        quantity=Decimal("10.00"),
        remaining_quantity=Decimal("10.00"),
        unit_cost=Decimal("1000.00"),
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/v1/reports/analysis/abcAnalysis/")

    assert response.status_code == 200
    assert response.data["title"] == "ABC Analysis"
    assert response.data["columns"][0]["key"] == "article"
    assert response.data["results"] == [{
        "article": "Analysis Rice (ABC-RICE)",
        "sku": "ABC-RICE",
        "store": "Analysis Store (Analysis Hotel)",
        "on_hand": "10.00",
        "value": "10000.00",
        "class": "A",
        "cumulative": "100.00",
    }]


@pytest.mark.django_db
def test_every_materials_analysis_menu_entry_has_a_live_report_endpoint():
    user = get_user_model().objects.create_superuser(
        username="materials-catalogue-admin",
        employee_code="EMP-MATERIALS-CATALOGUE",
        password="test-pass-123",
    )
    client = APIClient()
    client.force_authenticate(user=user)
    report_kinds = (
        "purchasePrices", "purchaseStatisticsItem", "reorderProposal", "purchaseStatisticsSupplier",
        "purchaseReceivingDeviation", "abcAnalysis", "priceVariance", "receiptsJournal", "supplierInvoices",
        "salesOverview", "salesStatistics", "salesTaxAnalysis", "salesActivity", "articlePotentialUsage",
        "menuEngineering", "requirementsUsage", "costOfSalesLocation", "warehouseStatistics",
        "costCenterComparison", "dailyFood", "groupAnalysis", "majorGroupLists", "fbResult",
        "monthlyReport", "lastEstimate", "fbBudget",
    )

    for kind in report_kinds:
        response = client.get(f"/api/v1/reports/analysis/{kind}/")
        assert response.status_code == 200, kind
        assert response.data["title"]
        assert response.data["columns"]
        assert "results" in response.data


@pytest.mark.django_db
def test_return_reconciliation_register_enforces_role_and_valid_type():
    from django.contrib.auth.models import Group
    keeper = get_user_model().objects.create_user(
        username="return-report-keeper", employee_code="RPT-RET-KEEP"
    )
    keeper.groups.add(Group.objects.get_or_create(name="Store Keeper")[0])
    allowed = APIClient()
    allowed.force_authenticate(keeper)
    for kind in ("supplier", "department"):
        response = allowed.get(f"/api/v1/reports/return-reconciliation/?type={kind}")
        assert response.status_code == 200, response.data
        assert response.data["results"] == []
        assert response.data["unreconciled_count"] == 0
    invalid = allowed.get("/api/v1/reports/return-reconciliation/?type=unknown")
    assert invalid.status_code == 400

    ap = get_user_model().objects.create_user(
        username="return-report-ap", employee_code="RPT-RET-AP"
    )
    ap.groups.add(Group.objects.get_or_create(name="Accounts Payable Clerk")[0])
    denied = APIClient()
    denied.force_authenticate(ap)
    assert denied.get("/api/v1/reports/return-reconciliation/?type=supplier").status_code == 403


@pytest.mark.django_db
def test_warehouse_reports_keep_unlike_units_separate_and_use_posted_wac():
    user = get_user_model().objects.create_superuser(username="wh-wac", employee_code="WH-WAC", password="test-password")
    branch = Branch.objects.create(name="Warehouse property")
    store = StoreLocation.objects.create(branch=branch, name="Warehouse")
    category = Category.objects.create(name="Warehouse supplies")
    for name, unit, quantity, cost in (("Oil", "litre", "3.1250", "1000.0000"), ("Soap", "each", "4", "500.0000")):
        item = Item.objects.create(category=category, name=name, sku="WH-"+name, unit=unit, reorder_level=Decimal("0.0000"))
        InventoryBalance.objects.create(item=item, store=store, quantity_in_stock=Decimal(quantity), weighted_average_cost=Decimal(cost))
    client = APIClient()
    client.force_authenticate(user)
    response = client.get("/api/v1/reports/analysis/warehouseStatistics/")
    assert response.status_code == 200, response.data
    assert response.data["results"][0]["value"] == "5125.00"
    assert "on_hand" not in response.data["results"][0]
    assert {row["unit"] for row in response.data["detail_results"]} == {"litre", "each"}
    assert len(response.data["detail_results"]) == 2


@pytest.mark.django_db
def test_pos_cost_report_uses_frozen_cost_and_never_invents_missing_values():
    from datetime import date
    from apps.materials_control.models import POSImportBatch, POSSaleLine
    user = get_user_model().objects.create_superuser(username="pos-cost-report", employee_code="POS-COST-RPT", password="test-password")
    branch = Branch.objects.create(name="POS cost property")
    store = StoreLocation.objects.create(branch=branch, name="Restaurant")
    batch = POSImportBatch.objects.create(outlet=store, business_date=date(2026,11,24), source_reference="Z1")
    for ref, cost in (("A", Decimal("400.00")), ("B", None)):
        POSSaleLine.objects.create(batch=batch, external_plu=ref, external_reference=ref, quantity=Decimal("1"),
                                   net_sales=Decimal("1000.00"), cost_of_goods_sold=cost, inventory_changes_applied=True)
    client = APIClient()
    client.force_authenticate(user)
    response = client.get("/api/v1/reports/analysis/costOfSalesLocation/?date_from=2026-11-24&date_to=2026-11-24")
    assert response.status_code == 200, response.data
    row = response.data["results"][0]
    assert row["sales"] == "2000.00"
    assert row["cogs"] is None and row["profit"] is None and row["unpriced"] == 1
    assert [detail["cogs"] for detail in response.data["detail_results"]] == ["400.00", None]
    assert client.get("/api/v1/reports/analysis/costOfSalesLocation/?date_from=2026-11-25").data["results"] == []


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["Cost Controller", "Financial Manager"])
def test_client_report_catalogue_scope_and_booked_inventory_values(role):
    from datetime import date
    from django.contrib.auth.models import Group
    from apps.departments.models import Department
    from apps.employees.models import Employee
    from apps.inventory.models import MonthEndCycle, MonthEndInventory
    user = get_user_model().objects.create_user(username="catalogue-reader", employee_code="CAT-READ", password="test-password")
    user.groups.add(Group.objects.get_or_create(name=role)[0])
    department = Department.objects.create(name="Cost review")
    own = Branch.objects.create(name="Own report property")
    other = Branch.objects.create(name="Other report property")
    Employee.objects.create(user=user, department=department, branch=own, designation=role)
    category = Category.objects.create(name="Catalogue articles")
    item = Item.objects.create(category=category, name="Catalogue rice", sku="CAT-RICE", unit="kg", reorder_level=Decimal("2"))
    for branch in (own, other):
        store = StoreLocation.objects.create(branch=branch, name=branch.name + " store")
        InventoryBalance.objects.create(store=store, item=item, quantity_in_stock=Decimal("0"), weighted_average_cost=Decimal("1000"))
        cycle = MonthEndCycle.objects.create(branch=branch, cutoff=date(2026,10,31), memo_reference="CAT", memo="Count", status="booked", created_by=user)
        MonthEndInventory.objects.create(cycle=cycle, store=store, location_name=store.name, count_snapshot=[{
            "sku":item.sku,"article":item.name,"unit":"kg","physical_quantity":"3.1250","system_quantity":"4.0000","unit_cost":"1000.0000","note":"Count variance"
        }])
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/v1/reports/analysis/monthlyStoreBalance/")
    assert response.status_code == 200, response.data
    assert len(response.data["results"]) == 1
    row = response.data["results"][0]
    assert row["store"] == own.name + " store"
    assert Decimal(row["closing_value"]) == Decimal("3125")
    assert Decimal(row["variance_value"]) == Decimal("-875")
    assert row["opening_value"] is None
    assert client.get("/api/v1/reports/analysis/monthlyStoreBalance/", {"branch":str(other.pk)}).data["results"] == []
    assert len(client.get("/api/v1/reports/analysis/dailyOutOfStock/").data["results"]) == 1
    assert client.get("/api/v1/reports/analysis/stockCover/").data["results"][0]["cover"] is None
