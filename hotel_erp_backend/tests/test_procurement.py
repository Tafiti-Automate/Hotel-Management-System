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
    ProcurementCommunication,
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
from core.constants.choices import GoodsReceiptStatus, LedgerReferenceType, POStatus, PRStatus


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


def open_receiving_period(branch):
    from calendar import monthrange
    from apps.materials_control.models import FiscalPeriod
    today = timezone.localdate()
    return FiscalPeriod.objects.create(
        branch=branch, name=f"Receiving acceptance {branch.pk}",
        start_date=today.replace(day=1),
        end_date=today.replace(day=monthrange(today.year, today.month)[1]),
    )


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
def test_new_requisition_date_is_server_assigned():
    employee, department, _supplier, _item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Timestamp controlled request",
        expected_date=timezone.localdate() - timedelta(days=3),
    )

    assert requisition.expected_date == timezone.localdate()


@pytest.mark.django_db
def test_draft_lpo_quantity_cannot_be_increased_after_a_reduction():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Reduction-only LPO draft",
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

    line.quantity = Decimal("6.00")
    line.save()
    line.quantity = Decimal("7.00")

    with pytest.raises(ValidationError, match="retained or reduced"):
        line.save()


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

    # Posting an uninspected line must not mutate inventory.
    with pytest.raises(ValidationError, match="Inspect and accept or reject"):
        receipt_item.post_to_inventory()
    assert not StockLedger.objects.filter(reference_id=receipt.pk).exists()
    assert not receipt.items.filter(inventory_changes_applied=True).exists()
    inspection = GoodsInspection.objects.create(goods_receipt=receipt, inspected_by=employee)
    GoodsInspectionItem.objects.create(
        inspection=inspection,
        goods_receipt_item=receipt_item,
        quantity_received=receipt_item.base_quantity,
        quantity_accepted=receipt_item.base_quantity,
        quantity_rejected=Decimal("0.0000"),
    )
    receipt.refresh_from_db()
    receipt.post_to_inventory(posted_by=employee)

    order.refresh_from_db()
    receipt_item.refresh_from_db()
    assert order_item.base_quantity == Decimal("36.0000")
    assert order.total_amount == Decimal("21000.00")
    assert receipt_item.base_quantity == Decimal("24.0000")
    assert receipt_item.store == store
    assert receipt_item.inventory_changes_applied is True
    # An accepted partial delivery leaves the balance of the LPO outstanding.
    receipt.refresh_from_db()
    assert receipt.status == GoodsReceiptStatus.POSTED
    assert order.status == POStatus.PARTIALLY_RECEIVED
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("24.00")
    batch = InventoryBatch.objects.get(item=item, store=store)
    assert batch.remaining_quantity == Decimal("24.00")
    assert batch.unit_cost == Decimal("583.33")
    assert StockLedger.objects.get(reference_id=receipt.id).quantity_in == Decimal("24.00")

    with pytest.raises(ValidationError):
        receipt_item.post_to_inventory()
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("24.0000")
    assert StockLedger.objects.filter(reference_id=receipt.id).count() == 1


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
def test_store_keeper_can_repeat_open_purchase_request_for_same_item_and_store():
    employee, _department, _supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Repeat Request Branch")
    employee.branch = branch
    employee.save(update_fields=["branch", "updated_at"])
    employee.user.groups.add(Group.objects.get_or_create(name="Store Keeper")[0])
    store = StoreLocation.objects.create(branch=branch, name="Repeat Request Store")
    StoreKeeperAssignment.objects.create(store=store, employee=employee)

    client = APIClient()
    client.force_authenticate(employee.user)
    first = client.post(
        "/api/v1/requisitions/store-purchase-requests/",
        {
            "store": str(store.pk),
            "reason": "Initial replenishment requirement",
            "lines": [{"item": str(item.pk), "quantity": "2"}],
        },
        format="json",
    )
    second = client.post(
        "/api/v1/requisitions/store-purchase-requests/",
        {
            "store": str(store.pk),
            "reason": "Additional requirement before the first request is complete",
            "lines": [{"item": str(item.pk), "quantity": "3"}],
        },
        format="json",
    )

    assert first.status_code == 201, first.data
    assert second.status_code == 201, second.data
    requests = PurchaseRequisition.objects.filter(
        requester=employee,
        procurement_source="store_purchase",
    )
    assert requests.count() == 2
    assert set(requests.values_list("status", flat=True)) == {PRStatus.APPROVED}
    assert RequisitionItem.objects.filter(
        requisition__in=requests,
        item=item,
        destination_store=store,
    ).count() == 2


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
    # Authorized Purchasing operators must belong to a property; an unassigned
    # employee must no longer see the global requisition queue.
    employee.branch = Branch.objects.create(name="procurement_lpo_workspace_includes_a")
    employee.save(update_fields=["branch"])

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

    # LPO review must expose business labels to Procurement users even when
    # their account cannot fetch the full inventory item or supplier catalogue.
    from apps.procurement.serializers import PurchaseOrderItemSerializer
    line_payload = PurchaseOrderItemSerializer(order_item).data
    order_payload = PurchaseOrderSerializer(order).data
    assert line_payload["item_name"] == item.name
    assert line_payload["item_sku"] == item.sku
    assert line_payload["unit_name"] == (
        order_item.unit.name if order_item.unit_id else None
    )
    assert order_payload["supplier_name"] == supplier.name


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

    assert order_item.quantity == Decimal("4.1666")
    assert order_item.base_quantity == Decimal("99.9984")
    # Four-decimal purchase UOM precision avoids needless shortage while still
    # rounding down so procurement never exceeds the approved base quantity.
    assert order_item.base_quantity <= requisition_item.approved_base_quantity
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
    # Posting an uninspected line must not mutate inventory.
    with pytest.raises(ValidationError, match="Inspect and accept or reject"):
        receipt_item.post_to_inventory()
    assert not StockLedger.objects.filter(reference_id=receipt.pk).exists()
    assert not receipt.items.filter(inventory_changes_applied=True).exists()
    inspection = GoodsInspection.objects.create(goods_receipt=receipt, inspected_by=employee)
    GoodsInspectionItem.objects.create(
        inspection=inspection,
        goods_receipt_item=receipt_item,
        quantity_received=receipt_item.base_quantity,
        quantity_accepted=receipt_item.base_quantity,
        quantity_rejected=Decimal("0.0000"),
    )
    receipt.refresh_from_db()
    receipt.post_to_inventory(posted_by=employee)
    assert receipt.status == GoodsReceiptStatus.POSTED

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
    assert order.activities.filter(action="approval_stage_2_quantity_review").exists()


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
def test_lpo_preview_is_inline_and_does_not_consume_controlled_print():
    employee, department, supplier, item = create_procurement_context()
    procurement_group, _ = Group.objects.get_or_create(name="Procurement Manager")
    procurement_group.permissions.add(
        Permission.objects.get(codename="view_purchaseorder")
    )
    employee.user.groups.add(procurement_group)
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Preview the LPO without downloading it",
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
    client = APIClient()
    client.force_authenticate(employee.user)

    response = client.get(
        f"/api/v1/purchase-orders/{order.pk}/preview-document/",
        HTTP_ACCEPT="application/pdf",
    )

    assert response.status_code == 200
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"].startswith("inline;")
    assert response["X-LPO-Document-Type"] == "PREVIEW"
    assert response.content.startswith(b"%PDF")
    assert order.print_records.count() == 0


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
@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    DEFAULT_FROM_EMAIL="purchasing@example.com",
)
def test_lpo_pdf_failure_is_not_reported_as_an_email_configuration_error(monkeypatch):
    employee, department, supplier, item = create_procurement_context()
    procurement_group, _ = Group.objects.get_or_create(name="Procurement Manager")
    procurement_group.permissions.add(
        Permission.objects.get(codename="change_purchaseorder")
    )
    employee.user.groups.add(procurement_group)
    requisition = PurchaseRequisition.objects.create(
        requester=employee,
        department=department,
        reason="Supplier document failure",
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

    def fail_document(*args, **kwargs):
        raise NotImplementedError("storage cannot open the hotel logo")

    monkeypatch.setattr(
        "apps.procurement.views.build_purchase_order_pdf",
        fail_document,
    )
    client = APIClient()
    client.force_authenticate(employee.user)

    response = client.post(
        f"/api/v1/purchase-orders/{order.pk}/issue/",
        {},
        format="json",
    )

    assert response.status_code == 400
    assert "PDF could not be generated" in str(response.data["detail"])
    assert "mail configuration" not in str(response.data["detail"])
    order.refresh_from_db()
    assert order.status == POStatus.APPROVED
    assert order.sent_at is None
    assert order.email_status == "failed"
    communication = ProcurementCommunication.objects.get(purchase_order=order)
    assert communication.status == "failed"
    assert "storage cannot open" in communication.error_message
    assert len(mail.outbox) == 0


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
    assert "outstanding_quantity" not in response.data["orderItems"][0]
    assert "approved_quantity" not in response.data["orderItems"][0]
    assert response.data["orderItems"][0]["has_outstanding"] is True


@pytest.mark.django_db
def test_receiving_clerk_posts_accepted_goods_immediately_without_double_posting():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Direct GRN Branch")
    open_receiving_period(branch)
    store = StoreLocation.objects.create(branch=branch, name="Main Store")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    receiving, _ = Group.objects.get_or_create(name="Receiving Clerk")
    employee.user.groups.add(receiving)
    item.expiry_tracking = True
    item.requires_delivery_temperature = True
    item.save(update_fields=("expiry_tracking", "requires_delivery_temperature", "updated_at"))

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
    system_received_date = timezone.localdate()
    requested_received_date = system_received_date - timedelta(days=3)
    expiry_date = system_received_date + timedelta(days=20)
    missing_expiry = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "supplier_invoice_no": "INV-MISSING-EXPIRY",
            "received_date": requested_received_date.isoformat(),
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

    missing_temperature = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "supplier_invoice_no": "INV-MISSING-TEMP",
            "short_delivery_reason": "Only one unit delivered.",
            "lines": [{
                "purchase_order_item": str(order_line.pk),
                "quantity_received": "1.00",
                "expiry_date": expiry_date.isoformat(),
                "batch_number": "LOT-2026",
            }],
        },
        format="json",
    )
    assert missing_temperature.status_code == 400
    assert not GoodsReceiptNote.objects.filter(
        supplier_invoice_no="INV-MISSING-TEMP"
    ).exists()

    response = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "supplier_invoice_no": "INV-1001",
            "delivery_note_no": "DN-1001",
            "received_date": requested_received_date.isoformat(),
            "short_delivery_reason": "Supplier delivered the available stock; balance will follow.",
            "lines": [
                {
                    "purchase_order_item": str(order_line.pk),
                    "quantity_received": "1.00",
                    "expiry_date": expiry_date.isoformat(),
                    "batch_number": "LOT-2026",
                    "delivery_temperature": "4.50",
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
    assert receipt.received_date == system_received_date
    assert receipt.supplier_invoice_no == "INV-1001"
    assert receipt_line.quantity_received == Decimal("1.00")
    assert receipt_line.expiry_date == expiry_date
    assert receipt.inspection.status == "accepted"
    assert receipt.inspection.items.get().quantity_accepted == Decimal("1.00")
    balance = InventoryBalance.objects.get(item=item, store=store)
    assert balance.quantity_in_stock == Decimal("1.0000")
    assert StockLedger.objects.filter(reference_id=receipt.pk, quantity_in=Decimal("1.0000")).count() == 1

    posted = client.post(
        f"/api/v1/grns/{receipt.pk}/post-to-inventory/",
        {},
        format="json",
    )

    # The completed physical delivery already posted accepted goods atomically.
    # A second manual posting attempt must never increase stock twice.
    assert posted.status_code == 403, posted.data
    receipt.refresh_from_db()
    assert receipt.status == "posted"
    balance.refresh_from_db()
    assert balance.quantity_in_stock == Decimal("1.0000")
    assert StockLedger.objects.filter(reference_id=receipt.pk).count() == 1


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
    supplier_price = SupplierItemPrice.objects.create(
        supplier=supplier,
        item=item,
        unit=item.base_unit,
        unit_price=Decimal("5000.00"),
    )
    supplier_price_permissions = Permission.objects.filter(
        content_type__app_label="inventory",
        codename__in=("view_supplieritemprice", "change_supplieritemprice"),
    )
    procurement_group.permissions.add(*supplier_price_permissions)

    officer_client = APIClient()
    officer_client.force_authenticate(employee.user)
    officer_view = officer_client.get(f"/api/v1/purchase-order-items/{order_line.pk}/")
    officer_change = officer_client.patch(
        f"/api/v1/purchase-order-items/{order_line.pk}/",
        {"unit_cost": "6000.00"},
        format="json",
    )
    officer_catalogue_view = officer_client.get(
        f"/api/v1/supplier-item-prices/{supplier_price.pk}/"
    )
    officer_catalogue_change = officer_client.patch(
        f"/api/v1/supplier-item-prices/{supplier_price.pk}/",
        {"unit_price": "6000.00"},
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
    assert officer_catalogue_view.status_code == 200
    assert officer_catalogue_change.status_code == 403
    assert gm_view.status_code == 200
    assert gm_view.data["unit_cost"] == "5000.00"
    assert gm_change.status_code == 400
    assert order_line.unit_cost == Decimal("5000.00")
    supplier_price.refresh_from_db()
    assert supplier_price.unit_price == Decimal("5000.00")


@pytest.mark.django_db
def test_only_cost_controller_can_update_supplier_catalogue_price():
    _employee, department, supplier, item = create_procurement_context()
    supplier_price = SupplierItemPrice.objects.create(
        supplier=supplier,
        item=item,
        unit=item.base_unit,
        unit_price=Decimal("5000.00"),
    )
    cost_controller_group, _ = Group.objects.get_or_create(name="Cost Controller")
    cost_controller_group.permissions.add(*Permission.objects.filter(
        content_type__app_label="inventory",
        codename__in=("view_supplieritemprice", "change_supplieritemprice"),
    ))
    cost_controller_user = get_user_model().objects.create_user(
        username="supplier-price-cost-controller",
        employee_code="PRICE-CC",
        password="test-pass-123",
    )
    cost_controller_user.groups.add(cost_controller_group)
    Employee.objects.create(
        user=cost_controller_user,
        department=department,
        designation="Cost Controller",
    )
    client = APIClient()
    client.force_authenticate(cost_controller_user)

    response = client.patch(
        f"/api/v1/supplier-item-prices/{supplier_price.pk}/",
        {"unit_price": "6500.00"},
        format="json",
    )

    assert response.status_code == 200, response.data
    supplier_price.refresh_from_db()
    assert supplier_price.unit_price == Decimal("6500.00")


@pytest.mark.django_db
def test_only_cost_controller_can_create_supplier_catalogue_price():
    _employee, department, supplier, item = create_procurement_context()
    cost_controller_group, _ = Group.objects.get_or_create(name="Cost Controller")
    cost_controller_group.permissions.add(*Permission.objects.filter(
        content_type__app_label="inventory",
        codename__in=("view_supplieritemprice", "add_supplieritemprice"),
    ))
    cost_controller_user = get_user_model().objects.create_user(
        username="supplier-price-create-cost-controller",
        employee_code="PRICE-CREATE-CC",
        password="test-pass-123",
    )
    cost_controller_user.groups.add(cost_controller_group)
    Employee.objects.create(
        user=cost_controller_user,
        department=department,
        designation="Cost Controller",
    )
    client = APIClient()
    client.force_authenticate(cost_controller_user)

    response = client.post(
        "/api/v1/supplier-item-prices/",
        {
            "supplier": str(supplier.pk),
            "item": str(item.pk),
            "unit": str(item.base_unit_id),
            "supplier_sku": "SUP-BOOK",
            "unit_price": "2500.00",
            "currency": "UGX",
            "effective_from": "2026-11-03",
            "minimum_order_quantity": "1.00",
            "lead_time_days": 2,
            "quotation_reference": "QUOTE-12",
            "quotation_valid_until": "2026-12-03",
            "is_active": True,
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert SupplierItemPrice.objects.filter(
        supplier=supplier,
        item=item,
        unit_price=Decimal("2500.00"),
        quotation_reference="QUOTE-12",
    ).exists()


@pytest.mark.django_db
def test_receiving_clerk_workspace_keeps_grn_after_lpo_is_fully_received():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Completed GRN History Branch")
    open_receiving_period(branch)
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
    receipt_id = generated.data["id"]
    order.refresh_from_db()
    assert order.status == POStatus.RECEIVED

    posted = client.post(
        f"/api/v1/grns/{receipt_id}/post-to-inventory/",
        {},
        format="json",
    )

    assert posted.status_code == 403, posted.data
    order.refresh_from_db()
    assert order.status == POStatus.RECEIVED

    workspace = client.get("/api/v1/requisitions/workspace/?stage=receipt")

    assert workspace.status_code == 200, workspace.data
    assert workspace.data["orders"] == []
    assert [row["id"] for row in workspace.data["receipts"]] == [receipt_id]
    assert workspace.data["receipts"][0]["branch_id"] == str(branch.pk)
    assert workspace.data["receipts"][0]["branch_name"] == branch.name
    assert workspace.data["receipts"][0]["supplier_name"] == supplier.name
    assert workspace.data["receipts"][0]["received_by_name"] == employee.user.username
    assert workspace.data["receiptItems"][0]["item_name"] == item.name
    assert workspace.data["receiptItems"][0]["item_sku"] == item.sku
    assert workspace.data["receiptItems"][0]["unit_name"] == item.base_unit.name
    # The initial blind count is locked; only then may ordered quantities
    # appear in the read-only reconciliation/history view.
    assert workspace.data["receiptItems"][0]["ordered_quantity"] == "2.0000"
    assert workspace.data["receiptItems"][0]["accepted_quantity"] == "2.0000"
    assert workspace.data["receiptItems"][0]["rejected_quantity"] == "0.0000"


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
    # Authorized Purchasing operators must belong to a property; an unassigned
    # employee must no longer see the global requisition queue.
    employee.branch = Branch.objects.create(name="supplier_pack_quote_keeps_lpo_quanti")
    employee.save(update_fields=["branch"])

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
    invalid_quantity = client.post(
        f"/api/v1/requisitions/{requisition.pk}/allocate-line/",
        {
            "line_id": str(requisition.items.get().pk),
            "supplier_price": str(quote.pk),
            "quantity": "not-a-number",
        },
        format="json",
    )
    rejected_price_change = client.post(
        f"/api/v1/requisitions/{requisition.pk}/allocate-line/",
        {
            "line_id": str(requisition.items.get().pk),
            "supplier_price": str(quote.pk),
            "quantity": "1.00",
            "unit_price": "99000.00",
        },
        format="json",
    )
    allocation = client.post(
        f"/api/v1/requisitions/{requisition.pk}/allocate-line/",
        {
            "line_id": str(requisition.items.get().pk),
            "supplier_price": str(quote.pk),
            "quantity": "1.00",
        },
        format="json",
    )
    assert invalid_quantity.status_code == 400, invalid_quantity.data
    assert "quantity" in invalid_quantity.data
    assert rejected_price_change.status_code == 403
    assert allocation.status_code == 200, allocation.data
    quote.refresh_from_db()
    assert quote.unit_price == Decimal("97500.00")
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


@pytest.mark.django_db
def test_receiving_rejections_post_only_accepted_quantity_to_inventory():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Blind Receiving Inspection")
    open_receiving_period(branch)
    store = StoreLocation.objects.create(branch=branch, name="Blind Receiving Store")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    receiving, _ = Group.objects.get_or_create(name="Receiving Clerk")
    receiving.permissions.add(Permission.objects.get(codename="view_goodsreceiptnote"))
    employee.user.groups.add(receiving)

    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        reason="Blind receiving rejection test", status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition, item=item, quantity=Decimal("2.00"),
        approved_quantity=Decimal("2.00"), destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier, ordered_by=employee, store=store,
    )
    line = PurchaseOrderItem.objects.create(
        purchase_order=order, item=item, unit=item.base_unit,
        quantity=Decimal("2.00"), unit_cost=Decimal("5000.00"),
    )
    authorize_order_for_test(order)
    order.issue(sent_by=employee, sent_to_email=supplier.email)

    client = APIClient()
    client.force_authenticate(employee.user)
    response = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "supplier_invoice_no": "INV-BLIND-INSPECT",
            "short_delivery_reason": "One unit rejected on quality inspection.",
            "lines": [{
                "purchase_order_item": str(line.pk),
                "quantity_received": "2.00",
                "quantity_rejected": "1.00",
                "rejection_reason": "Broken packaging",
            }],
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    from apps.procurement.models import GoodsReceiptNote
    receipt = GoodsReceiptNote.objects.get(pk=response.data["id"])
    inspection_line = receipt.inspection.items.get(goods_receipt_item__purchase_order_item=line)
    assert inspection_line.quantity_received == Decimal("2.00")
    assert inspection_line.quantity_rejected == Decimal("1.00")
    assert inspection_line.quantity_accepted == Decimal("1.00")
    assert receipt.status == GoodsReceiptStatus.POSTED
    assert receipt.items.filter(inventory_changes_applied=True).count() == 1
    balance = InventoryBalance.objects.get(item=item, store=store)
    assert balance.quantity_in_stock == Decimal("1.0000")
    assert StockLedger.objects.filter(
        reference_id=receipt.pk, quantity_in=Decimal("1.0000"),
    ).count() == 1
    assert not StockLedger.objects.filter(
        reference_id=receipt.pk, quantity_in=Decimal("2.0000"),
    ).exists()


@pytest.mark.django_db
def test_fully_rejected_delivery_retains_grn_without_creating_stock_or_consuming_lpo():
    """A quality rejection cannot increase SOH or prevent later replacement."""
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Full Rejection Test Property")
    open_receiving_period(branch)
    store = StoreLocation.objects.create(branch=branch, name="Rejection Source Store")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    receiving, _ = Group.objects.get_or_create(name="Receiving Clerk")
    receiving.permissions.add(Permission.objects.get(codename="view_goodsreceiptnote"))
    employee.user.groups.add(receiving)
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        reason="Rejected batch to be replaced", status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition, item=item,
        quantity=Decimal("2.0000"), approved_quantity=Decimal("2.0000"),
        destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier,
        ordered_by=employee, store=store,
    )
    line = PurchaseOrderItem.objects.create(
        purchase_order=order, item=item, unit=item.base_unit,
        quantity=Decimal("2.0000"), unit_cost=Decimal("5000.00"),
    )
    authorize_order_for_test(order)
    order.issue(sent_by=employee, sent_to_email=supplier.email)
    client = APIClient()
    client.force_authenticate(employee.user)
    response = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "delivery_note_no": "DN-FULLY-REJECTED-001",
            "lines": [{
                "purchase_order_item": str(line.pk),
                "quantity_received": "2.0000",
                "quantity_rejected": "2.0000",
                "rejection_reason": "Entire batch damaged in transit",
            }],
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    receipt = GoodsReceiptNote.objects.get(pk=response.data["id"])
    assert receipt.status == GoodsReceiptStatus.POSTED
    assert receipt.blind_count_locked_at is not None
    assert receipt.inspection.status == "rejected"
    assert receipt.inspection.items.get().quantity_accepted == Decimal("0")
    assert receipt.items.get().inventory_changes_applied is True
    assert not InventoryBalance.objects.filter(item=item, store=store).exists()
    assert not StockLedger.objects.filter(reference_id=receipt.pk).exists()
    from apps.inventory.models import InventoryBatch
    assert not InventoryBatch.objects.filter(item=item, store=store).exists()
    order.refresh_from_db()
    assert order.status == POStatus.ISSUED
    assert line.receipt_items.get(goods_receipt=receipt).committed_purchase_quantity == Decimal("0")
    # A replacement physical delivery with a distinct reference remains valid.
    replacement = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "delivery_note_no": "DN-REPLACEMENT-002",
            "lines": [{
                "purchase_order_item": str(line.pk),
                "quantity_received": "2.0000",
                "quantity_rejected": "0",
            }],
        },
        format="json",
    )
    assert replacement.status_code == 201, replacement.data
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("2.0000")
    assert StockLedger.objects.filter(
        reference_id=replacement.data["id"], quantity_in=Decimal("2.0000"),
    ).count() == 1
    assert not StockLedger.objects.filter(reference_id=receipt.pk).exists()


@pytest.mark.django_db
def test_blind_receiving_reveals_lpo_quantities_only_after_locked_grn_and_preserves_original_count():
    """Stage 1 stays blind; Stage 2 is read-only and has independent audit notes."""
    from apps.accounts.role_templates import sync_client_roles
    from apps.audit_logs.models import AuditLog

    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Blind Count Audit Property")
    open_receiving_period(branch)
    store = StoreLocation.objects.create(branch=branch, name="Blind Count Main Store")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    sync_client_roles()
    employee.user.groups.add(Group.objects.get(name="Receiving Clerk"))
    second_item = Item.objects.create(
        name="Blind count flour", sku="BLIND-FLOUR",
        category=item.category, base_unit=item.base_unit, unit="litre",
        reorder_level=Decimal("0"),
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        status=PRStatus.APPROVED, reason="Blind reconciliation audit",
    )
    req_oil = RequisitionItem.objects.create(
        requisition=requisition, item=item, quantity=Decimal("5"),
        approved_quantity=Decimal("5"), destination_store=store,
    )
    req_flour = RequisitionItem.objects.create(
        requisition=requisition, item=second_item, quantity=Decimal("3"),
        approved_quantity=Decimal("3"), destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier, ordered_by=employee, store=store,
    )
    oil = PurchaseOrderItem.objects.create(
        purchase_order=order, requisition_item=req_oil,
        item=item, unit=item.base_unit, quantity=Decimal("5"),
        unit_cost=Decimal("1000"),
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order, requisition_item=req_flour,
        item=second_item, unit=item.base_unit, quantity=Decimal("3"),
        unit_cost=Decimal("2000"),
    )
    authorize_order_for_test(order)
    order.issue(sent_by=employee, sent_to_email=supplier.email)
    client = APIClient()
    client.force_authenticate(employee.user)
    blind = client.get("/api/v1/purchase-order-items/")
    assert blind.status_code == 200, blind.data
    for line in blind.data.get("results", blind.data) if isinstance(blind.data, dict) else blind.data:
        assert "approved_quantity" not in line
        assert "unit_cost" not in line

    # No commercial LPO PDF can disclose amounts before the independent count.
    assert client.get(
        f"/api/v1/purchase-orders/{order.pk}/preview-document/"
    ).status_code == 403
    draft = GoodsReceiptNote.objects.create(
        purchase_order=order, received_by=employee, supplier_invoice_no="BLIND-DRAFT",
    )
    hidden = client.get(f"/api/v1/grns/{draft.pk}/blind-reconciliation/")
    assert hidden.status_code == 400

    submitted = client.post(
        f"/api/v1/purchase-orders/{order.pk}/receive-delivery/",
        {
            "supplier_invoice_no": "BLIND-001",
            "delivery_note_no": "BLIND-DN-001",
            "lines": [{
                "purchase_order_item": str(oil.pk),
                "quantity_received": "4.0000",
                "quantity_rejected": "1.0000",
                "rejection_reason": "Broken container during loading",
            }],
        },
        format="json",
    )
    assert submitted.status_code == 201, submitted.data
    receipt = GoodsReceiptNote.objects.get(pk=submitted.data["id"])
    original = receipt.items.get()
    assert receipt.blind_count_locked_at is not None
    assert receipt.note == ""
    assert original.quantity_received == Decimal("4.0000")
    # Four counted minus one rejected = three actually accepted into SOH.
    assert InventoryBalance.objects.get(store=store, item=item).quantity_in_stock == Decimal("3.0000")
    assert StockLedger.objects.filter(reference_id=receipt.pk, quantity_in=Decimal("3.0000")).count() == 1

    revealed = client.get(f"/api/v1/grns/{receipt.pk}/blind-reconciliation/")
    assert revealed.status_code == 200, revealed.data
    assert revealed.data["blind_count_locked"] is True
    assert revealed.data["variance_note_required"] is True
    assert "unit_cost" not in str(revealed.data)
    assert "unit_price" not in str(revealed.data)
    assert "total_amount" not in str(revealed.data)
    line_by_sku = {line["sku"]: line for line in revealed.data["lines"]}
    assert line_by_sku[item.sku]["ordered_quantity"] == "5.0000"
    assert line_by_sku[item.sku]["counted_quantity"] == "4.0000"
    assert line_by_sku[item.sku]["accepted_quantity"] == "3.0000"
    assert line_by_sku[item.sku]["rejected_quantity"] == "1.0000"
    assert line_by_sku[item.sku]["short_quantity"] == "1.0000"
    assert line_by_sku[second_item.sku]["ordered_quantity"] == "3.0000"
    assert line_by_sku[second_item.sku]["counted_quantity"] == "0.0000"
    assert line_by_sku[second_item.sku]["short_quantity"] == "3.0000"

    assert client.patch(
        f"/api/v1/grns/{receipt.pk}/", {"note": "silently adjust"}, format="json"
    ).status_code in (400, 403)
    assert client.patch(
        f"/api/v1/grn-items/{original.pk}/", {"quantity_received": "5.0000"}, format="json"
    ).status_code in (400, 403)
    assert client.delete(f"/api/v1/grn-items/{original.pk}/").status_code in (400, 403)
    assert client.post(f"/api/v1/grns/{receipt.pk}/cancel/").status_code in (400, 403)
    original.quantity_received = Decimal("5.0000")
    with pytest.raises(ValidationError, match="Blind count"):
        original.save()
    original.refresh_from_db()
    assert original.quantity_received == Decimal("4.0000")

    note = client.post(
        f"/api/v1/grns/{receipt.pk}/variance-note/",
        {"note": "Four units supplied; one damaged, flour not delivered."}, format="json",
    )
    assert note.status_code == 200, note.data
    assert note.data["variance_note_required"] is False
    assert note.data["lines"] == revealed.data["lines"]
    assert AuditLog.objects.filter(
        entity_id=str(receipt.pk), action="blind_receiving_variance_explained"
    ).exists()
    assert client.post(
        f"/api/v1/grns/{receipt.pk}/variance-note/",
        {"note": "rewrite the note"}, format="json",
    ).status_code == 400

    other_user = get_user_model().objects.create_user(
        username="blind-other-clerk", employee_code="BLIND-OTHER",
        password="test-only",
    )
    Employee.objects.create(user=other_user, department=department, branch=branch)
    other_user.groups.add(Group.objects.get(name="Receiving Clerk"))
    client.force_authenticate(other_user)
    assert client.get(f"/api/v1/grns/{receipt.pk}/blind-reconciliation/").status_code == 404
    assert client.post(
        f"/api/v1/grns/{receipt.pk}/variance-note/",
        {"note": "not mine"}, format="json",
    ).status_code == 404


@pytest.mark.django_db
def test_procurement_review_and_allocate_saves_full_requisition_atomically():
    """One action replaces per-line quantity/save and supplier/save clicks."""
    employee, department, supplier, first_item = create_procurement_context()
    buyer = employee.user
    branch = Branch.objects.create(name="Quick allocation property")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    buyer.groups.add(Group.objects.get_or_create(name="Procurement Manager")[0])
    client = APIClient()
    client.force_authenticate(buyer)
    another_item = Item.objects.create(
        category=first_item.category, name="Bulk review paper", sku="BULK-PAPER-01",
        unit="each", base_unit=first_item.base_unit,
        reorder_level=Decimal("1.00"),
    )
    first_quote = SupplierItemPrice.objects.create(
        supplier=supplier, item=first_item, unit=first_item.base_unit,
        unit_price=Decimal("3500.00"), lead_time_days=2,
    )
    second_quote = SupplierItemPrice.objects.create(
        supplier=supplier, item=another_item, unit=another_item.base_unit,
        unit_price=Decimal("4000.00"), lead_time_days=2,
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        reason="One-click processing of two approved articles",
        status=PRStatus.APPROVED,
    )
    first = RequisitionItem.objects.create(
        requisition=requisition, item=first_item,
        quantity=Decimal("9.0000"), approved_quantity=Decimal("9.0000"),
    )
    second = RequisitionItem.objects.create(
        requisition=requisition, item=another_item,
        quantity=Decimal("5.0000"), approved_quantity=Decimal("5.0000"),
    )
    endpoint = f"/api/v1/requisitions/{requisition.pk}/review-and-allocate/"
    lines = [
        {"line_id": str(first.pk), "approved_quantity": "8.0000",
         "quantity": "8.0000", "supplier_price": str(first_quote.pk),
         "reason": "One unit held back"},
        {"line_id": str(second.pk), "approved_quantity": "5.0000",
         "quantity": "5.0000", "supplier_price": str(second_quote.pk)},
    ]
    # If any article fails, the entire review must roll back.
    failed = client.post(endpoint, {"lines": [lines[0], {
        **lines[1], "supplier_price": str(first_quote.pk),
    }]}, format="json")
    assert failed.status_code == 400, failed.data
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.approved_quantity == Decimal("9.0000")
    assert not first.procurement_supplier_price_id
    assert not second.procurement_supplier_price_id

    saved = client.post(endpoint, {"lines": lines}, format="json")
    assert saved.status_code == 200, saved.data
    assert saved.data["ready_for_lpo"] is True
    assert saved.data["allocated_lines"] == 2
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.approved_quantity == Decimal("8.0000")
    assert first.procurement_quantity == Decimal("8.0000")
    assert second.procurement_quantity == Decimal("5.0000")
    assert first.procurement_supplier_price_id == first_quote.pk
    assert second.procurement_supplier_price_id == second_quote.pk
    from apps.procurement.models import RequisitionHistory
    assert RequisitionHistory.objects.filter(
        requisition=requisition, action="procurement_bulk_allocation",
    ).exists()

    # Server validation still blocks increasing the approved quantity.
    increased = client.post(endpoint, {"lines": [
        {**lines[0], "approved_quantity": "9.0000"},
        lines[1],
    ]}, format="json")
    assert increased.status_code == 400, increased.data
    first.refresh_from_db()
    assert first.approved_quantity == Decimal("8.0000")


@pytest.mark.django_db
def test_procurement_level_one_requires_another_manager_when_available():
    """Prevent self-approval when the branch has another active Procurement Manager."""
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Independent LPO Review")
    employee.branch = branch
    employee.is_active = True
    employee.save(update_fields=("branch", "is_active", "updated_at"))
    role, _ = Group.objects.get_or_create(name="Procurement Manager")
    employee.user.groups.add(role)
    reviewer = get_user_model().objects.create_user(
        username="independent-purchasing-reviewer",
        employee_code="EMP-INDEPENDENT-PM", password="test-pass-123",
    )
    reviewer.groups.add(role)
    Employee.objects.create(
        user=reviewer, department=department, branch=branch,
        designation="Procurement Manager", is_active=True,
    )
    for role_name, suffix in (("Financial Manager", "FIN"), ("General Manager", "GM")):
        user = get_user_model().objects.create_user(
            username=f"independent-{suffix.lower()}",
            employee_code=f"EMP-INDEPENDENT-{suffix}",
            password="test-pass-123",
        )
        user.groups.add(Group.objects.get_or_create(name=role_name)[0])
        Employee.objects.create(
            user=user, department=department, branch=branch,
            designation=role_name, is_active=True,
        )
    store = StoreLocation.objects.create(branch=branch, name="Independent LPO Store")
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        reason="Independent purchase approval", status=PRStatus.APPROVED,
    )
    line = RequisitionItem.objects.create(
        requisition=requisition, item=item, quantity=Decimal("2.0000"),
        approved_quantity=Decimal("2.0000"), destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier,
        ordered_by=employee, store=store,
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order, requisition_item=line, item=item,
        quantity=Decimal("2.0000"), unit_cost=Decimal("1000.00"),
        destination_store=store,
    )
    order.submit_for_approval()
    first_step = order.approval_workflow.order_by("stage").first()
    assert first_step.stage_name == "Procurement Manager Approval"
    assert first_step.stage == 1
    assert order.ordered_by_id == employee.pk
    assert first_step.approver_role_id == role.pk
    assert Notification.objects.filter(
        employee__user=reviewer,
        title__contains="requires Procurement Manager approval",
    ).exists()
    assert not Notification.objects.filter(
        employee=employee,
        title__contains="requires Procurement Manager approval",
    ).exists()
    assert Employee.objects.filter(
        is_active=True, user__is_active=True,
        user__groups=role, branch=branch,
    ).exclude(pk=employee.pk).exists(), "Independent reviewer must be eligible"

    creator = APIClient()
    creator.force_authenticate(employee.user)
    peer = APIClient()
    peer.force_authenticate(reviewer)
    blocked = creator.post(
        f"/api/v1/purchase-orders/{order.pk}/approve/",
        {"comments": "Attempted self approval"}, format="json",
    )
    assert blocked.status_code == 403, blocked.data
    approved = peer.post(
        f"/api/v1/purchase-orders/{order.pk}/approve/",
        {"comments": "Independent review completed"}, format="json",
    )
    assert approved.status_code == 200, approved.data
    order.refresh_from_db()
    assert order.status == POStatus.PENDING_APPROVAL


