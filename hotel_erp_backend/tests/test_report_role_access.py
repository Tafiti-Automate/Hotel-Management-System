import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient


ROLE_REPORT_PATHS = {
    "Department Head": [
        "department-requests",
        "store-issues",
    ],
    "Cost Controller": [
        "low-stock",
        "procurement-summary",
        "supplier-price-changes",
    ],
    "Procurement Manager": [
        "purchase-requisitions",
        "purchase-orders",
        "goods-receipts",
        "procurement-summary",
        "pending-actions",
        "exceptions",
        "approval-trail",
        "direct-workspace",
        "supplier-price-changes",
    ],
    "Financial Manager": [
        "purchase-orders",
        "goods-receipts",
        "procurement-summary",
        "pending-actions",
        "exceptions",
        "approval-trail",
        "management-summary",
    ],
    "Accounts Payable Clerk": [
        "purchase-orders",
        "goods-receipts",
        "pending-actions",
        "exceptions",
    ],
    "General Manager": [
        "purchase-orders",
        "goods-receipts",
        "stock-summary",
        "consumption",
        "procurement-summary",
        "pending-actions",
        "exceptions",
        "approval-trail",
        "management-summary",
    ],
    "Receiving Clerk": [
        "purchase-orders",
        "goods-receipts",
        "pending-actions",
        "exceptions",
        "direct-workspace",
    ],
}


def make_role_user(role: str):
    slug = role.lower().replace(" ", "-")
    user = get_user_model().objects.create_user(
        username=f"report-{slug}",
        employee_code=f"RPT-{slug[:14]}",
        password="test-pass-123",
    )
    group, _ = Group.objects.get_or_create(name=role)
    user.groups.add(group)
    return user


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("role", "paths"),
    list(ROLE_REPORT_PATHS.items()),
)
def test_client_roles_can_open_their_assigned_operational_reports(role, paths):
    client = APIClient()
    client.force_authenticate(user=make_role_user(role))

    for path in paths:
        response = client.get(f"/api/v1/reports/{path}/")
        assert response.status_code == 200, (
            f"{role} should be able to open {path}, got {response.status_code}: "
            f"{getattr(response, 'data', None)}"
        )


@pytest.mark.django_db
def test_department_head_cannot_open_procurement_or_management_reports():
    client = APIClient()
    client.force_authenticate(user=make_role_user("Department Head"))

    for path in ("purchase-orders", "procurement-summary", "management-summary"):
        response = client.get(f"/api/v1/reports/{path}/")
        assert response.status_code == 403


@pytest.mark.django_db
def test_receiving_clerk_cannot_open_supplier_price_control_report():
    client = APIClient()
    client.force_authenticate(user=make_role_user("Receiving Clerk"))

    response = client.get("/api/v1/reports/supplier-price-changes/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_materials_analysis_catalogue_enforces_its_own_report_role_access():
    client = APIClient()
    client.force_authenticate(user=make_role_user("Cost Controller"))

    allowed = client.get("/api/v1/reports/analysis/purchasePrices/")
    assert allowed.status_code == 200
    assert allowed.data["title"] == "Article Purchase Prices"

    client.force_authenticate(user=make_role_user("Department Head"))
    denied = client.get("/api/v1/reports/analysis/purchasePrices/")
    assert denied.status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["Cost Controller", "Financial Manager"])
def test_shared_materials_catalogue_report_access(role):
    client = APIClient()
    client.force_authenticate(user=make_role_user(role))
    from apps.reports.views import MATERIALS_SHARED_REPORT_IDS, REPORT_ROLE_ACCESS
    for report in MATERIALS_SHARED_REPORT_IDS:
        assert role in REPORT_ROLE_ACCESS[report]
    for report in ("issueDeviation", "issueDeviationReason", "requestTransfer", "monthlyStoreBalance", "dailyOutOfStock", "stockForecast", "articleDocumentHistory", "bookingJournal", "stockCover", "stockTakeLinewise", "usageStatistics", "consumptionInventory", "salesTaxAnalysis", "supplierInvoices", "fbBudget"):
        response = client.get(f"/api/v1/reports/analysis/{report}/")
        assert response.status_code == 200, (report, response.data)
        assert response.data["results"] == []


@pytest.mark.django_db
def test_new_materials_reports_do_not_grant_department_head_access():
    client = APIClient()
    client.force_authenticate(user=make_role_user("Department Head"))
    for report in ("issueDeviation", "issueDeviationReason", "requestTransfer", "monthlyStoreBalance", "dailyOutOfStock", "stockForecast", "articleDocumentHistory", "bookingJournal", "stockCover", "stockTakeLinewise", "usageStatistics", "consumptionInventory",):
        assert client.get(f"/api/v1/reports/analysis/{report}/").status_code == 403


@pytest.mark.django_db
def test_storekeeper_cannot_access_report_center_endpoints():
    client=APIClient();client.force_authenticate(make_role_user("Store Keeper"))
    for path in ("stock-summary","consumption","goods-receipts","analysis/purchasePrices","analysis/stockCover"):
        assert client.get(f"/api/v1/reports/{path}/").status_code==403
