import re
from datetime import timedelta
from decimal import Decimal
from importlib import import_module

import pytest
from django.apps import apps as django_apps
from django.core import mail
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ValidationError
from django.test import override_settings
from django.utils import timezone
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
    StoreKeeperAssignment,
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
    ProcurementDocumentSequence,
    RequisitionItem,
    VendorQuotation,
    VendorQuotationItem,
)
from apps.procurement.documents import build_purchase_order_pdf
from apps.notifications.models import Notification
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
    order.issue(sent_by=employee, sent_to_email="unregistered@example.com")
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
def test_store_keeper_can_read_only_assigned_store_lpo_without_commercial_data():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Receiving Branch")
    employee.branch = branch
    employee.save(update_fields=["branch", "updated_at"])
    employee.user.groups.add(Group.objects.get_or_create(name="Store Keeper")[0])
    store = StoreLocation.objects.create(branch=branch, name="Assigned Main Store")
    StoreKeeperAssignment.objects.create(store=store, employee=employee)
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
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        store=store,
        po_number="PO-STORE-VIEW",
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("2.00"),
        unit_cost=Decimal("5000.00"),
        destination_store=store,
    )

    client = APIClient()
    client.force_authenticate(employee.user)
    response = client.get("/api/v1/requisitions/workspace/?stage=lpo")

    assert response.status_code == 200
    assert [row["po_number"] for row in response.data["orders"]] == ["PO-STORE-VIEW"]
    assert "supplier" not in response.data["orders"][0]
    assert "total_amount" not in response.data["orders"][0]
    assert "unit_cost" not in response.data["orderItems"][0]


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
def test_procurement_lpo_workspace_includes_approved_requisition_before_order_exists():
    employee, department, supplier, item = create_procurement_context()
    procurement_group, _ = Group.objects.get_or_create(name="Procurement Manager")
    procurement_group.permissions.add(
        Permission.objects.get(codename="view_purchaseorder")
    )
    employee.user.groups.add(procurement_group)
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Ready for first LPO",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
        approved_quantity=Decimal("2.00"),
    )

    client = APIClient()
    client.force_authenticate(employee.user)
    response = client.get("/api/v1/requisitions/workspace/?stage=lpo")

    assert response.status_code == 200
    assert str(requisition.pk) in {row["id"] for row in response.data["requisitions"]}
    assert response.data["orders"] == []


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
    assert re.fullmatch(r"\d{6}", requisition.requisition_number)
    assert order.po_number.isdigit()
    assert re.fullmatch(r"\d{6}", order.lpo_number)
    assert order.po_number == order.lpo_number
    assert requisition.requisition_number != order.lpo_number
    assert order.status == POStatus.DRAFT
    assert order.total_amount == Decimal("32000.00")
    assert order_item.item == item
    assert order_item.quantity == Decimal("4.00")
    assert order_item.unit_cost == Decimal("8000.00")


@pytest.mark.django_db
def test_document_number_migration_repairs_existing_collisions_and_legacy_values():
    employee, department, supplier, _ = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requisition_number="000001",
        requester=employee,
        department=department,
        reason="Legacy numbering",
        status=PRStatus.APPROVED,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
    )
    PurchaseOrder.objects.filter(pk=order.pk).update(
        po_number="000001",
        lpo_number="HIST-LPO-01",
    )

    migration = import_module(
        "apps.procurement.migrations.0021_global_numeric_document_numbers"
    )
    migration.assign_global_numeric_references(django_apps, None)

    requisition.refresh_from_db()
    order.refresh_from_db()
    references = {
        requisition.requisition_number,
        order.po_number,
        order.lpo_number,
    }
    assert len(references) == 3
    assert all(reference.isdigit() for reference in references)
    sequence = ProcurementDocumentSequence.objects.get(document_type="procurement")
    assert sequence.current_value >= max(int(reference) for reference in references)


