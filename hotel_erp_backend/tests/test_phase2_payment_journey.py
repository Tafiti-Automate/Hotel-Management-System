"""Full approved-LPO -> received GRN -> invoice -> split-payment accounting journey."""
from decimal import Decimal
import csv
import io

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.finance.models import PaymentMethod, SupplierInvoice, SupplierPayment
from apps.materials_control.models import FiscalPeriod, GLExport, GLAccountMapping
from apps.departments.models import Branch
from apps.inventory.models import InventoryBalance, StockLedger, StoreLocation
from apps.procurement.models import (
    GoodsInspection, GoodsInspectionItem, GoodsReceiptItem, GoodsReceiptNote, PurchaseOrder, PurchaseOrderItem,
    PurchaseRequisition, RequisitionItem,
)
from core.constants.choices import PRStatus
from tests.test_procurement import authorize_order_for_test, create_procurement_context


@pytest.mark.django_db
def test_received_purchase_is_matched_approved_and_paid_in_two_independent_postings():
    requester, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name='PH2 end-to-end hotel property')
    store = StoreLocation.objects.create(branch=branch, name='PH2 receiving warehouse')
    requester.branch = branch
    requester.save(update_fields=('branch', 'updated_at'))
    preparer = get_user_model().objects.create_user(
        username="ap-payment-preparer", employee_code="PH2-AP-PREP", password="test-pass-123"
    )
    approver = get_user_model().objects.create_user(
        username="ap-invoice-approver", employee_code="PH2-AP-APP", password="test-pass-123"
    )
    poster = get_user_model().objects.create_user(
        username="ap-payment-poster", employee_code="PH2-AP-POST", password="test-pass-123"
    )
    pr = PurchaseRequisition.objects.create(
        requester=requester, department=department, branch=branch, reason="End-to-end supplies",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=pr, item=item, quantity=Decimal("10.00"),
        approved_quantity=Decimal("10.00"), estimated_unit_cost=Decimal("250.00"),
        destination_store=store,
    )
    po = PurchaseOrder.objects.create(
        requisition=pr, supplier=supplier, ordered_by=requester, store=store,
        po_number="PO-PH2-PAYMENT-JOURNEY",
    )
    po_line = PurchaseOrderItem.objects.create(
        purchase_order=po, item=item, quantity=Decimal("10.00"),
        unit_cost=Decimal("250.00"),
    )
    authorize_order_for_test(po)
    po.issue(sent_by=requester)
    grn = GoodsReceiptNote.objects.create(purchase_order=po, received_by=requester)
    grn_line = GoodsReceiptItem.objects.create(
        goods_receipt=grn, purchase_order_item=po_line,
        quantity_received=Decimal("10.00"), unit_cost=Decimal("250.00"),
    )
    inspection = GoodsInspection.objects.create(
        goods_receipt=grn, inspected_by=requester,
    )
    GoodsInspectionItem.objects.create(
        inspection=inspection, goods_receipt_item=grn_line,
        quantity_received=Decimal("10.00"),
        quantity_accepted=Decimal("10.00"), quantity_rejected=Decimal("0.00"),
    )
    grn.post_to_inventory(posted_by=requester)
    grn.refresh_from_db()
    assert grn.status == "posted"
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("10.00")
    assert StockLedger.objects.filter(reference_id=grn.pk).count() == 1
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=po, invoice_number="PH2-SPLIT-INVOICE",
        subtotal=Decimal("2500.00"), due_date=timezone.localdate(),
        created_by=preparer,
    )
    invoice.perform_three_way_match()
    assert invoice.status == SupplierInvoice.STATUS_MATCHED
    assert invoice.amount_variance == Decimal("0.00")
    with pytest.raises(ValidationError, match="registered the invoice"):
        invoice.approve_for_payment(approved_by=preparer)
    invoice.approve_for_payment(approved_by=approver)
    assert invoice.status == SupplierInvoice.STATUS_APPROVED

    method = PaymentMethod.objects.create(name="PH2 bank transfer")
    payment_one = SupplierPayment.objects.create(
        invoice=invoice, amount=Decimal("1000.00"),
        payment_method=method, reference="PH2-PAY-1", created_by=preparer,
    )
    with pytest.raises(ValidationError, match="prepared the supplier payment"):
        payment_one.post(posted_by=preparer)
    payment_one.post(posted_by=poster)
    invoice.refresh_from_db()
    assert invoice.status == SupplierInvoice.STATUS_PARTIALLY_PAID
    assert invoice.paid_amount == Decimal("1000.00")
    assert invoice.balance_due == Decimal("1500.00")

    overpayment = SupplierPayment.objects.create(
        invoice=invoice, amount=Decimal("1500.01"),
        payment_method=method, reference="PH2-PAY-OVER", created_by=preparer,
    )
    with pytest.raises(ValidationError, match="exceed"):
        overpayment.post(posted_by=poster)
    overpayment.refresh_from_db()
    assert overpayment.status == SupplierPayment.STATUS_DRAFT

    payment_two = SupplierPayment.objects.create(
        invoice=invoice, amount=Decimal("1500.00"),
        payment_method=method, reference="PH2-PAY-2", created_by=preparer,
    )
    payment_two.post(posted_by=poster)
    invoice.refresh_from_db()
    assert invoice.status == SupplierInvoice.STATUS_PAID
    assert invoice.paid_amount == Decimal("2500.00")
    assert invoice.balance_due == Decimal("0.00")
    with pytest.raises(ValidationError, match="Only draft"):
        payment_two.post(posted_by=poster)
    with pytest.raises(ValidationError, match="locked"):
        invoice.perform_three_way_match()
    invoice.refresh_from_db()
    assert invoice.status == SupplierInvoice.STATUS_PAID

    # Both cash disbursements must be represented separately in the period GL.
    period = FiscalPeriod.objects.create(
        branch=branch, name="Full supplier payment journal",
        start_date=timezone.localdate().replace(day=1), end_date=timezone.localdate(),
    )
    GLAccountMapping.objects.create(
        branch=branch, source_type=GLAccountMapping.SOURCE_INVOICE,
        debit_account="INVENTORY-1400", credit_account="TRADE-AP-2100",
    )
    period.close(approver, "GRN and supplier settlements reviewed.")
    with pytest.raises(ValidationError, match="GL account mapping"):
        GLExport.generate(period, approver)
    GLAccountMapping.objects.create(
        branch=branch, source_type=GLAccountMapping.SOURCE_PAYMENT,
        debit_account="TRADE-AP-2100", credit_account="BANK-CLEARING-1100",
    )
    export = GLExport.generate(period, approver)
    rows = list(csv.DictReader(io.StringIO(export.payload)))
    payment_rows = [row for row in rows if row["source"] == "supplier_payment"]
    assert len(payment_rows) == 4
    assert sum(Decimal(row["debit"]) for row in payment_rows) == Decimal("2500.00")
    assert sum(Decimal(row["credit"]) for row in payment_rows) == Decimal("2500.00")
    assert {row["account"] for row in payment_rows} == {
        "TRADE-AP-2100", "BANK-CLEARING-1100",
    }
    assert sum(Decimal(row["debit"]) for row in rows) == sum(
        Decimal(row["credit"]) for row in rows
    )
    assert GLExport.generate(period, approver).pk == export.pk


