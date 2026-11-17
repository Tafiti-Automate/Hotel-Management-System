from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import Category, Item, SupplierItemPrice, UnitOfMeasure
from apps.vendors.models import Supplier


def _employee(role, code, department, branch):
    user = get_user_model().objects.create_user(
        username=f"{role.lower().replace(' ', '-')}-{code}",
        employee_code=code,
        password="quote-test-pass",
    )
    group, _ = Group.objects.get_or_create(name=role)
    user.groups.add(group)
    Employee.objects.create(
        user=user, branch=branch, department=department, designation=role,
    )
    return user


@pytest.mark.django_db
def test_buyers_propose_cost_control_publishes_vendor_quote_with_discount():
    department = Department.objects.create(name="F&B Vendor Quotes")
    branch = Branch.objects.create(name="Enterprise Quotation Property")
    buyer = _employee("Procurement Officer", "QUOTE-BUYER", department, branch)
    controller = _employee("Cost Controller", "QUOTE-COST", department, branch)
    supplier = Supplier.objects.create(
        name="Proposed Vendor", email="quote@example.com",
        phone="+256700000321", address="Kampala",
        tin_number="TIN-QUOTECONTROL", registration_number="REG-QUOTECONTROL",
    )
    category = Category.objects.create(name="Quotation ingredients")
    unit = UnitOfMeasure.objects.create(name="Quotation Kilogram", abbreviation="qkg")
    item = Item.objects.create(
        category=category, name="Quote Coffee", sku="QUOTE-COFFEE",
        unit="kg", base_unit=unit,
    )
    buyer_api = APIClient()
    buyer_api.force_authenticate(buyer)
    response = buyer_api.post("/api/v1/supplier-price-quotes/", {
        "supplier": str(supplier.pk), "item": str(item.pk), "unit": str(unit.pk),
        "quotation_reference": "SUP-QT-123", "currency": "UGX",
        "unit_price": "10000.00", "discount_percent": "10.00",
        "fixed_order_quantity": "5.00", "valid_from": "2026-11-01",
        "valid_to": "2026-12-31", "is_preferred": True,
    }, format="json")
    assert response.status_code == 201, response.data
    quote_id = response.data["id"]
    assert not SupplierItemPrice.objects.filter(item=item, supplier=supplier).exists()

    submitted = buyer_api.post(
        f"/api/v1/supplier-price-quotes/{quote_id}/submit/", {}, format="json"
    )
    assert submitted.status_code == 200, submitted.data
    assert submitted.data["status"] == "submitted"
    assert buyer_api.post(
        f"/api/v1/supplier-price-quotes/{quote_id}/approve/", {}, format="json"
    ).status_code == 403
    assert not SupplierItemPrice.objects.filter(item=item, supplier=supplier).exists()

    controller_api = APIClient()
    controller_api.force_authenticate(controller)
    approved = controller_api.post(
        f"/api/v1/supplier-price-quotes/{quote_id}/approve/",
        {"note": "Verified signed quotation and discount"},
        format="json",
    )
    assert approved.status_code == 200, approved.data
    assert approved.data["status"] == "approved"
    catalogue = SupplierItemPrice.objects.get(item=item, supplier=supplier)
    assert catalogue.unit_price == Decimal("10000.00")
    assert catalogue.discount_percent == Decimal("10.00")
    assert catalogue.base_unit_price == Decimal("9000.00")
    assert catalogue.is_preferred
    assert buyer_api.post(
        f"/api/v1/supplier-price-quotes/{quote_id}/submit/", {}, format="json"
    ).status_code == 400
    assert controller_api.post(
        f"/api/v1/supplier-price-quotes/{quote_id}/approve/", {}, format="json"
    ).status_code == 400
