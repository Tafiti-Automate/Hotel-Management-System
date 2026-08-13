from decimal import Decimal

import pytest
from django.utils import timezone

from apps.finance.models import (
    PaymentMethod,
    SupplierInvoice,
    SupplierInvoiceItem,
    SupplierPayment,
)
from apps.procurement.models import (
    GoodsReceiptItem,
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseRequisition,
    RequisitionItem,
)
from apps.inventory.models import ItemUnitPrice, UnitOfMeasure
from core.constants.choices import POStatus, PRStatus
from tests.test_procurement import authorize_order_for_test, create_procurement_context


@pytest.mark.django_db
def test_supplier_invoice_matches_accepted_grn_and_can_be_paid():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Matched purchase",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("5.00"),
        approved_quantity=Decimal("5.00"),
        estimated_unit_cost=Decimal("1000.00"),
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
    authorize_order_for_test(order)
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


@pytest.mark.django_db
def test_supplier_invoice_matches_packaged_purchase_at_purchase_unit_price():
    employee, department, supplier, item = create_procurement_context()
    carton = UnitOfMeasure.objects.create(name="Carton", abbreviation="ctn")
    ItemUnitPrice.objects.create(
        item=item,
        unit=carton,
        role="purchase",
        conversion_factor=Decimal("12.0000"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Packaged matched purchase",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("24.00"),
        approved_quantity=Decimal("24.00"),
        estimated_unit_cost=Decimal("10000.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        po_number="PO-MATCH-CARTON",
    )
    order_item = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        unit=carton,
        quantity=Decimal("2.00"),
        unit_cost=Decimal("120000.00"),
    )
    authorize_order_for_test(order)
    order.issue(sent_by=employee)
    receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
    )
    GoodsReceiptItem.objects.create(
        goods_receipt=receipt,
        purchase_order_item=order_item,
        quantity_received=Decimal("2.00"),
        unit_cost=Decimal("120000.00"),
        inventory_changes_applied=True,
    )
    invoice = SupplierInvoice.objects.create(
        supplier=supplier,
        purchase_order=order,
        invoice_number="INV-CARTON",
        due_date=timezone.localdate(),
        subtotal=Decimal("240000.00"),
    )

    invoice.perform_three_way_match()
    invoice.refresh_from_db()

    assert order.total_amount == Decimal("240000.00")
    assert order_item.base_quantity == Decimal("24.000000")
    assert invoice.status == SupplierInvoice.STATUS_MATCHED
    assert invoice.amount_variance == Decimal("0.00")


@pytest.mark.django_db
def test_partial_invoice_lines_cannot_bill_the_same_accepted_quantity_twice():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Partial supplier billing",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("5.00"),
        approved_quantity=Decimal("5.00"),
        estimated_unit_cost=Decimal("1000.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        po_number="PO-PARTIAL-INVOICE",
    )
    order_item = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("5.00"),
        unit_cost=Decimal("1000.00"),
    )
    authorize_order_for_test(order)
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

    first = SupplierInvoice.objects.create(
        supplier=supplier,
        purchase_order=order,
        invoice_number="INV-PART-1",
        due_date=timezone.localdate(),
        subtotal=Decimal("2000.00"),
    )
    SupplierInvoiceItem.objects.create(
        invoice=first,
        purchase_order_item=order_item,
        quantity=Decimal("2.00"),
        unit_price=Decimal("1000.00"),
    )
    first.perform_three_way_match()
    assert first.status == SupplierInvoice.STATUS_MATCHED

    second = SupplierInvoice.objects.create(
        supplier=supplier,
        purchase_order=order,
        invoice_number="INV-PART-2",
        due_date=timezone.localdate(),
        subtotal=Decimal("3000.00"),
    )
    SupplierInvoiceItem.objects.create(
        invoice=second,
        purchase_order_item=order_item,
        quantity=Decimal("3.00"),
        unit_price=Decimal("1000.00"),
    )
    second.perform_three_way_match()
    assert second.status == SupplierInvoice.STATUS_MATCHED

    duplicate = SupplierInvoice.objects.create(
        supplier=supplier,
        purchase_order=order,
        invoice_number="INV-PART-3",
        due_date=timezone.localdate(),
        subtotal=Decimal("1000.00"),
    )
    SupplierInvoiceItem.objects.create(
        invoice=duplicate,
        purchase_order_item=order_item,
        quantity=Decimal("1.00"),
        unit_price=Decimal("1000.00"),
    )
    duplicate.perform_three_way_match()

    assert duplicate.status == SupplierInvoice.STATUS_EXCEPTION
    assert duplicate.quantity_variance == Decimal("1.00")
    assert "remaining accepted quantity" in duplicate.match_notes
