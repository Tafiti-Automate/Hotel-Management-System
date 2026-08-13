from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient, APIRequestFactory

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.approvals.models import ApprovalMatrixRule
from apps.inventory.models import (
    Category,
    InventoryBalance,
    InventoryBatch,
    Item,
    ItemUnitPrice,
    StockLedger,
    StoreLocation,
    UnitOfMeasure,
    SupplierItemPrice,
)
from apps.procurement.models import (
    GoodsInspection,
    GoodsInspectionItem,
    GoodsReceiptItem,
    GoodsReceiptNote,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseRequisition,
    RequisitionItem,
    VendorQuotation,
    VendorQuotationItem,
)
from apps.procurement.serializers import (
    GoodsReceiptItemSerializer,
    PurchaseOrderItemSerializer,
    PurchaseOrderSerializer,
    PurchaseRequisitionSerializer,
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
    base_unit = UnitOfMeasure.objects.create(name="Litre", abbreviation="L")
    item = Item.objects.create(
        category=category,
        name="Cooking Oil",
        sku="OIL-001",
        unit="litre",
        base_unit=base_unit,
        reorder_level=Decimal("15.00"),
    )
    return employee, department, supplier, item


def authorize_order_for_test(order):
    order.status = POStatus.APPROVED
    order.save(update_fields=("status", "updated_at"))
    return order


@pytest.mark.django_db
def test_requisition_creation_uses_logged_in_employee_identity():
    employee, department, _supplier, _item = create_procurement_context()
    request = APIRequestFactory().post("/api/v1/requisitions/")
    request.user = employee.user
    serializer = PurchaseRequisitionSerializer(
        data={"reason": "Monthly kitchen restock"},
        context={"request": request},
    )

    assert serializer.is_valid(), serializer.errors
    requisition = serializer.save()
    assert requisition.requester == employee
    assert requisition.department == department
    assert requisition.branch == employee.branch


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
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("36.00"),
        approved_quantity=Decimal("36.00"),
        estimated_unit_cost=Decimal("583.33"),
        destination_store=store,
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
    authorize_order_for_test(order)
    order.issue(sent_by=employee)
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
    assert order.total_amount == Decimal("21000.00")
    assert receipt_item.base_quantity == Decimal("24.0000")
    assert receipt_item.store == store
    assert receipt_item.inventory_changes_applied is True
    assert order.status == POStatus.PARTIALLY_RECEIVED
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("24.00")
    batch = InventoryBatch.objects.get(item=item, store=store)
    assert batch.remaining_quantity == Decimal("24.00")
    assert batch.unit_cost == Decimal("583.33")
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


@pytest.mark.django_db
def test_direct_workspace_route_flows_from_requisition_to_po_and_grn():
    employee, department, supplier, item = create_procurement_context()
    SupplierItemPrice.objects.create(supplier=supplier, item=item, unit=item.base_unit, unit_price=Decimal("5000.00"))
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, reason="Use immediately in kitchen", status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition, item=item, quantity=Decimal("4.00"),
        approved_quantity=Decimal("4.00"), estimated_unit_cost=Decimal("5000.00"),
        destination_type=RequisitionItem.DESTINATION_WORKSPACE,
        destination_department=department,
        destination_justification="Fresh input required directly at the kitchen workspace.",
    )

    order = requisition.create_purchase_order(supplier=supplier, ordered_by=employee)
    order_line = order.items.get()
    assert order_line.destination_type == RequisitionItem.DESTINATION_WORKSPACE
    assert order_line.destination_department == department
    authorize_order_for_test(order)
    order.issue(sent_by=employee)
    receipt = GoodsReceiptNote.objects.create(purchase_order=order, received_by=employee)
    receipt_line = GoodsReceiptItem.objects.create(
        goods_receipt=receipt, purchase_order_item=order_line,
        quantity_received=Decimal("4.00"), unit_cost=Decimal("5000.00"),
    )

    assert receipt_line.store is None
    assert receipt_line.direct_issue_department == department


@pytest.mark.django_db
def test_store_keeper_can_read_lpo_workspace_for_receiving_without_lpo_permission():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Receiving Branch")
    employee.branch = branch
    employee.save(update_fields=["branch", "updated_at"])
    employee.user.groups.add(Group.objects.create(name="Store Keeper"))
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        branch=branch,
        reason="Receiving visibility",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
        approved_quantity=Decimal("2.00"),
        estimated_unit_cost=Decimal("5000.00"),
    )
    PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        po_number="PO-STORE-VIEW",
    )

    client = APIClient()
    client.force_authenticate(employee.user)
    response = client.get("/api/v1/requisitions/workspace/?stage=lpo")

    assert response.status_code == 200
    assert [row["po_number"] for row in response.data["orders"]] == ["PO-STORE-VIEW"]


