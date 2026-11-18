"""Phase B acceptance: quantity-only Market List source and independent approvals."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.role_templates import sync_client_roles
from apps.approvals.models import ApprovalMatrixRule
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import Category, Item, SupplierItemPrice, UnitOfMeasure
from apps.procurement.models import PurchaseRequisition, RequisitionHistory, RequisitionItem
from apps.vendors.models import Supplier
from core.constants.choices import ProcurementSource, PRStatus


def actor(role, key, branch, department):
    user = get_user_model().objects.create_user(
        username=f"market-{key}", employee_code=f"MARKET-{key}",
        password="test-only-market",
    )
    user.groups.add(Group.objects.get(name=role))
    employee = Employee.objects.create(
        user=user, branch=branch, department=department, designation=role,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return user, employee, client


@pytest.mark.django_db
def test_daily_market_list_never_leaks_supplier_prices_and_reuses_pr_approval():
    sync_client_roles()
    branch = Branch.objects.create(name="Market Kitchen")
    department = Department.objects.create(name="Market Food Production")
    head, employee, hod = actor("Department Head", "HEAD", branch, department)
    _, _, buyer = actor("Procurement Manager", "BUY", branch, department)
    _, fin_employee, finance = actor("Financial Manager", "FIN", branch, department)
    _, _, receiver = actor("Receiving Clerk", "RECV", branch, department)
    other = Branch.objects.create(name="Other hotel market")
    _, _, outside = actor("Department Head", "OUT", other, department)
    unit = UnitOfMeasure.objects.create(name="Market kg", abbreviation="mkg")
    category = Category.objects.create(name="Market vegetables")
    fresh = Item.objects.create(
        name="Fresh tomatoes", sku="MKT-TOMATO", unit="kg",
        base_unit=unit, category=category,
        reorder_level=Decimal("0"), expiry_tracking=True,
    )
    normal = Item.objects.create(
        name="Office paper", sku="MKT-PAPER", unit="ream",
        base_unit=unit, category=category, reorder_level=Decimal("0"),
    )
    endpoint = "/api/v1/requisitions/market-lists/"
    payload = {
        "purpose": "Breakfast tomatoes for today's service",
        "lines": [{"item": str(fresh.pk), "quantity": "1.1255", "unit": str(unit.pk)}],
        # Client-controlled commercial fields must not be trusted.
        "estimated_unit_cost": "1", "preferred_supplier": "bogus",
        "status": "approved",
    }

    assert receiver.get(endpoint).status_code == 403
    assert receiver.post(endpoint, payload, format="json").status_code == 403
    assert outside.get(endpoint).status_code == 200
    assert outside.get(endpoint).data["results"] == []
    assert hod.post(endpoint, {
        "purpose": "Wrong article",
        "lines": [{"item": str(normal.pk), "quantity": "1.0000"}],
    }, format="json").status_code == 400
    assert hod.post(endpoint, {
        "purpose": "Overprecision",
        "lines": [{"item": str(fresh.pk), "quantity": "0.12345"}],
    }, format="json").status_code == 400

    created = hod.post(endpoint, payload, format="json")
    assert created.status_code == 201, created.data
    reference = created.data["id"]
    pr = PurchaseRequisition.objects.get(pk=reference)
    assert pr.requester_id == employee.pk
    assert pr.branch_id == branch.pk
    assert pr.procurement_source == ProcurementSource.MARKET_LIST
    assert pr.status == PRStatus.DRAFT
    assert "estimated_total" not in str(created.data)
    assert "price" not in str(created.data).lower()
    assert "supplier" not in str(created.data).lower()
    line = RequisitionItem.objects.get(requisition=pr)
    assert line.quantity == Decimal("1.1255")
    assert line.estimated_unit_cost == Decimal("0.00")

    market_list = hod.get(endpoint)
    assert market_list.status_code == 200
    assert len(market_list.data["results"]) == 1
    assert len(buyer.get(endpoint).data["results"]) == 1
    assert not outside.get(endpoint).data["results"]
    assert finance.get(endpoint).status_code == 200

    # Without a published commercial quote, it must not enter the approval
    # matrix with an artificial zero budget commitment.
    submit_url = f"/api/v1/requisitions/{pr.pk}/submit-market-list/"
    missing = hod.post(submit_url)
    assert missing.status_code == 400, missing.data
    pr.refresh_from_db()
    assert pr.status == PRStatus.DRAFT
    assert hod.post(f"/api/v1/requisitions/{pr.pk}/submit/").status_code == 403
    assert buyer.post(submit_url).status_code == 403

    supplier = Supplier.objects.create(
        name="Market Fresh Supplier", email="fresh-market@example.com",
        phone="+256700456789", address="Kampala",
        tin_number="MKT-QUOTE-TIN", registration_number="MKT-QUOTE-REG",
    )
    quote = SupplierItemPrice.objects.create(
        supplier=supplier, item=fresh, unit=unit,
        unit_price=Decimal("4500.00"), effective_from=timezone.localdate(),
        quotation_valid_until=timezone.localdate(), currency="UGX", is_active=True,
    )
    ApprovalMatrixRule.objects.create(
        name="Market independent Financial Manager",
        document_type=ApprovalMatrixRule.DOCUMENT_PURCHASE_REQUISITION,
        branch=branch, department=department,
        minimum_amount=Decimal("0"), stage=1,
        stage_name="Independent Finance review",
        approver=fin_employee, is_active=True,
    )
    submitted = hod.post(submit_url)
    assert submitted.status_code == 200, submitted.data
    assert submitted.data["status"] == PRStatus.SUBMITTED
    assert "price" not in str(submitted.data).lower()
    line.refresh_from_db()
    assert line.estimated_unit_cost == Decimal("4500.00")
    assert pr.approval_workflow.count() == 1
    assert pr.approval_workflow.first().approver_id == fin_employee.pk
    assert RequisitionHistory.objects.filter(
        requisition=pr, action="market_list_created"
    ).exists()
    assert RequisitionHistory.objects.filter(
        requisition=pr, action="submitted"
    ).exists()
    assert hod.post(submit_url).status_code == 400
    # External, approved purchasing remains a separate step; creating the
    # Market List never posts SOH, a PO or a financial journal.
    assert pr.purchase_orders.count() == 0
    quote.is_active = False
    quote.save(update_fields=["is_active"])


@pytest.mark.django_db
def test_market_list_expired_quote_cannot_be_used_for_approval():
    sync_client_roles()
    branch = Branch.objects.create(name="Market Second")
    department = Department.objects.create(name="Market Kitchen 2")
    _, employee, hod = actor("Department Head", "HEAD2", branch, department)
    unit = UnitOfMeasure.objects.create(name="Market litre", abbreviation="mLitre")
    item = Item.objects.create(
        name="Fresh milk", sku="MKT-MILK", unit="litre",
        base_unit=unit, category=Category.objects.create(name="Dairy market"),
        reorder_level=Decimal("0"), requires_delivery_temperature=True,
    )
    endpoint = "/api/v1/requisitions/market-lists/"
    response = hod.post(endpoint, {
        "purpose": "Breakfast milk",
        "lines": [{"item": str(item.pk), "quantity": "2.5000"}],
    }, format="json")
    assert response.status_code == 201, response.data
    pr = PurchaseRequisition.objects.get(pk=response.data["id"])
    assert pr.requester_id == employee.pk
    assert pr.items.count() == 1
    assert hod.post(f"/api/v1/requisitions/{pr.pk}/submit-market-list/").status_code == 400