@pytest.mark.django_db
def test_printed_approved_lpo_without_supplier_email_reaches_receiving_queue():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Offline Supplier Receiving Branch")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    supplier.email = ""
    supplier.save(update_fields=("email", "updated_at"))
    purchasing, _ = Group.objects.get_or_create(name="Procurement Manager")
    purchasing.permissions.add(Permission.objects.get(codename="change_purchaseorder"))
    employee.user.groups.add(purchasing)
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        reason="Physical supplier purchase", status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition, item=item,
        quantity=Decimal("2.0000"), approved_quantity=Decimal("2.0000"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier, ordered_by=employee,
    )
    PurchaseOrderItem.objects.create(
        purchase_order=order, item=item, quantity=Decimal("2.0000"),
        unit_cost=Decimal("30000.00"),
    )
    authorize_order_for_test(order)
    client = APIClient()
    client.force_authenticate(employee.user)
    release_url = f"/api/v1/purchase-orders/{order.pk}/release-for-receiving/"
    # Cannot release an unapproved LPO or bypass the controlled download.
    assert client.post(release_url, {}, format="json").status_code == 400
    order.record_print(printed_by=employee.user)
    assert order.manual_release_readiness()["can_proceed"]
    released = client.post(release_url, {}, format="json")
    assert released.status_code == 200, released.data
    order.refresh_from_db()
    assert order.status == POStatus.ISSUED
    assert order.sent_to_email == ""
    assert order.email_status == "not_sent"
    assert order.sent_by_id == employee.pk
    assert client.post(release_url, {}, format="json").status_code == 400
    # The receiving clerk sees the released LPO through their existing blind queue.
    clerk_user = get_user_model().objects.create_user(
        username="offline-lpo-receiver", employee_code="OFFLINE-LPO-REC",
        password="test-pass-123",
    )
    clerk_employee = Employee.objects.create(
        user=clerk_user, department=department, branch=branch, designation="Receiving Clerk",
    )
    receiving, _ = Group.objects.get_or_create(name="Receiving Clerk")
    clerk_user.groups.add(receiving)
    client.force_authenticate(clerk_user)
    response = client.get("/api/v1/requisitions/workspace/?stage=receipt")
    assert response.status_code == 200, response.data
    assert str(order.pk) in [row["id"] for row in response.data["orders"]]
    visible = next(row for row in response.data["orders"] if row["id"] == str(order.pk))
    assert "total_amount" not in visible
    assert "unit_cost" not in response.data["orderItems"][0]