@pytest.mark.django_db
def test_purchase_order_conversion_rounds_down_without_exceeding_approved_quantity():
    employee, department, supplier, item = create_procurement_context()
    crate = UnitOfMeasure.objects.create(name="Crate", abbreviation="crt")
    ItemUnitPrice.objects.create(
        item=item,
        unit=crate,
        conversion_factor=Decimal("24.0000"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="One hundred pieces of water",
        status=PRStatus.APPROVED,
    )
    requisition_item = RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("100.00"),
        approved_quantity=Decimal("100.00"),
    )
    quotation = VendorQuotation.objects.create(
        requisition=requisition,
        supplier=supplier,
    )
    VendorQuotationItem.objects.create(
        quotation=quotation,
        requisition_item=requisition_item,
        unit=crate,
        quantity=Decimal("4.17"),
        unit_price=Decimal("28000.00"),
        selected=True,
    )

    order = requisition.create_purchase_order(ordered_by=employee)
    order_item = order.items.get()

    assert order_item.quantity == Decimal("4.16")
    assert order_item.base_quantity == Decimal("99.84")
    assert order.quantity_commitment_blockers() == []


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
        designation="Financial Manager",
    )
    manager_user = get_user_model().objects.create_user(
        username="lpo-general-manager",
        employee_code="EMP-LPO-GM",
        password="test-pass-123",
    )
    manager = Employee.objects.create(
        user=manager_user,
        department=department,
        branch=branch,
        designation="General Manager",
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
    purchasing_group, _ = Group.objects.get_or_create(name="Procurement Manager")
    finance_group, _ = Group.objects.get_or_create(name="Financial Manager")
    general_group, _ = Group.objects.get_or_create(name="General Manager")
    purchasing_user = get_user_model().objects.create_user(
        username="lpo-purchasing-manager",
        employee_code="EMP-LPO-PM",
        password="test-pass-123",
    )
    purchasing_user.groups.add(purchasing_group)
    Employee.objects.create(
        user=purchasing_user,
        department=department,
        branch=branch,
        designation="Purchasing Manager",
    )
    approver_user.groups.add(finance_group)
    manager_user.groups.add(general_group)
    second_finance_user = get_user_model().objects.create_user(
        username="lpo-second-finance",
        employee_code="EMP-LPO-APR-2",
        password="test-pass-123",
    )
    Employee.objects.create(
        user=second_finance_user,
        department=department,
        branch=branch,
        designation="Financial Manager",
    )
    second_finance_user.groups.add(finance_group)

    with pytest.raises(ValidationError, match="approved LPO"):
        order.issue(sent_by=employee)

    order.submit_for_approval()
    order.refresh_from_db()
    assert order.status == POStatus.PENDING_APPROVAL
    steps = list(order.approval_workflow.all())
    assert [step.approver for step in steps] == [None, None, None]
    assert [step.approver_role for step in steps] == [purchasing_group, finance_group, general_group]

    purchasing_client = APIClient()
    purchasing_client.force_authenticate(purchasing_user)
    purchasing_response = purchasing_client.post(
        f"/api/v1/purchase-orders/{order.pk}/approve/",
        {"comments": "Purchasing approved"},
        format="json",
    )
    assert purchasing_response.status_code == 200
    order.refresh_from_db()
    assert order.status == POStatus.PENDING_APPROVAL

    finance_client = APIClient()
    finance_client.force_authenticate(second_finance_user)
    finance_response = finance_client.post(f"/api/v1/purchase-orders/{order.pk}/approve/", {"comments": "Finance approved"}, format="json")
    assert finance_response.status_code == 200
    order.refresh_from_db()
    assert order.status == POStatus.PENDING_APPROVAL

    first_finance_client = APIClient()
    first_finance_client.force_authenticate(approver_user)
    duplicate_response = first_finance_client.post(f"/api/v1/purchase-orders/{order.pk}/approve/", {}, format="json")
    assert duplicate_response.status_code == 403

    management_client = APIClient()
    management_client.force_authenticate(manager_user)
    management_response = management_client.post(f"/api/v1/purchase-orders/{order.pk}/approve/", {"comments": "Final approval"}, format="json")
    assert management_response.status_code == 200
    order.refresh_from_db()
    assert order.status == POStatus.APPROVED
    assert order.approved_by == manager
    notification = Notification.objects.get(employee=employee)
    assert "finally approved" in notification.title
    assert "Approved · Print & Send" in notification.message

    order.issue(sent_by=employee)
    assert order.status == POStatus.ISSUED


@pytest.mark.django_db
def test_finance_reduction_preserves_procurement_quantity_and_audit_history():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Finance quantity control",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("10.00"),
        approved_quantity=Decimal("10.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
    )
    line = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("10.00"),
        unit_cost=Decimal("2000.00"),
    )
    order.status = POStatus.PENDING_APPROVAL
    order.save(update_fields=("status", "updated_at"))

    order.apply_finance_quantity_reductions(
        reductions=[{
            "id": str(line.pk),
            "approved_quantity": "6.00",
            "reason": "Budget ceiling",
        }],
        actor=employee.user,
    )

    line.refresh_from_db()
    order.refresh_from_db()
    assert line.quantity == Decimal("10.00")
    assert line.procurement_quantity == Decimal("10.00")
    assert line.finance_approved_quantity == Decimal("6.00")
    assert line.approved_quantity == Decimal("6.00")
    assert order.total_amount == Decimal("12000.00")
    assert order.activities.filter(action="finance_quantity_reduced").exists()