@pytest.mark.django_db
def test_requisition_readiness_explains_missing_prerequisites():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Controlled purchase request",
    )

    readiness = requisition.submission_readiness()

    assert readiness["can_proceed"] is False
    assert "Add at least one Article." in readiness["blockers"]
    assert any("approval matrix" in blocker.lower() for blocker in readiness["blockers"])


@pytest.mark.django_db
def test_lpo_readiness_requires_approved_source_and_order_lines():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Unapproved purchase",
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        po_number="PO-GUARD-001",
    )

    readiness = order.issue_readiness()

    assert readiness["can_proceed"] is False
    assert "The source requisition must be fully approved." in readiness["blockers"]
    assert "Add at least one Article to the LPO." in readiness["blockers"]


@pytest.mark.django_db
def test_requisition_creates_purchase_order_from_selected_supplier_quote():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Approved kitchen purchase",
        status=PRStatus.APPROVED,
    )
    requisition_item = RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("4.00"),
    )
    quotation = VendorQuotation.objects.create(
        requisition=requisition,
        supplier=supplier,
    )
    VendorQuotationItem.objects.create(
        quotation=quotation,
        requisition_item=requisition_item,
        quantity=Decimal("4.00"),
        unit_price=Decimal("8000.00"),
        selected=True,
    )

    order = requisition.create_purchase_order(ordered_by=employee)

    order_item = order.items.get()
    assert order.supplier == supplier
    assert order.po_number.startswith("PO-")
    assert order.status == POStatus.DRAFT
    assert order.total_amount == Decimal("32000.00")
    assert order_item.item == item
    assert order_item.quantity == Decimal("4.00")
    assert order_item.unit_cost == Decimal("8000.00")


@pytest.mark.django_db
def test_lpo_line_cannot_use_article_outside_source_requisition():
    employee, department, supplier, item = create_procurement_context()
    other_item = Item.objects.create(
        category=item.category,
        name="Unrequested Article",
        sku="UNR-001",
        unit="each",
        reorder_level=Decimal("1.00"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Approved purchase",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
        estimated_unit_cost=Decimal("5000.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
    )
    serializer = PurchaseOrderItemSerializer(
        data={
            "purchase_order": order.id,
            "item": other_item.id,
            "quantity": "1.00",
            "unit_cost": "1000.00",
        }
    )

    assert serializer.is_valid() is False
    assert "not on the source requisition" in str(serializer.errors)


@pytest.mark.django_db
def test_grn_line_cannot_exceed_remaining_lpo_quantity():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Approved purchase",
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
    )
    order_line = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("5.00"),
        unit_cost=Decimal("1000.00"),
    )
    order.status = POStatus.ISSUED
    order.save(update_fields=("status", "updated_at"))
    receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
    )
    serializer = GoodsReceiptItemSerializer(
        data={
            "goods_receipt": receipt.id,
            "purchase_order_item": order_line.id,
            "quantity_received": "6.00",
            "unit_cost": "1000.00",
        }
    )

    assert serializer.is_valid() is False
    assert "exceeds the remaining quantity" in str(serializer.errors)


@pytest.mark.django_db
def test_purchase_order_serializer_rejects_unapproved_requisition():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Not approved yet",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("1.00"),
    )

    serializer = PurchaseOrderSerializer(
        data={
            "requisition": str(requisition.id),
            "supplier": str(supplier.id),
            "ordered_by": str(employee.id),
            "po_number": "PO-BLOCKED",
        }
    )

    assert serializer.is_valid() is False
    assert "requisition" in serializer.errors


@pytest.mark.django_db
def test_purchase_order_issue_tracks_supplier_send_details():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Approved purchase",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
        approved_quantity=Decimal("2.00"),
        estimated_unit_cost=Decimal("7000.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        po_number="PO-SEND-001",
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("2.00"),
        unit_cost=Decimal("7000.00"),
    )

    authorize_order_for_test(order)
    order.issue(sent_by=employee)

    order.refresh_from_db()
    assert order.status == POStatus.ISSUED
    assert order.sent_by == employee
    assert order.sent_at is not None
    assert order.sent_to_email == supplier.email