@pytest.mark.django_db
def test_article_vat_selection_is_snapshotted_on_new_lpo_lines_and_not_applied_to_nonvat():
    employee, department, supplier, taxable = create_procurement_context()
    taxable.vat_applicable = True
    taxable.save(update_fields=["vat_applicable", "updated_at"])
    untaxed = Item.objects.create(
        category=taxable.category, name="Non-VAT Article Test", sku="VAT-FREE-ARTICLE",
        unit=taxable.unit, base_unit=taxable.base_unit, reorder_level=Decimal("0.0000"),
        vat_applicable=False,
    )
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, reason="Mixed VAT LPO",
        status=PRStatus.APPROVED,
    )
    for item in (taxable, untaxed):
        RequisitionItem.objects.create(
            requisition=requisition, item=item, quantity=Decimal("2.0000"),
            approved_quantity=Decimal("2.0000"),
        )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier, ordered_by=employee,
    )
    taxed = PurchaseOrderItem.objects.create(
        purchase_order=order, item=taxable, quantity=Decimal("2.0000"),
        unit_cost=Decimal("100000.00"),
    )
    no_vat = PurchaseOrderItem.objects.create(
        purchase_order=order, item=untaxed, quantity=Decimal("2.0000"),
        unit_cost=Decimal("50000.00"),
    )
    assert taxed.vat_rate_snapshot == Decimal("0.1800")
    assert no_vat.vat_rate_snapshot == Decimal("0.0000")
    assert taxed.vat_amount == Decimal("36000.00")
    assert no_vat.vat_amount == Decimal("0.00")
    order.refresh_from_db()
    assert order.total_amount == Decimal("300000.00")
    assert order.vat_total == Decimal("36000.00")
    assert order.gross_total == Decimal("336000.00")
    taxable.vat_applicable = False
    taxable.save(update_fields=["vat_applicable", "updated_at"])
    assert taxed.vat_amount == Decimal("36000.00")
    order.status = POStatus.APPROVED
    order.save(update_fields=["status", "updated_at"])
    pdf_data = build_purchase_order_pdf(order, classification="ORIGINAL COPY")
    assert pdf_data.startswith(b"%PDF")