@pytest.mark.django_db
def test_controlled_lpo_pdf_marks_first_print_original_and_later_prints_copy():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Controlled printing",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
        approved_quantity=Decimal("2.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("2.00"),
        unit_cost=Decimal("7000.00"),
    )
    order.status = POStatus.APPROVED
    order.save(update_fields=("status", "updated_at"))

    original = order.record_print(printed_by=employee.user)
    copy = order.record_print(printed_by=employee.user)
    original_pdf = build_purchase_order_pdf(
        order,
        classification="***** Original Order *****",
        printed_by=employee.user,
    )
    copy_pdf = build_purchase_order_pdf(
        order,
        classification="***** Copy of Original Order *****",
        printed_by=employee.user,
    )

    assert original.classification == "original"
    assert copy.classification == "copy"
    assert original.print_number == 1
    assert copy.print_number == 2
    assert original_pdf.startswith(b"%PDF")
    assert copy_pdf.startswith(b"%PDF")
    assert order.activities.filter(action="printed").count() == 2


@pytest.mark.django_db
def test_controlled_lpo_endpoint_accepts_pdf_content_negotiation():
    employee, department, supplier, item = create_procurement_context()
    procurement_group, _ = Group.objects.get_or_create(name="Procurement Manager")
    procurement_group.permissions.add(
        Permission.objects.get(codename="change_purchaseorder")
    )
    employee.user.groups.add(procurement_group)
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Download the controlled supplier order",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
        approved_quantity=Decimal("2.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("2.00"),
        unit_cost=Decimal("7000.00"),
    )
    order.status = POStatus.APPROVED
    order.save(update_fields=("status", "updated_at"))
    client = APIClient()
    client.force_authenticate(employee.user)

    response = client.post(
        f"/api/v1/purchase-orders/{order.pk}/controlled-document/",
        HTTP_ACCEPT="application/pdf",
    )

    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response["X-LPO-Print-Classification"] == "ORIGINAL"
    assert response.content.startswith(b"%PDF")


@pytest.mark.django_db
@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
    EMAIL_HOST="",
    DEFAULT_FROM_EMAIL="procurement@localhost",
)
def test_approved_lpo_reports_missing_production_email_configuration():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Supplier email configuration check",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("1.00"),
        approved_quantity=Decimal("1.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("1.00"),
        unit_cost=Decimal("5000.00"),
    )
    order.status = POStatus.APPROVED
    order.save(update_fields=("status", "updated_at"))

    readiness = order.issue_readiness()

    assert readiness["can_proceed"] is False
    assert any("Production email is not configured" in blocker for blocker in readiness["blockers"])


