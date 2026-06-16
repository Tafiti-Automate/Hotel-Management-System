from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category,
    InventoryBalance,
    InventoryBatch,
    Item,
    ItemUnitPrice,
    StockLedger,
    StoreLocation,
    UnitOfMeasure,
)
from apps.procurement.models import (
    GoodsReceiptItem,
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseRequisition,
    RequisitionItem,
    VendorQuotation,
)
from apps.vendors.models import Supplier
from core.constants.choices import POStatus, PRStatus


def create_procurement_context():
    user = get_user_model().objects.create_user(
        username="procurement",
        employee_code="EMP-PRC",
        password="test-pass-123",
    )
    department = Department.objects.create(name="Kitchen")
    employee = Employee.objects.create(
        user=user,
        department=department,
        designation="Procurement Officer",
    )
    supplier = Supplier.objects.create(
        name="General Supplier",
        email="general@example.com",
        phone="+256700000003",
        address="Kampala",
        tin_number="TIN-003",
        registration_number="REG-003",
    )
    category = Category.objects.create(name="Kitchen Supplies")
    item = Item.objects.create(
        category=category,
        name="Cooking Oil",
        sku="OIL-001",
        unit="litre",
        reorder_level=Decimal("15.00"),
    )
    return employee, department, supplier, item


@pytest.mark.django_db
def test_procurement_flow_models_link_together():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Monthly kitchen restock",
    )
    requisition_item = RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("12.00"),
    )
    quotation = VendorQuotation.objects.create(
        requisition=requisition,
        supplier=supplier,
        total_amount=Decimal("240000.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        po_number="PO-001",
    )
    receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
    )

    assert requisition_item.requisition == requisition
    assert quotation.supplier == supplier
    assert receipt.purchase_order == order


@pytest.mark.django_db
def test_goods_receipt_item_posts_received_stock_to_inventory():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Main Hotel")
    store = StoreLocation.objects.create(branch=branch, name="Kitchen Store")
    carton = UnitOfMeasure.objects.create(name="Carton", abbreviation="ctn")
    ItemUnitPrice.objects.create(
        item=item,
        unit=carton,
        conversion_factor=Decimal("12.0000"),
        selling_price=Decimal("90000.00"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Monthly kitchen restock",
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        store=store,
        po_number="PO-002",
    )
    order_item = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        unit=carton,
        quantity=Decimal("3.00"),
        unit_cost=Decimal("7000.00"),
    )
    receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
    )
    receipt_item = GoodsReceiptItem.objects.create(
        goods_receipt=receipt,
        purchase_order_item=order_item,
        quantity_received=Decimal("2.00"),
        unit_cost=Decimal("7000.00"),
    )

    receipt_item.post_to_inventory()

    order.refresh_from_db()
    receipt_item.refresh_from_db()
    assert order_item.base_quantity == Decimal("36.0000")
    assert order.total_amount == Decimal("252000.00")
    assert receipt_item.base_quantity == Decimal("24.0000")
    assert receipt_item.store == store
    assert receipt_item.inventory_changes_applied is True
    assert order.status == POStatus.PARTIALLY_RECEIVED
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("24.00")
    assert InventoryBatch.objects.get(item=item, store=store).remaining_quantity == Decimal("24.00")
    assert StockLedger.objects.get(reference_id=receipt.id).quantity_in == Decimal("24.00")

    with pytest.raises(ValidationError):
        receipt_item.post_to_inventory()


@pytest.mark.django_db
def test_purchase_order_requires_approved_requisition_for_form_validation():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Controlled purchase request",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("1.00"),
    )
    order = PurchaseOrder(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        po_number="PO-003",
    )

    with pytest.raises(ValidationError):
        order.full_clean()

    requisition.status = PRStatus.APPROVED
    requisition.save(update_fields=["status", "updated_at"])
    order.full_clean()