@pytest.mark.django_db
def test_stale_invoice_approval_cannot_reopen_a_paid_or_cancelled_invoice():
    """A previously matched invoice snapshot must never undo a later decision."""
    requester, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Stale invoice acceptance property")
    requester.branch = branch
    requester.save(update_fields=("branch", "updated_at"))
    order_request = PurchaseRequisition.objects.create(
        requester=requester, department=department, branch=branch,
        reason="Invoice status race regression",
    )
    order = PurchaseOrder.objects.create(
        requisition=order_request, supplier=supplier, ordered_by=requester,
    )
    preparer = get_user_model().objects.create_user(
        username="stale-invoice-preparer",
        employee_code="PH2-INV-STALE-PREP", password="test-pass-123",
    )
    approver = get_user_model().objects.create_user(
        username="stale-invoice-approver",
        employee_code="PH2-INV-STALE-APP", password="test-pass-123",
    )
    invoice = SupplierInvoice.objects.create(
        supplier=supplier, purchase_order=order,
        invoice_number="PH2-STALE-STATUS",
        subtotal=Decimal("100.00"), due_date=timezone.localdate(),
        created_by=preparer,
    )
    invoice.status = SupplierInvoice.STATUS_MATCHED
    invoice.save(update_fields=("status", "updated_at"))
    stale = SupplierInvoice.objects.get(pk=invoice.pk)

    # Another request has reached a terminal state while Finance still has
    # the matched invoice on screen.
    invoice.status = SupplierInvoice.STATUS_PAID
    invoice.save(update_fields=("status", "updated_at"))
    with pytest.raises(ValidationError, match="Only a successfully matched"):
        stale.approve_for_payment(approved_by=approver)
    invoice.refresh_from_db()
    assert invoice.status == SupplierInvoice.STATUS_PAID
    assert invoice.approved_by_id is None

    invoice.status = SupplierInvoice.STATUS_CANCELLED
    invoice.save(update_fields=("status", "updated_at"))
    with pytest.raises(ValidationError, match="Only a successfully matched"):
        stale.approve_for_payment(approved_by=approver)
    invoice.refresh_from_db()
    assert invoice.status == SupplierInvoice.STATUS_CANCELLED

    # A fresh legitimate matched invoice can still be approved by a
    # different actor, and repeated approval remains blocked.
    invoice.status = SupplierInvoice.STATUS_MATCHED
    invoice.save(update_fields=("status", "updated_at"))
    invoice.approve_for_payment(approved_by=approver)
    assert invoice.status == SupplierInvoice.STATUS_APPROVED
    assert invoice.approved_by_id == approver.pk
    with pytest.raises(ValidationError, match="Only a successfully matched"):
        stale.approve_for_payment(approved_by=approver)