@pytest.mark.django_db
@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    DEFAULT_FROM_EMAIL="purchasing@example.com",
)
def test_supplier_email_contains_lpo_pdf_and_starts_lead_clock_after_success():
    employee, department, supplier, item = create_procurement_context()
    procurement_group, _ = Group.objects.get_or_create(name="Procurement Manager")
    procurement_group.permissions.add(
        Permission.objects.get(codename="change_purchaseorder")
    )
    employee.user.groups.add(procurement_group)
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Supplier email control",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("3.00"),
        approved_quantity=Decimal("3.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        lead_time_days=4,
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        quantity=Decimal("3.00"),
        unit_cost=Decimal("5000.00"),
    )
    order.status = POStatus.APPROVED
    order.save(update_fields=("status", "updated_at"))
    client = APIClient()
    client.force_authenticate(employee.user)

    response = client.post(
        f"/api/v1/purchase-orders/{order.pk}/issue/",
        {},
        format="json",
    )

    assert response.status_code == 200, response.data
    order.refresh_from_db()
    assert order.status == POStatus.ISSUED
    assert order.sent_at is not None
    assert order.delivery_due_date == order.sent_at.date() + timedelta(days=4)
    assert order.sent_to_email == supplier.email
    assert order.email_status == "sent"
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == [supplier.email]
    assert mail.outbox[0].attachments[0].filename == f"LPO-{order.lpo_number}.pdf"
    assert mail.outbox[0].attachments[0].mimetype == "application/pdf"


@pytest.mark.django_db
def test_receiving_clerk_workspace_shows_only_ready_branch_lpos_without_prices():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Receiving Scope Branch")
    other_branch = Branch.objects.create(name="Other Receiving Branch")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    receiving, _ = Group.objects.get_or_create(name="Receiving Clerk")
    receiving.permissions.add(
        Permission.objects.get(codename="view_goodsreceiptnote")
    )
    employee.user.groups.add(receiving)

    def make_order(target_branch, status, suffix):
        requisition = PurchaseRequisition.objects.create(
            requester=employee,
            department=department,
            branch=target_branch,
            reason=f"Receiving scope {suffix}",
            status=PRStatus.APPROVED,
        )
        RequisitionItem.objects.create(
            requisition=requisition,
            item=item,
            quantity=Decimal("2.00"),
            approved_quantity=Decimal("2.00"),
        )
        order = PurchaseOrder.objects.create(
            requisition=requisition,
            supplier=supplier,
            ordered_by=employee,
            po_number=f"900{suffix}",
        )
        PurchaseOrderItem.objects.create(
            purchase_order=order,
            item=item,
            quantity=Decimal("2.00"),
            unit_cost=Decimal("4000.00"),
        )
        order.status = status
        order.save(update_fields=("status", "updated_at"))
        return order

    ready = make_order(branch, POStatus.ISSUED, "1")
    make_order(branch, POStatus.APPROVED, "2")
    make_order(other_branch, POStatus.ISSUED, "3")
    client = APIClient()
    client.force_authenticate(employee.user)

    response = client.get("/api/v1/requisitions/workspace/?stage=receipt")

    assert response.status_code == 200, response.data
    assert [row["id"] for row in response.data["orders"]] == [str(ready.pk)]
    assert "total_amount" not in response.data["orders"][0]
    assert "unit_cost" not in response.data["orderItems"][0]


