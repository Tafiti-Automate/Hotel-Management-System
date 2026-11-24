"""Regression: accepted Receiving Clerk deliveries automatically post once."""
from decimal import Decimal

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.departments.models import Branch
from apps.inventory.models import InventoryBalance, StockLedger, StoreLocation
from apps.procurement.models import (
    GoodsReceiptNote, PurchaseOrder, PurchaseOrderItem,
    PurchaseRequisition, RequisitionItem,
)
from core.constants.choices import PRStatus
from tests.test_procurement import create_procurement_context, authorize_order_for_test

@pytest.mark.django_db
def test_receiving_duplicate_delivery_reference_never_reposts_stock():
    """Receiving the same signed physical delivery twice must never duplicate SOH."""
    from apps.accounts.role_templates import sync_client_roles
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Duplicate Receiving Prevention")
    store = StoreLocation.objects.create(branch=branch, name="Duplicate Main Store")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    sync_client_roles()
    employee.user.groups.add(Group.objects.get(name="Receiving Clerk"))
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        reason="Duplicate receiving guard", status=PRStatus.APPROVED,
    )
    line_req = RequisitionItem.objects.create(
        requisition=requisition, item=item,
        quantity=Decimal("5.0000"), approved_quantity=Decimal("5.0000"),
        destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier,
        ordered_by=employee, store=store,
    )
    order_line = PurchaseOrderItem.objects.create(
        purchase_order=order, requisition_item=line_req, item=item,
        unit=item.base_unit, quantity=Decimal("5.0000"), unit_cost=Decimal("1200.00"),
    )
    authorize_order_for_test(order)
    order.issue(sent_by=employee, sent_to_email=supplier.email)
    client = APIClient()
    client.force_authenticate(employee.user)
    payload = {
        "supplier_invoice_no": "INV-DUP-RECEIVE",
        "delivery_note_no": "DN-DUP-RECEIVE",
        "lines": [{"purchase_order_item": str(order_line.pk), "quantity_received": "2.5000"}],
    }
    endpoint = f"/api/v1/purchase-orders/{order.pk}/receive-delivery/"
    # A valid delivery must fail closed when no OPEN fiscal period exists.
    missing_period = client.post(endpoint, payload, format="json")
    assert missing_period.status_code == 400, missing_period.data
    assert "OPEN fiscal period" in str(missing_period.data)
    assert not GoodsReceiptNote.objects.exists()

    from calendar import monthrange
    from apps.materials_control.models import FiscalPeriod
    from django.utils import timezone
    now = timezone.localdate()
    FiscalPeriod.objects.create(
        branch=branch, name="Duplicate receiving accounting period",
        start_date=now.replace(day=1),
        end_date=now.replace(day=monthrange(now.year, now.month)[1]),
    )
    # Values with more than four fractional base units must be rejected
    # without creating a GRN or changing physical stock.
    invalid_count = client.post(endpoint, {
        **payload,
        "delivery_note_no": "DN-INVALID-COUNT",
        "lines": [{"purchase_order_item": str(order_line.pk),
                   "quantity_received": "2.50001"}],
    }, format="json")
    assert invalid_count.status_code == 400, invalid_count.data
    assert "four decimal" in str(invalid_count.data)
    invalid_rejection = client.post(endpoint, {
        **payload,
        "delivery_note_no": "DN-INVALID-REJECTION",
        "lines": [{"purchase_order_item": str(order_line.pk),
                   "quantity_received": "2.5000",
                   "quantity_rejected": "0.00001",
                   "rejection_reason": "Quality hold"}],
    }, format="json")
    assert invalid_rejection.status_code == 400, invalid_rejection.data
    assert "four decimal" in str(invalid_rejection.data)
    assert not InventoryBalance.objects.filter(item=item, store=store).exists()
    assert not GoodsReceiptNote.objects.exists()
    accepted = client.post(endpoint, payload, format="json")
    assert accepted.status_code == 201, accepted.data
    assert accepted.data["status"] == "posted"
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("2.5000")
    assert StockLedger.objects.filter(reference_id=accepted.data["id"]).count() == 1
    duplicate = client.post(endpoint, payload, format="json")
    assert duplicate.status_code == 400, duplicate.data
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("2.5000")
    assert StockLedger.objects.filter(reference_id=accepted.data["id"]).count() == 1
