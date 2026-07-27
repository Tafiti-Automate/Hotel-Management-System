from decimal import Decimal

import pytest
from django.utils import timezone

from apps.finance.models import PaymentMethod, SupplierInvoice, SupplierPayment
from apps.procurement.models import (
    GoodsReceiptItem,
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseRequisition,
)
from core.constants.choices import PRStatus
from tests.test_procurement import create_procurement_context


@pytest.mark.django_db
def test_supplier_invoice_matches_accepted_grn_and_can_be_paid():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Matched purchase",
        status=PRStatus.APPROVED,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        po_number="PO-MATCH-001",
    )
    order_item = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("5.00"),
        unit_cost=Decimal("1000.00"),
    )
    order.issue(sent_by=employee)
    receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
    )
    GoodsReceiptItem.objects.create(
        goods_receipt=receipt,
        purchase_order_item=order_item,
        quantity_received=Decimal("5.00"),
        unit_cost=Decimal("1000.00"),
        inventory_changes_applied=True,
    )
    invoice = SupplierInvoice.objects.create(
        supplier=supplier,
        purchase_order=order,
        invoice_number="INV-001",
        due_date=timezone.localdate(),
        subtotal=Decimal("5000.00"),
    )

    invoice.perform_three_way_match()
    invoice.approve_for_payment()
    method = PaymentMethod.objects.create(name="Bank transfer")
    payment = SupplierPayment.objects.create(
        invoice=invoice,
        amount=Decimal("5000.00"),
        payment_method=method,
        reference="PAY-001",
    )
    payment.post()
    invoice.refresh_from_db()

    assert invoice.status == SupplierInvoice.STATUS_PAID
    assert invoice.balance_due == Decimal("0.00")