@pytest.mark.django_db
def test_receiving_clerk_can_generate_posted_grn_directly_from_issued_lpo():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Direct GRN Branch")
    store = StoreLocation.objects.create(branch=branch, name="Main Store")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    receiving, _ = Group.objects.get_or_create(name="Receiving Clerk")
    employee.user.groups.add(receiving)
    item.expiry_tracking = True
    item.save(update_fields=("expiry_tracking", "updated_at"))

    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        branch=branch,
        reason="Receiving desk test",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
        approved_quantity=Decimal("2.00"),
        destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        store=store,
        po_number="991001",
    )
    order_line = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        unit=item.base_unit,
        quantity=Decimal("2.00"),
        unit_cost=Decimal("5000.00"),
    )
    authorize_order_for_test(order)
    order.issue(sent_by=employee, sent_to_email=supplier.email)

    client = APIClient()
    client.force_authenticate(employee.user)
    received_date = timezone.localdate()
    expiry_date = received_date + timedelta(days=20)
    missing_expiry = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "supplier_invoice_no": "INV-MISSING-EXPIRY",
            "received_date": received_date.isoformat(),
            "lines": [{
                "purchase_order_item": str(order_line.pk),
                "quantity_received": "1.00",
            }],
        },
        format="json",
    )
    assert missing_expiry.status_code == 400
    assert not GoodsReceiptNote.objects.filter(
        supplier_invoice_no="INV-MISSING-EXPIRY"
    ).exists()

    response = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "supplier_invoice_no": "INV-1001",
            "delivery_note_no": "DN-1001",
            "received_date": received_date.isoformat(),
            "lines": [
                {
                    "purchase_order_item": str(order_line.pk),
                    "quantity_received": "1.00",
                    "expiry_date": expiry_date.isoformat(),
                }
            ],
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    receipt = GoodsReceiptNote.objects.get(pk=response.data["id"])
    receipt_line = receipt.items.get()
    receipt.refresh_from_db()
    order.refresh_from_db()
    assert receipt.status == "posted"
    assert receipt.supplier_invoice_no == "INV-1001"
    assert receipt_line.quantity_received == Decimal("1.00")
    assert receipt_line.expiry_date == expiry_date
    assert receipt.inspection.status == "accepted"
    assert receipt.inspection.items.get().quantity_accepted == Decimal("1.00")
    assert order.status == POStatus.PARTIALLY_RECEIVED
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("1.00")
    assert InventoryBatch.objects.get(item=item, store=store).expiry_date == expiry_date


@pytest.mark.django_db
def test_procurement_officer_and_general_manager_can_view_but_not_change_lpo_price():
    employee, department, supplier, item = create_procurement_context()
    procurement_group, _ = Group.objects.get_or_create(name="Procurement Manager")
    item_permissions = Permission.objects.filter(
        content_type__app_label="procurement",
        codename__in=("view_purchaseorderitem", "change_purchaseorderitem"),
    )
    procurement_group.permissions.add(*item_permissions)
    employee.user.groups.add(procurement_group)
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Read-only LPO rate",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
        approved_quantity=Decimal("2.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
    )
    order_line = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        unit=item.base_unit,
        quantity=Decimal("2.00"),
        unit_cost=Decimal("5000.00"),
    )

    officer_client = APIClient()
    officer_client.force_authenticate(employee.user)
    officer_view = officer_client.get(f"/api/v1/purchase-order-items/{order_line.pk}/")
    officer_change = officer_client.patch(
        f"/api/v1/purchase-order-items/{order_line.pk}/",
        {"unit_cost": "6000.00"},
        format="json",
    )

    general_group, _ = Group.objects.get_or_create(name="General Manager")
    general_group.permissions.add(*item_permissions)
    gm_user = get_user_model().objects.create_user(
        username="read-only-price-gm",
        employee_code="PRICE-GM",
        password="test-pass-123",
    )
    gm_user.groups.add(general_group)
    Employee.objects.create(
        user=gm_user,
        department=department,
        designation="General Manager",
    )
    gm_client = APIClient()
    gm_client.force_authenticate(gm_user)
    gm_view = gm_client.get(f"/api/v1/purchase-order-items/{order_line.pk}/")
    gm_change = gm_client.patch(
        f"/api/v1/purchase-order-items/{order_line.pk}/",
        {"unit_cost": "7000.00"},
        format="json",
    )

    order_line.refresh_from_db()
    assert officer_view.status_code == 200
    assert officer_view.data["unit_cost"] == "5000.00"
    assert officer_change.status_code == 400
    assert gm_view.status_code == 200
    assert gm_view.data["unit_cost"] == "5000.00"
    assert gm_change.status_code == 400
    assert order_line.unit_cost == Decimal("5000.00")


