"""Phase D: read-only GRNI reconciliation of posted GRN and matched invoice evidence."""
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.role_templates import sync_client_roles
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.finance.models import SupplierInvoice, SupplierInvoiceItem
from apps.inventory.models import Category, Item, StoreLocation, UnitOfMeasure
from apps.materials_control.grni import grni_reconciliation
from apps.materials_control.models import FiscalPeriod, GLExport
from apps.procurement.models import (
    GoodsReceiptItem, GoodsReceiptNote, PurchaseOrder, PurchaseOrderItem,
    PurchaseRequisition, RequisitionItem,
)
from apps.vendors.models import Supplier
from core.constants.choices import POStatus


@pytest.mark.django_db
def test_finance_grni_reconciles_partial_invoice_without_bookkeeping_or_cross_role_access():
    sync_client_roles()
    today = timezone.localdate()
    branch = Branch.objects.create(name="GRNI first hotel")
    foreign_branch = Branch.objects.create(name="GRNI second hotel")
    dept = Department.objects.create(name="GRNI kitchen")
    finance = get_user_model().objects.create_user(
        username="grni-finance", employee_code="GRNI-FIN", password="test-only",
    )
    keeper = get_user_model().objects.create_user(
        username="grni-keeper", employee_code="GRNI-KEEP", password="test-only",
    )
    finance.groups.add(Group.objects.get(name="Financial Manager"))
    keeper.groups.add(Group.objects.get(name="Store Keeper"))
    Employee.objects.create(user=finance, branch=branch, department=dept)
    Employee.objects.create(user=keeper, branch=branch, department=dept)
    supplier = Supplier.objects.create(
        name="GRNI kitchen supplier", email="grni@example.com",
        phone="+256700023111", address="Kampala",
        tin_number="GRNI-TIN-01", registration_number="GRNI-REG-01",
    )
    unit = UnitOfMeasure.objects.create(name="GRNI kilograms", abbreviation="gkg")
    item = Item.objects.create(
        name="GRNI rice", sku="GRNI-RICE", category=Category.objects.create(name="GRNI food"),
        base_unit=unit, unit="kg", reorder_level=Decimal("0"),
    )
    store = StoreLocation.objects.create(branch=branch, name="GRNI Main Store")
    employee = finance.employee_profile
    pr = PurchaseRequisition.objects.create(
        requester=employee, department=dept, branch=branch, reason="Rice delivery",
    )
    request_line = RequisitionItem.objects.create(
        requisition=pr, item=item, unit=unit,
        quantity=Decimal("4.0000"), estimated_unit_cost=Decimal("100.00"),
    )
    po = PurchaseOrder.objects.create(
        requisition=pr, supplier=supplier, ordered_by=employee, store=store,
    )
    po_line = PurchaseOrderItem.objects.create(
        purchase_order=po, requisition_item=request_line,
        item=item, unit=unit, quantity=Decimal("4.0000"), unit_cost=Decimal("100.00"),
    )
    PurchaseOrder.objects.filter(pk=po.pk).update(status=POStatus.ISSUED)
    po.refresh_from_db()
    receipt = GoodsReceiptNote.objects.create(
        purchase_order=po, received_by=employee, received_date=today,
    )
    rline = GoodsReceiptItem.objects.create(
        goods_receipt=receipt, purchase_order_item=po_line,
        item=item, store=store, quantity_received=Decimal("3.0000"),
        unit_cost=Decimal("100.00"),
    )
    # Fixture represents already verified/posted operational evidence.
    GoodsReceiptItem.objects.filter(pk=rline.pk).update(inventory_changes_applied=True)
    GoodsReceiptNote.objects.filter(pk=receipt.pk).update(
        status="posted", posted_at=timezone.now(),
    )
    period = FiscalPeriod.objects.create(
        branch=branch, name="GRNI current month",
        start_date=today.replace(day=1), end_date=today,
    )
    initial = grni_reconciliation(period)
    assert initial["received_value"] == "300.00"
    assert initial["matched_invoice_value"] == "0.00"
    assert initial["unmatched_receipt_value"] == "300.00"
    assert initial["orders"][0]["received_base_quantity"] == "3.0000"

    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=po,
        invoice_number="GRNI-INV-01", invoice_date=today, due_date=today,
        subtotal=Decimal("100.00"), status=SupplierInvoice.STATUS_DRAFT,
    )
    SupplierInvoiceItem.objects.create(
        invoice=invoice, purchase_order_item=po_line, item=item,
        unit=unit, quantity=Decimal("1.0000"),
        unit_price=Decimal("100.00"),
    )
    SupplierInvoice.objects.filter(pk=invoice.pk).update(status=SupplierInvoice.STATUS_MATCHED)
    report = grni_reconciliation(period)
    assert report["received_value"] == "300.00"
    assert report["matched_invoice_value"] == "100.00"
    assert report["unmatched_receipt_value"] == "200.00"
    assert report["orders"][0]["matched_invoice_count"] == 1
    assert report["orders"][0]["requires_review"] is False
    assert report["posted"] is False
    assert not GLExport.objects.exists()

    user_api = APIClient()
    user_api.force_authenticate(user=finance)
    response = user_api.get(f"/api/v1/fiscal-periods/{period.pk}/grni-reconciliation/")
    assert response.status_code == 200, response.data
    assert response.data["unmatched_receipt_value"] == "200.00"

    user_api.force_authenticate(user=keeper)
    assert user_api.get(f"/api/v1/fiscal-periods/{period.pk}/grni-reconciliation/").status_code == 403
    foreign_period = FiscalPeriod.objects.create(
        branch=foreign_branch, name="Other hotel month",
        start_date=today.replace(day=1), end_date=today,
    )
    user_api.force_authenticate(user=finance)
    assert user_api.get(
        f"/api/v1/fiscal-periods/{foreign_period.pk}/grni-reconciliation/"
    ).status_code == 404


@pytest.mark.django_db
def test_grni_empty_period_returns_clean_zero_without_creating_journals():
    branch = Branch.objects.create(name="GRNI empty branch")
    today = timezone.localdate()
    period = FiscalPeriod.objects.create(
        branch=branch, name="No receipt period",
        start_date=today.replace(day=1), end_date=today,
    )
    result = grni_reconciliation(period)
    assert result["order_count"] == 0
    assert result["unmatched_receipt_value"] == "0.00"
    assert result["posted"] is False
    assert not GLExport.objects.exists()