@pytest.mark.django_db
def test_inspected_receipt_posts_only_accepted_quantity_to_inventory():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Main Hotel")
    store = StoreLocation.objects.create(branch=branch, name="Receiving Store")
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Approved inspected purchase",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("10.00"),
        approved_quantity=Decimal("10.00"),
        estimated_unit_cost=Decimal("5000.00"),
        destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        store=store,
        po_number="PO-INSPECT-001",
    )
    order_item = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("10.00"),
        unit_cost=Decimal("5000.00"),
    )
    order.status = POStatus.ISSUED
    order.save(update_fields=("status", "updated_at"))
    receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
    )
    receipt_item = GoodsReceiptItem.objects.create(
        goods_receipt=receipt,
        purchase_order_item=order_item,
        quantity_received=Decimal("10.00"),
        unit_cost=Decimal("5000.00"),
    )
    inspection = GoodsInspection.objects.create(
        goods_receipt=receipt,
        inspected_by=employee,
    )
    GoodsInspectionItem.objects.create(
        inspection=inspection,
        goods_receipt_item=receipt_item,
        quantity_received=Decimal("10.00"),
        quantity_accepted=Decimal("7.00"),
        quantity_rejected=Decimal("3.00"),
        rejection_reason="Damaged packaging",
    )

    receipt_item.post_to_inventory()

    order.refresh_from_db()
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("7.00")
    assert InventoryBatch.objects.get(item=item, store=store).remaining_quantity == Decimal("7.00")
    assert StockLedger.objects.get(reference_id=receipt.id).quantity_in == Decimal("7.00")
    assert order.status == POStatus.PARTIALLY_RECEIVED


@pytest.mark.django_db
def test_requisition_tracks_ordering_and_receipt_fulfillment():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Kampala Fulfillment")
    employee.branch = branch
    employee.save(update_fields=["branch", "updated_at"])
    store = StoreLocation.objects.create(branch=branch, name="Fulfillment Store")
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="End-to-end fulfillment tracking",
        status=PRStatus.APPROVED,
    )
    requisition_item = RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("4.00"),
        estimated_unit_cost=Decimal("8000.00"),
        approved_quantity=Decimal("4.00"),
    )
    quotation = VendorQuotation.objects.create(
        requisition=requisition,
        supplier=supplier,
    )
    VendorQuotationItem.objects.create(
        quotation=quotation,
        requisition_item=requisition_item,
        quantity=Decimal("4.00"),
        unit_price=Decimal("7500.00"),
        selected=True,
    )
    order = requisition.create_purchase_order(
        ordered_by=employee,
        store=store,
    )

    authorize_order_for_test(order)
    order.issue(sent_by=employee)
    requisition.refresh_from_db()
    assert requisition.status == PRStatus.ORDERED
    assert requisition_item.ordered_quantity == Decimal("4.00")

    receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
        delivery_note_no="FULFILL-DN-001",
    )
    receipt_item = GoodsReceiptItem.objects.create(
        goods_receipt=receipt,
        purchase_order_item=order.items.get(),
        quantity_received=Decimal("4.00"),
        unit_cost=Decimal("7500.00"),
    )
    receipt_item.post_to_inventory()

    requisition.refresh_from_db()
    assert requisition.status == PRStatus.FULFILLED
    assert requisition.fulfilled_at is not None
    assert requisition_item.received_quantity == Decimal("4.00")
    assert requisition.history.filter(
        action="fulfillment_status_updated",
        new_status=PRStatus.FULFILLED,
    ).exists()


@pytest.mark.django_db
def test_lpo_requires_independent_value_routed_approval_before_issue():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="LPO Approval Branch")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    store = StoreLocation.objects.create(branch=branch, name="Main Receiving")
    approver_user = get_user_model().objects.create_user(
        username="lpo-approver",
        employee_code="EMP-LPO-APR",
        password="test-pass-123",
    )
    approver = Employee.objects.create(
        user=approver_user,
        department=department,
        branch=branch,
        designation="Finance Controller",
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Independently approved supplier order",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("5.00"),
        approved_quantity=Decimal("5.00"),
        estimated_unit_cost=Decimal("1000.00"),
        destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        store=store,
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("5.00"),
        unit_cost=Decimal("1000.00"),
        destination_store=store,
    )
    ApprovalMatrixRule.objects.create(
        name="Independent LPO release",
        document_type=ApprovalMatrixRule.DOCUMENT_PURCHASE_ORDER,
        minimum_amount=Decimal("0.00"),
        stage=1,
        stage_name="Finance LPO approval",
        assignment_type=ApprovalMatrixRule.ASSIGNMENT_FIXED_EMPLOYEE,
        approver=approver,
    )

    with pytest.raises(ValidationError, match="approved LPO"):
        order.issue(sent_by=employee)

    order.submit_for_approval()
    order.refresh_from_db()
    assert order.status == POStatus.PENDING_APPROVAL
    step = order.approval_workflow.get()
    assert step.approver == approver

    step.approve(decided_by=approver_user)
    order.refresh_from_db()
    assert order.status == POStatus.APPROVED
    assert order.approved_by == approver

    order.issue(sent_by=employee)
    assert order.status == POStatus.ISSUED