@pytest.mark.django_db
def test_receiving_clerk_workspace_keeps_grn_after_lpo_is_fully_received():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Completed GRN History Branch")
    store = StoreLocation.objects.create(branch=branch, name="Completed GRN Store")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    receiving, _ = Group.objects.get_or_create(name="Receiving Clerk")
    receiving.permissions.add(Permission.objects.get(codename="view_goodsreceiptnote"))
    employee.user.groups.add(receiving)

    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        branch=branch,
        reason="Completed delivery history",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity=Decimal("2.00"),
        approved_quantity=Decimal("2.00"),
        destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition,
        supplier=supplier,
        ordered_by=employee,
        store=store,
        po_number="991002",
    )
    order_line = PurchaseOrderItem.objects.create(
        purchase_order=order,
        item=item,
        unit=item.base_unit,
        quantity=Decimal("2.00"),
        unit_cost=Decimal("5000.00"),
    )
    authorize_order_for_test(order)
    order.issue(sent_by=employee, sent_to_email=supplier.email)

    client = APIClient()
    client.force_authenticate(employee.user)
    generated = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "supplier_invoice_no": "INV-FULL-1002",
            "received_date": "2026-08-27",
            "lines": [{
                "purchase_order_item": str(order_line.pk),
                "quantity_received": "2.00",
            }],
        },
        format="json",
    )

    assert generated.status_code == 201, generated.data
    order.refresh_from_db()
    assert order.status == POStatus.RECEIVED

    workspace = client.get("/api/v1/requisitions/workspace/?stage=receipt")

    assert workspace.status_code == 200, workspace.data
    assert workspace.data["orders"] == []
    assert [row["id"] for row in workspace.data["receipts"]] == [generated.data["id"]]
    assert workspace.data["receipts"][0]["branch_id"] == str(branch.pk)
    assert workspace.data["receipts"][0]["branch_name"] == branch.name
    assert workspace.data["receipts"][0]["supplier_name"] == supplier.name
    assert workspace.data["receipts"][0]["received_by_name"] == employee.user.username
    assert workspace.data["receiptItems"][0]["item_name"] == item.name
    assert workspace.data["receiptItems"][0]["item_sku"] == item.sku
    assert workspace.data["receiptItems"][0]["unit_name"] == item.base_unit.name
    assert workspace.data["receiptItems"][0]["ordered_quantity"] == "2.00"
    assert workspace.data["receiptItems"][0]["accepted_quantity"] == "2.00"
    assert workspace.data["receiptItems"][0]["rejected_quantity"] == "0.00"


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

@pytest.mark.django_db
def test_procurement_allocations_split_one_store_requisition_into_supplier_lpos():
    employee, department, supplier_a, item_a = create_procurement_context()
    branch = Branch.objects.create(name="Allocation Branch", branch_code="ALC")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    store = StoreLocation.objects.create(branch=branch, name="Main Store")

    supplier_b = Supplier.objects.create(
        name="Second Supplier",
        email="second@example.com",
        phone="+256700000099",
        address="Kampala",
        tin_number="TIN-099",
        registration_number="REG-099",
    )
    item_b = Item.objects.create(
        category=item_a.category,
        name="Sugar",
        sku="SUGAR-001",
        unit="kilogram",
        base_unit=item_a.base_unit,
        reorder_level=Decimal("5.00"),
    )
    price_a = SupplierItemPrice.objects.create(
        supplier=supplier_a,
        item=item_a,
        unit=item_a.base_unit,
        unit_price=Decimal("4500.00"),
        lead_time_days=2,
    )
    price_b = SupplierItemPrice.objects.create(
        supplier=supplier_b,
        item=item_b,
        unit=item_b.base_unit,
        unit_price=Decimal("5200.00"),
        lead_time_days=3,
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        branch=branch,
        reason="Store Keeper forwarded multi-item request",
        status=PRStatus.APPROVED,
    )
    line_a = RequisitionItem.objects.create(
        requisition=requisition,
        item=item_a,
        unit=item_a.base_unit,
        quantity=Decimal("10.00"),
        approved_quantity=Decimal("10.00"),
        destination_store=store,
    )
    line_b = RequisitionItem.objects.create(
        requisition=requisition,
        item=item_b,
        unit=item_b.base_unit,
        quantity=Decimal("6.00"),
        approved_quantity=Decimal("6.00"),
        destination_store=store,
    )
    for line, supplier, price, quantity in (
        (line_a, supplier_a, price_a, Decimal("8.00")),
        (line_b, supplier_b, price_b, Decimal("5.00")),
    ):
        line.procurement_supplier = supplier
        line.procurement_supplier_price = price
        line.procurement_unit = price.unit
        line.procurement_quantity = quantity
        line.procurement_unit_cost = price.unit_price
        line.save(update_fields=(
            "procurement_supplier", "procurement_supplier_price", "procurement_unit",
            "procurement_quantity", "procurement_unit_cost", "updated_at",
        ))

    orders = requisition.create_allocated_purchase_orders(ordered_by=employee, created_by=employee.user)

    assert len(orders) == 2
    assert {order.supplier_id for order in orders} == {supplier_a.id, supplier_b.id}
    assert all(order.po_number == order.lpo_number for order in orders)
    assert all(order.lpo_number.isdigit() and len(order.lpo_number) == 6 for order in orders)
    assert sorted(order.items.count() for order in orders) == [1, 1]