@pytest.mark.django_db
def test_no_vat_article_creates_zero_vat_lpo_and_tax_preference_serializes():
    employee, department, supplier, item = create_procurement_context()
    from apps.inventory.serializers import ItemSerializer
    assert ItemSerializer(item).data["vat_applicable"] is False
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, reason="No VAT LPO",
        status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition, item=item, quantity=Decimal("10.0000"),
        approved_quantity=Decimal("10.0000"),
    )
    order = PurchaseOrder.objects.create(requisition=requisition, supplier=supplier, ordered_by=employee)
    line = PurchaseOrderItem.objects.create(
        purchase_order=order, item=item, quantity=Decimal("10.0000"),
        unit_cost=Decimal("30000.00"),
    )
    assert line.vat_rate_snapshot == Decimal("0.0000")
    assert order.vat_total == Decimal("0.00")
    assert order.gross_total == Decimal("300000.00")
    assert PurchaseOrderSerializer(order).data["vat_total"] == "0.00"


@pytest.mark.django_db
def test_multiple_partial_grns_can_share_invoice_with_distinct_delivery_notes():
    """One invoice can accompany several separate Matooke-style deliveries."""
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Partial Invoice Reuse Branch")
    open_receiving_period(branch)
    store = StoreLocation.objects.create(branch=branch, name="Kitchen Receiving Store")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    receiving, _ = Group.objects.get_or_create(name="Receiving Clerk")
    employee.user.groups.add(receiving)
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department, branch=branch,
        reason="Split supplier deliveries", status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition, item=item,
        quantity=Decimal("3.0000"), approved_quantity=Decimal("3.0000"),
        destination_store=store,
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier,
        ordered_by=employee, store=store, po_number="GRN-SPLIT-001",
    )
    line = PurchaseOrderItem.objects.create(
        purchase_order=order, item=item, unit=item.base_unit,
        quantity=Decimal("3.0000"), unit_cost=Decimal("30000.00"),
    )
    authorize_order_for_test(order)
    order.issue(sent_by=employee, sent_to_email=supplier.email)
    client = APIClient()
    client.force_authenticate(employee.user)
    endpoint = f"/api/v1/purchase-orders/{order.pk}/receive-delivery/"
    def physical_receipt(invoice="", delivery="", quantity="1.0000"):
        return client.post(endpoint, {
            "supplier_invoice_no": invoice,
            "delivery_note_no": delivery,
            "lines": [{
                "purchase_order_item": str(line.pk),
                "quantity_received": quantity,
            }],
        }, format="json")
    assert physical_receipt().status_code == 400
    first = physical_receipt(invoice="INV-SPLIT-001", delivery="DN-SPLIT-001")
    assert first.status_code == 201, first.data
    order.refresh_from_db()
    assert order.status == POStatus.PARTIALLY_RECEIVED
    assert physical_receipt(invoice="INV-SPLIT-001").status_code == 400
    assert physical_receipt(invoice="INV-SPLIT-001", delivery="DN-SPLIT-001").status_code == 400
    second = physical_receipt(invoice="INV-SPLIT-001", delivery="DN-SPLIT-002")
    assert second.status_code == 201, second.data
    assert first.data["id"] != second.data["id"]
    # A third physical delivery must not exceed the approved LPO balance.
    assert physical_receipt(invoice="INV-SPLIT-001", delivery="DN-SPLIT-003", quantity="2.0000").status_code == 400
    third = physical_receipt(delivery="DN-SPLIT-003")
    assert third.status_code == 201, third.data
    order.refresh_from_db()
    assert order.status == POStatus.RECEIVED
    receipts = list(GoodsReceiptNote.objects.filter(purchase_order=order))
    assert len(receipts) == 3
    assert len({receipt.grn_number for receipt in receipts}) == 3
    assert all(receipt.blind_count_locked_at for receipt in receipts)
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("3.0000")
    assert StockLedger.objects.filter(reference_type=LedgerReferenceType.GRN_RECEIPT, store=store, item=item).count() == 3
    # A fully received LPO is intentionally hidden from Receiving Clerk scope.
    assert physical_receipt(invoice="INV-NEW", delivery="DN-NEW").status_code == 404


