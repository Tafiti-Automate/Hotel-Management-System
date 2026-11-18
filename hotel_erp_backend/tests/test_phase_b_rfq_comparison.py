"""Phase B RFQ comparison, award decisions and commercial role separation."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.role_templates import sync_client_roles
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import Category, Item, UnitOfMeasure
from apps.procurement.models import (
    PurchaseRequisition, RequisitionHistory, RequisitionItem,
    VendorQuotation, VendorQuotationItem,
)
from apps.vendors.models import Supplier
from core.constants.choices import PRStatus


def actor(role, code, branch, department):
    user = get_user_model().objects.create_user(
        username=f"rfq-{code}", employee_code=f"RFQ-{code}",
        password="test-only-rfq",
    )
    user.groups.add(Group.objects.get(name=role))
    Employee.objects.create(
        user=user, branch=branch, department=department, designation=role,
    )
    api = APIClient()
    api.force_authenticate(user=user)
    return user, api


def quotation_for(requisition, line, supplier_number, unit_price, valid_until):
    supplier = Supplier.objects.create(
        name=f"RFQ Vendor {supplier_number}",
        email=f"rfq{supplier_number}@example.com",
        phone=f"+256700000{supplier_number:03d}",
        address="Kampala",
        tin_number=f"RFQ-TIN-{supplier_number}",
        registration_number=f"RFQ-REG-{supplier_number}",
    )
    quotation = VendorQuotation.objects.create(
        requisition=requisition, supplier=supplier,
        valid_until=valid_until, payment_terms="Net 30",
    )
    item = VendorQuotationItem.objects.create(
        quotation=quotation, requisition_item=line,
        quantity=Decimal("2.0000"), unit=line.unit,
        unit_price=Decimal(unit_price),
    )
    return quotation, item


@pytest.mark.django_db
@override_settings(PROCUREMENT_QUOTATION_THRESHOLD=Decimal("100.00"), PROCUREMENT_MIN_QUOTATIONS=3)
def test_rfq_comparison_requires_three_qualified_offers_and_locked_audited_winner():
    sync_client_roles()
    branch = Branch.objects.create(name="RFQ Kampala hotel")
    department = Department.objects.create(name="RFQ Kitchen")
    user, procurement = actor("Procurement Manager", "BUY", branch, department)
    _, finance = actor("Financial Manager", "FIN", branch, department)
    _, controller = actor("Cost Controller", "COST", branch, department)
    _, receiving = actor("Receiving Clerk", "RECV", branch, department)
    remote = Branch.objects.create(name="Other independent RFQ branch")
    _, other_buyer = actor("Procurement Manager", "OUT", remote, department)
    unit = UnitOfMeasure.objects.create(name="RFQ kilogram", abbreviation="rfqkg")
    item = Item.objects.create(
        category=Category.objects.create(name="RFQ provisions"), name="RFQ flour",
        sku="RFQ-FLOUR", base_unit=unit, unit="kg", reorder_level=Decimal("0"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=user.employee_profile, department=department, branch=branch,
        reason="Competitive food procurement", status=PRStatus.APPROVED,
    )
    line = RequisitionItem.objects.create(
        requisition=requisition, item=item, unit=unit,
        quantity=Decimal("2.0000"), approved_quantity=Decimal("2.0000"),
        estimated_unit_cost=Decimal("1500.00"),
    )
    today = timezone.localdate()
    a, a_line = quotation_for(requisition, line, 1, "2500.00", today + timedelta(days=7))
    b, b_line = quotation_for(requisition, line, 2, "3000.00", today + timedelta(days=7))
    c, c_line = quotation_for(requisition, line, 3, "2000.00", today - timedelta(days=1))

    url = f"/api/v1/quotations/comparison/?requisition={requisition.pk}"
    report = procurement.get(url)
    assert report.status_code == 200, report.data
    assert report.data["required_qualified_quotations"] == 3
    assert report.data["qualified_quotation_count"] == 2
    assert report.data["competitive_sourcing_ready"] is False
    expired = next(x for x in report.data["quotes"] if x["id"] == str(c.pk))
    assert not expired["qualified"]
    assert any("expired" in reason.lower() for reason in expired["blockers"])
    assert procurement.post(
        f"/api/v1/quotations/{a.pk}/award/",
        {"selection_reason": "Lowest comparable cost"}, format="json",
    ).status_code == 400

    assert finance.get(url).status_code == 200
    assert controller.get(url).status_code == 200
    assert finance.post(
        f"/api/v1/quotations/{a.pk}/award/",
        {"selection_reason": "Finance tries to award"}, format="json",
    ).status_code == 403
    assert receiving.get(url).status_code == 403
    assert other_buyer.get(url).status_code == 403
    assert other_buyer.post(
        f"/api/v1/quotations/{a.pk}/award/",
        {"selection_reason": "Wrong hotel"}, format="json",
    ).status_code in (403, 404)

    c.valid_until = today + timedelta(days=5)
    c.save(update_fields=["valid_until", "updated_at"])
    qualified = procurement.get(url)
    assert qualified.status_code == 200, qualified.data
    assert qualified.data["qualified_quotation_count"] == 3
    assert qualified.data["competitive_sourcing_ready"] is True
    assert qualified.data["quotes"][0]["id"] == str(c.pk)
    assert qualified.data["quotes"][0]["rank"] == 1
    assert qualified.data["quotes"][0]["comparable_total"] == "4000.00"

    # Client cannot forge a winner through an ordinary line change.
    spoof = procurement.patch(
        f"/api/v1/quotation-items/{a_line.pk}/",
        {"selected": True, "selection_reason": "I override comparison"}, format="json",
    )
    assert spoof.status_code == 200, spoof.data
    a_line.refresh_from_db()
    assert not a_line.selected

    awarded = procurement.post(
        f"/api/v1/quotations/{c.pk}/award/",
        {"selection_reason": "Best normalized price and verified delivery"}, format="json",
    )
    assert awarded.status_code == 200, awarded.data
    c_line.refresh_from_db()
    assert c_line.selected
    a_line.refresh_from_db()
    b_line.refresh_from_db()
    assert not a_line.selected and not b_line.selected
    history = RequisitionHistory.objects.get(requisition=requisition, action="quotation_awarded")
    assert history.performed_by_id == user.pk
    assert history.metadata["quotation_id"] == str(c.pk)
    assert history.metadata["comparable_total"] == "4000.00"

    assert procurement.patch(
        f"/api/v1/quotation-items/{a_line.pk}/",
        {"unit_price": "100.00"}, format="json",
    ).status_code == 400
    assert procurement.delete(f"/api/v1/quotations/{a.pk}/").status_code == 400
    assert procurement.patch(
        f"/api/v1/quotations/{c.pk}/",
        {"discount_amount": "999.00"}, format="json",
    ).status_code == 400


@pytest.mark.django_db
def test_fractional_requisition_quoted_order_quantity_preserves_four_decimal_precision():
    branch = Branch.objects.create(name="RFQ precision branch")
    department = Department.objects.create(name="RFQ precision department")
    unit = UnitOfMeasure.objects.create(name="RFQ precision kilo", abbreviation="rfqpk")
    item = Item.objects.create(
        category=Category.objects.create(name="RFQ fractional category"),
        name="RFQ fractional coffee", sku="RFQ-FRACTIONAL",
        unit="kg", base_unit=unit, reorder_level=Decimal("0"),
    )
    buyer = get_user_model().objects.create_user(
        username="rfq-fractional-buyer", employee_code="RFQ-FRAC",
        password="test-only",
    )
    employee = Employee.objects.create(user=buyer, branch=branch, department=department)
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        reason="Fractional quantity", status=PRStatus.APPROVED,
    )
    line = RequisitionItem.objects.create(
        requisition=requisition, item=item, unit=unit,
        quantity=Decimal("0.1255"), approved_quantity=Decimal("0.1255"),
        estimated_unit_cost=Decimal("1000.00"),
    )
    supplier = Supplier.objects.create(
        name="RFQ Fractional Supplier", email="fractional@example.com",
        phone="+256700222222", address="Kampala",
        tin_number="RFQ-FRAC-TIN", registration_number="RFQ-FRAC-REG",
    )
    quotation = VendorQuotation.objects.create(requisition=requisition, supplier=supplier)
    VendorQuotationItem.objects.create(
        quotation=quotation, requisition_item=line, unit=unit,
        quantity=Decimal("0.1255"), unit_price=Decimal("1000.00"),
    )
    quote_qty, quote_unit, quote_price = requisition._order_pricing_for_item(line, supplier)
    assert quote_qty == Decimal("0.1255")
    assert quote_unit.pk == unit.pk
    assert quote_price == Decimal("1000.00")