@pytest.mark.django_db
def test_role_approval_inbox_advances_from_purchasing_to_finance_to_general_manager():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Approval Inbox Branch")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    store = StoreLocation.objects.create(branch=branch, name="Approval Inbox Store")

    purchasing_group, _ = Group.objects.get_or_create(name="Procurement Manager")
    finance_group, _ = Group.objects.get_or_create(name="Financial Manager")
    general_group, _ = Group.objects.get_or_create(name="General Manager")

    purchasing_user = get_user_model().objects.create_user(
        username="approval-inbox-purchasing", employee_code="EMP-INBOX-PM", password="test-pass-123"
    )
    purchasing_user.groups.add(purchasing_group)
    Employee.objects.create(
        user=purchasing_user, department=department, branch=branch, designation="Purchasing Manager"
    )
    finance_user = get_user_model().objects.create_user(
        username="approval-inbox-finance", employee_code="EMP-INBOX-FIN", password="test-pass-123"
    )
    finance_user.groups.add(finance_group)
    Employee.objects.create(
        user=finance_user, department=department, branch=branch, designation="Financial Manager"
    )
    gm_user = get_user_model().objects.create_user(
        username="approval-inbox-gm", employee_code="EMP-INBOX-GM", password="test-pass-123"
    )
    gm_user.groups.add(general_group)
    Employee.objects.create(
        user=gm_user, department=department, branch=branch, designation="General Manager"
    )

    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch, reason="Inbox handoff", status=PRStatus.APPROVED
    )
    req_line = RequisitionItem.objects.create(
        requisition=requisition, item=item, quantity=Decimal("4.00"), approved_quantity=Decimal("4.00"), destination_store=store
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier, ordered_by=employee, store=store
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order, requisition_item=req_line, item=item, quantity=Decimal("4.00"), unit_cost=Decimal("1000.00"), destination_store=store
    )
    order.submit_for_approval()

    purchasing_client = APIClient()
    purchasing_client.force_authenticate(purchasing_user)
    finance_client = APIClient()
    finance_client.force_authenticate(finance_user)
    gm_client = APIClient()
    gm_client.force_authenticate(gm_user)

    purchasing_before = purchasing_client.get("/api/v1/purchase-orders/approval-inbox/")
    finance_before = finance_client.get("/api/v1/purchase-orders/approval-inbox/")
    gm_before = gm_client.get("/api/v1/purchase-orders/approval-inbox/")
    assert purchasing_before.status_code == 200
    assert finance_before.status_code == 200
    assert gm_before.status_code == 200
    assert [row["id"] for row in purchasing_before.json()] == [str(order.id)]
    assert finance_before.json() == []
    assert gm_before.json() == []

    purchasing_approved = purchasing_client.post(
        f"/api/v1/purchase-orders/{order.pk}/approve/", {"comments": "Purchasing approved"}, format="json"
    )
    assert purchasing_approved.status_code == 200
    assert purchasing_client.get("/api/v1/purchase-orders/approval-inbox/").json() == []
    assert [row["id"] for row in finance_client.get("/api/v1/purchase-orders/approval-inbox/").json()] == [str(order.id)]
    assert gm_client.get("/api/v1/purchase-orders/approval-inbox/").json() == []

    finance_approved = finance_client.post(
        f"/api/v1/purchase-orders/{order.pk}/approve/", {"comments": "Finance approved"}, format="json"
    )
    assert finance_approved.status_code == 200
    assert finance_client.get("/api/v1/purchase-orders/approval-inbox/").json() == []
    assert [row["id"] for row in gm_client.get("/api/v1/purchase-orders/approval-inbox/").json()] == [str(order.id)]

    final_approval = gm_client.post(
        f"/api/v1/purchase-orders/{order.pk}/approve/", {"comments": "Final approval"}, format="json"
    )
    assert final_approval.status_code == 200
    gm_history = gm_client.get("/api/v1/purchase-orders/decision-history/")
    assert gm_history.status_code == 200
    assert [row["id"] for row in gm_history.json()] == [str(order.id)]
    gm_step = next(step for step in gm_history.json()[0]["approval_steps"] if step["stage"] == 3)
    assert gm_step["status"] == "approved"
    expected_gm_name = gm_user.get_full_name() or gm_user.username
    assert gm_step["approver_name"] == expected_gm_name