@pytest.mark.django_db
def test_same_invoice_across_lpos_requires_distinct_delivery_evidence():
    employee, department, supplier, item = create_procurement_context()
    branch = Branch.objects.create(name="Repeat Article Branch")
    employee.branch = branch
    employee.save(update_fields=("branch", "updated_at"))
    for index in ("A", "B"):
        requisition = PurchaseRequisition.objects.create(
            requester=employee, department=department, branch=branch,
            reason="Repeat article delivery " + index, status=PRStatus.APPROVED,
        )
        RequisitionItem.objects.create(
            requisition=requisition, item=item,
            quantity=Decimal("2.0000"), approved_quantity=Decimal("2.0000"),
        )
        order = PurchaseOrder.objects.create(
            requisition=requisition, supplier=supplier,
            ordered_by=employee, po_number="REPEAT-ARTICLE-" + index,
        )
        PurchaseOrderItem.objects.create(
            purchase_order=order, item=item,
            quantity=Decimal("2.0000"), unit_cost=Decimal("30000.00"),
        )
        authorize_order_for_test(order)
        order.issue(sent_by=employee, sent_to_email=supplier.email)
    orders = list(PurchaseOrder.objects.filter(po_number__startswith="REPEAT-ARTICLE-").order_by("po_number"))
    from apps.procurement.models import GoodsReceiptNote
    GoodsReceiptNote.objects.create(
        purchase_order=orders[0], received_by=employee, supplier_invoice_no="INV-REPEAT",
        delivery_note_no="DELIVERY-A",
    )
    unproven = GoodsReceiptNote(
        purchase_order=orders[1], received_by=employee, supplier_invoice_no="INV-REPEAT",
    )
    with pytest.raises(ValidationError):
        unproven.full_clean()
    separate = GoodsReceiptNote(
        purchase_order=orders[1], received_by=employee, supplier_invoice_no="INV-REPEAT",
        delivery_note_no="DELIVERY-B",
    )
    separate.full_clean()
