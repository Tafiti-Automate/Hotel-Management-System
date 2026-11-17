"""Vendor-return reconciliation against accepted, posted GRN inventory."""
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.departments.models import Branch
from apps.inventory.models import InventoryBalance, StockLedger, StoreLocation
from apps.procurement.models import (
    GoodsInspection, GoodsInspectionItem, GoodsReceiptItem, GoodsReceiptNote,
    PurchaseOrder, PurchaseOrderItem, PurchaseRequisition, RequisitionItem,
    SupplierReturn, SupplierReturnItem,
)
from core.constants.choices import POStatus, PRStatus
from tests.test_procurement import create_procurement_context


@pytest.fixture
def posted_receipt(db):
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Vendor return audit property")
    store = StoreLocation.objects.create(branch=branch, name="Vendor return store")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    pr = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        reason="Goods for return audit", status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=pr, item=item, quantity=Decimal("10"),
        approved_quantity=Decimal("10"), estimated_unit_cost=Decimal("1000"),
        destination_store=store,
    )
    po = PurchaseOrder.objects.create(
        requisition=pr, supplier=supplier, ordered_by=employee, store=store,
    )
    po_line = PurchaseOrderItem.objects.create(
        purchase_order=po, item=item, quantity=Decimal("10"), unit_cost=Decimal("1000"),
        destination_store=store,
    )
    po.status = POStatus.ISSUED
    po.save(update_fields=("status", "updated_at"))
    grn = GoodsReceiptNote.objects.create(purchase_order=po, received_by=employee)
    receipt_line = GoodsReceiptItem.objects.create(
        goods_receipt=grn, purchase_order_item=po_line,
        quantity_received=Decimal("10"), unit_cost=Decimal("1000"),
    )
    inspection = GoodsInspection.objects.create(goods_receipt=grn, inspected_by=employee)
    GoodsInspectionItem.objects.create(
        inspection=inspection, goods_receipt_item=receipt_line,
        quantity_received=Decimal("10"), quantity_accepted=Decimal("7"),
        quantity_rejected=Decimal("3"), rejection_reason="Damaged boxes",
    )
    grn.post_to_inventory(posted_by=employee)
    return employee, supplier, item, store, grn


def make_return(context, quantity, *, item=None):
    employee, supplier, receipt_item, store, grn = context
    record = SupplierReturn.objects.create(
        supplier=supplier, goods_receipt=grn, store=store,
        returned_by=employee, reason="Supplier quality return",
    )
    SupplierReturnItem.objects.create(
        supplier_return=record, item=item or receipt_item,
        quantity=Decimal(str(quantity)),
    )
    return record


@pytest.mark.django_db
def test_returns_can_only_claim_accepted_grn_quantity_once(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    first = make_return(posted_receipt, "4")
    first.apply_inventory_changes(dispatched_by=employee)
    balance = InventoryBalance.objects.get(item=item, store=store)
    assert balance.quantity_in_stock == Decimal("3.00")
    assert StockLedger.objects.filter(reference_id=first.pk, quantity_out=Decimal("4")).count() == 1

    excess = make_return(posted_receipt, "4")
    with pytest.raises(ValidationError, match="remaining accepted"):
        excess.apply_inventory_changes(dispatched_by=employee)
    balance.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("3.00")
    assert not StockLedger.objects.filter(reference_id=excess.pk).exists()

    last = make_return(posted_receipt, "3")
    last.apply_inventory_changes(dispatched_by=employee)
    balance.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("0.00")
    assert StockLedger.objects.filter(reference_id=last.pk).count() == 1

    with pytest.raises(ValidationError, match="already been applied"):
        first.apply_inventory_changes(dispatched_by=employee)
    assert StockLedger.objects.filter(reference_id=first.pk).count() == 1


@pytest.mark.django_db
def test_supplier_acknowledgement_is_immutable_and_credit_references_unique(posted_receipt):
    employee, supplier, item, store, grn = posted_receipt
    first = make_return(posted_receipt, "2")
    first.apply_inventory_changes(dispatched_by=employee)
    first.acknowledge(acknowledged_by="Supplier desk", credit_note_number="CN-SUP-101")
    with pytest.raises(ValidationError, match="already been recorded"):
        first.acknowledge(acknowledged_by="Other desk", credit_note_number="CN-SUP-202")
    first.refresh_from_db()
    assert first.credit_note_number == "CN-SUP-101"

    second = make_return(posted_receipt, "2")
    second.apply_inventory_changes(dispatched_by=employee)
    with pytest.raises(ValidationError, match="already recorded"):
        second.acknowledge(acknowledged_by="Supplier desk", credit_note_number="cn-sup-101")
    second.refresh_from_db()
    assert second.supplier_acknowledged_at is None
    second.acknowledge(acknowledged_by="Supplier desk", credit_note_number="CN-SUP-102")
    assert second.credit_note_number == "CN-SUP-102"