@pytest.mark.django_db
def test_supplier_pack_quote_keeps_lpo_quantity_in_article_base_uom():
    employee, department, supplier, _ = create_procurement_context()
    procurement_group, _ = Group.objects.get_or_create(name="Procurement Manager")
    employee.user.groups.add(procurement_group)

    category = Category.objects.create(name="Office Supplies - LPO UOM")
    ream = UnitOfMeasure.objects.create(name="Ream - LPO UOM", abbreviation="ream")
    carton = UnitOfMeasure.objects.create(name="Carton - LPO UOM", abbreviation="ctn")
    paper = Item.objects.create(
        category=category,
        name="A4 Printing Paper - LPO UOM",
        sku="A4-LPO-UOM",
        unit="ream",
        base_unit=ream,
        reorder_level=Decimal("0.00"),
    )
    ItemUnitPrice.objects.create(
        item=paper,
        unit=carton,
        conversion_factor=Decimal("5.00"),
        role="purchase",
        is_active=True,
    )
    quote = SupplierItemPrice.objects.create(
        supplier=supplier,
        item=paper,
        unit=carton,
        unit_price=Decimal("97500.00"),
        lead_time_days=2,
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="One ream should stay one ream on the LPO",
        status=PRStatus.APPROVED,
        procurement_source="store_requisition",
    )
    RequisitionItem.objects.create(
        requisition=requisition,
        item=paper,
        unit=ream,
        quantity=Decimal("1.00"),
        approved_quantity=Decimal("1.00"),
    )

    client = APIClient()
    client.force_authenticate(employee.user)
    allocation = client.post(
        f"/api/v1/requisitions/{requisition.pk}/allocate-line/",
        {
            "line_id": str(requisition.items.get().pk),
            "supplier_price": str(quote.pk),
            "quantity": "1.00",
            "unit_price": "97500.00",
        },
        format="json",
    )
    assert allocation.status_code == 200, allocation.data
    allocated = requisition.items.get()
    assert allocated.procurement_quantity == Decimal("1.00")
    assert allocated.procurement_unit_id == ream.id
    assert allocated.procurement_unit_cost == Decimal("19500.00")

    orders = requisition.create_allocated_purchase_orders(
        ordered_by=employee,
        created_by=employee.user,
    )
    lpo_line = orders[0].items.get()
    assert lpo_line.quantity == Decimal("1.00")
    assert lpo_line.unit_id == ream.id
    assert lpo_line.unit_cost == Decimal("19500.00")
    assert lpo_line.line_total == Decimal("19500.0000")