@pytest.mark.django_db
def test_rejected_delivery_quantity_is_available_for_replacement_receipt():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Replacement Receipt Branch")
    store = StoreLocation.objects.create(branch=branch, name="Receiving Store")
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Replace rejected delivery",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("10.00"),
        approved_quantity=Decimal("10.00"),
        estimated_unit_cost=Decimal("1000.00"),
        destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        store=store,
    )
    order_item = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("10.00"),
        unit_cost=Decimal("1000.00"),
        destination_store=store,
    )
    order.status = POStatus.ISSUED
    order.save(update_fields=("status", "updated_at"))
    first_receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
        delivery_note_no="DN-REJECTED",
    )
    first_line = GoodsReceiptItem.objects.create(
        goods_receipt=first_receipt,
        purchase_order_item=order_item,
        quantity_received=Decimal("10.00"),
        unit_cost=Decimal("1000.00"),
    )
    inspection = GoodsInspection.objects.create(
        goods_receipt=first_receipt,
        inspected_by=employee,
    )
    GoodsInspectionItem.objects.create(
        inspection=inspection,
        goods_receipt_item=first_line,
        quantity_received=Decimal("10.00"),
        quantity_accepted=Decimal("7.00"),
        quantity_rejected=Decimal("3.00"),
        rejection_reason="Three containers were leaking.",
    )
    replacement_receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
        delivery_note_no="DN-REPLACEMENT",
    )

    replacement = GoodsReceiptItem.objects.create(
        goods_receipt=replacement_receipt,
        purchase_order_item=order_item,
        quantity_received=Decimal("3.00"),
        unit_cost=Decimal("1000.00"),
    )

    assert first_line.committed_purchase_quantity == Decimal("7.00")
    assert replacement.quantity_received == Decimal("3.00")


@pytest.mark.django_db
def test_incomplete_inspection_cannot_be_posted_and_posted_grn_is_immutable():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Controlled GRN Branch")
    store = StoreLocation.objects.create(branch=branch, name="Controlled Receiving")
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Controlled receipt lifecycle",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("4.00"),
        approved_quantity=Decimal("4.00"),
        estimated_unit_cost=Decimal("1000.00"),
        destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        store=store,
    )
    order_line = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("4.00"),
        unit_cost=Decimal("1000.00"),
        destination_store=store,
    )
    order.status = POStatus.ISSUED
    order.save(update_fields=("status", "updated_at"))
    receipt = GoodsReceiptNote.objects.create(
        purchase_order=order,
        received_by=employee,
    )
    receipt_line = GoodsReceiptItem.objects.create(
        goods_receipt=receipt,
        purchase_order_item=order_line,
        quantity_received=Decimal("4.00"),
        unit_cost=Decimal("1000.00"),
    )
    inspection = GoodsInspection.objects.create(
        goods_receipt=receipt,
        inspected_by=employee,
    )
    decision = GoodsInspectionItem.objects.create(
        inspection=inspection,
        goods_receipt_item=receipt_line,
        quantity_received=Decimal("4.00"),
        quantity_accepted=Decimal("3.00"),
        quantity_rejected=Decimal("0.00"),
    )
    inspection.refresh_from_db()
    assert inspection.status == "pending"
    assert receipt.posting_readiness()["can_proceed"] is False

    decision.quantity_accepted = Decimal("4.00")
    decision.save()
    receipt.refresh_from_db()
    receipt.post_to_inventory(posted_by=employee)
    receipt.refresh_from_db()
    assert receipt.status == "posted"

    receipt_line.quantity_received = Decimal("3.00")
    with pytest.raises(ValidationError, match="Posted or cancelled GRN"):
        receipt_line.save()
