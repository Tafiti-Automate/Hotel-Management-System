"""Phase 1: actual Django collection contracts behind enterprise role screens.

These are GET-only smoke checks. They must not grant posting or approval rights.
The requests deliberately use empty, authenticated role accounts to catch 403/404
before a page is populated with data.
"""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient


ROLE_SCREEN_COLLECTIONS = {
    # Stocktake variance review requires the historical ledger and frozen counts.
    "Cost Controller": [
        "stock-counts", "stock-count-items", "items", "stock-ledger",
        "supplier-item-prices", "supplier-price-quotes", "vendors", "units",
    ],
    # Finance must inspect all three legs of invoice matching, returns, and counts.
    "Financial Manager": [
        "stock-counts", "stock-count-items", "items", "stock-ledger",
        "supplier-invoices", "supplier-invoice-items", "purchase-orders",
        "purchase-order-items", "grns", "grn-items", "supplier-returns",
        "cost-center-budgets", "budget-overrides", "branches", "departments",
        "fiscal-periods", "gl-exports",
    ],
    "Accounts Payable Clerk": [
        "supplier-invoices", "supplier-invoice-items", "purchase-orders",
        "purchase-order-items", "grns", "grn-items", "supplier-returns",
    ],
    "Store Keeper": [
        "stock-counts", "stock-count-items", "items", "inventory-balances",
        "grns", "grn-items", "stock-ledger", "stores",
    ],
    "Receiving Clerk": ["purchase-orders", "purchase-order-items", "grns"],
    "Procurement Manager": [
        "requisitions", "requisition-items", "supplier-item-prices",
        "vendors", "purchase-orders", "supplier-price-quotes", "items", "units",
    ],
    "Department Head": [
        "items", "units", "storerequisitions-placeholder",
    ],
}


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("role", "endpoint"),
    [(role, endpoint) for role, paths in ROLE_SCREEN_COLLECTIONS.items()
     for endpoint in paths if endpoint != "storerequisitions-placeholder"],
)
def test_authorized_screen_collections_do_not_return_403_or_404(role, endpoint):
    call_command("setup_hotel_roles", verbosity=0)
    slug = role.lower().replace(" ", "-")
    user = get_user_model().objects.create_user(
        username=f"contract-{slug}",
        employee_code=f"PHASE1-{slug}"[:40],
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name=role))
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get(f"/api/v1/{endpoint}/")
    assert response.status_code == 200, (
        f"{role} visible screen dependency GET {endpoint} returned "
        f"{response.status_code}: {getattr(response, 'data', None)}"
    )


@pytest.mark.django_db
def test_department_supervisor_does_not_receive_full_stock_ledger_by_default():
    call_command("setup_hotel_roles", verbosity=0)
    user = get_user_model().objects.create_user(
        username="contract-dept-supervisor", employee_code="PHASE1-SUP",
        password="test-pass-123",
    )
    user.groups.add(Group.objects.get(name="Department Supervisor"))
    client = APIClient()
    client.force_authenticate(user=user)
    assert client.get("/api/v1/stock-ledger/").status_code == 403
