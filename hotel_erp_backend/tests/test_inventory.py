from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.inventory.models import (
    Category,
    InventoryBalance,
    Item,
    ItemUnitPrice,
    ReorderRule,
    StockCount,
    StockCountItem,
    StockAdjustment,
    StockAdjustmentItem,
    StockIssue,
    StockIssueItem,
    StockLedger,
    StockTransfer,
    StockTransferItem,
    StoreKeeperAssignment,
    StoreLocation,
    StoreRequisition,
    StoreRequisitionItem,
    StoreReturn,
    StoreReturnItem,
    SupplierItemPrice,
    UnitOfMeasure,
)
from apps.procurement.models import PurchaseRequisition
from apps.vendors.models import Supplier
from core.constants.choices import PRStatus, RequisitionType, StockCountStatus, StoreRequisitionStatus
from apps.inventory.serializers import (
    CategorySerializer,
    ItemSerializer,
    ItemUnitPriceSerializer,
    StockTransferItemSerializer,
    StoreLocationSerializer,
    StoreRequisitionSerializer,
)


@pytest.mark.django_db
def test_item_base_unit_lock_is_exposed_and_preserves_operational_history():
    category = Category.objects.create(name="Lock-tested beverages")
    piece = UnitOfMeasure.objects.create(name="Lock-tested piece", abbreviation="pc")
    crate = UnitOfMeasure.objects.create(name="Lock-tested crate", abbreviation="crt")
    item = Item.objects.create(
        category=category,
        name="Lock-tested beer",
        sku="LOCK-BEER-001",
        unit="pc",
        base_unit=piece,
        reorder_level=Decimal("10.00"),
    )

    unlocked = ItemSerializer(item)
    assert unlocked.data["base_unit_locked"] is False

    change_before_usage = ItemSerializer(item, data={"base_unit": crate.pk}, partial=True)
    assert change_before_usage.is_valid(), change_before_usage.errors

    InventoryBalance.objects.create(
        item=item,
        store=StoreLocation.objects.create(
            branch=Branch.objects.create(name="Base unit lock branch"),
            name="Base unit lock store",
        ),
        quantity_in_stock=Decimal("0.00"),
    )

    locked = ItemSerializer(item)
    assert locked.data["base_unit_locked"] is True

    unchanged = ItemSerializer(
        item,
        data={"name": "Renamed lock-tested beer", "base_unit": piece.pk},
        partial=True,
    )
    assert unchanged.is_valid(), unchanged.errors

    changed = ItemSerializer(item, data={"base_unit": crate.pk}, partial=True)
    assert not changed.is_valid()
    assert "Article Unit Conversions" in str(changed.errors["base_unit"][0])


@pytest.mark.django_db
def test_category_hierarchy_reports_descendant_items_and_prevents_cycles():
    beverages = Category.objects.create(name="Beverages")
    soft_drinks = Category.objects.create(name="Soft Drinks", parent=beverages)
    Item.objects.create(
        category=soft_drinks,
        name="Cola",
        sku="COLA-001",
        unit="bottle",
        reorder_level=Decimal("10.00"),
    )

    rows = CategorySerializer([beverages, soft_drinks], many=True).data
    root_row, child_row = rows

    assert beverages.code == "BEV"
    assert root_row["group_type"] == "Major Group"
    assert root_row["hierarchy_level"] == 0
    assert root_row["hierarchy_path"] == "Beverages"
    assert root_row["children_count"] == 1
    assert root_row["item_count"] == 1
    assert child_row["parent_name"] == "Beverages"
    assert child_row["group_type"] == "Item Group"
    assert child_row["hierarchy_level"] == 1
    assert child_row["hierarchy_path"] == "Beverages › Soft Drinks"
    assert child_row["direct_item_count"] == 1
    assert child_row["item_count"] == 1

    nested_serializer = CategorySerializer(
        data={"name": "Cola", "parent": str(soft_drinks.id)},
    )
    assert not nested_serializer.is_valid()
    assert "Major Group → Item Group → Items" in str(
        nested_serializer.errors["parent"][0]
    )

    beverages.parent = soft_drinks
    with pytest.raises(ValidationError, match="own parent or descendant"):
        beverages.save()
    beverages.parent = None

    serializer = CategorySerializer(
        beverages,
        data={"parent": str(soft_drinks.id)},
        partial=True,
    )
    assert not serializer.is_valid()
    assert "parent" in serializer.errors


@pytest.mark.django_db
def test_item_import_creates_major_group_item_group_and_article_atomically():
    user = get_user_model().objects.create_superuser(
        username="item-import-admin",
        employee_code="ITEM-IMPORT-ADMIN",
        password="test-pass-123",
    )
    UnitOfMeasure.objects.create(name="Pieces", abbreviation="pcs")
    upload = SimpleUploadedFile(
        "items.csv",
        (
            "major_group,item_group,item_name,sku,base_unit,reorder_level,"
            "maximum_level,business_type,is_active\n"
            "Beverages,Soft Drinks,Cola,BEV-SD-001,pcs,100,1000,"
            "Resale / Revenue Item,yes\n"
        ).encode(),
        content_type="text/csv",
    )
    client = APIClient()
    client.force_authenticate(user)

    response = client.post("/api/v1/items/import/", {"file": upload}, format="multipart")

    assert response.status_code == 200
    assert response.data == {"created": 1, "updated": 0, "total": 1}
    major = Category.objects.get(name="Beverages")
    group = Category.objects.get(name="Soft Drinks")
    item = Item.objects.get(sku="BEV-SD-001")
    assert major.parent_id is None
    assert group.parent == major
    assert item.category == group
    assert item.maximum_level == Decimal("1000")


@pytest.mark.django_db
def test_store_location_serializer_keeps_one_active_default_per_branch():
    branch = Branch.objects.create(name="Store Configuration Branch")
    first = StoreLocation.objects.create(
        branch=branch,
        name="Original Default Store",
        is_default=True,
    )
    serializer = StoreLocationSerializer(
        data={
            "branch": str(branch.id),
            "name": "Replacement Default Store",
            "is_active": True,
            "is_default": True,
        }
    )

    assert serializer.is_valid(), serializer.errors
    replacement = serializer.save()
    first.refresh_from_db()

    assert replacement.is_default
    assert not first.is_default


@pytest.mark.django_db
def test_store_location_serializer_rejects_inactive_default():
    branch = Branch.objects.create(name="Inactive Store Configuration Branch")
    serializer = StoreLocationSerializer(
        data={
            "branch": str(branch.id),
            "name": "Inactive Default Store",
            "is_active": False,
            "is_default": True,
        }
    )

    assert not serializer.is_valid()
    assert "is_default" in serializer.errors


@pytest.mark.django_db
def test_supplier_item_price_links_supplier_to_item():
    category = Category.objects.create(name="Food")
    item = Item.objects.create(
        category=category,
        name="Rice",
        sku="RICE-001",
        unit="kg",
        reorder_level=Decimal("20.00"),
    )
    supplier = Supplier.objects.create(
        name="Food Supplier",
        email="food@example.com",
        phone="+256700000002",
        address="Kampala",
        tin_number="TIN-002",
        registration_number="REG-002",
    )

    price = SupplierItemPrice.objects.create(
        supplier=supplier,
        item=item,
        unit_price=Decimal("5500.00"),
    )

    assert price.supplier == supplier
    assert price.item == item


@pytest.mark.django_db
def test_stock_ledger_requires_single_direction_movement():
    category = Category.objects.create(name="Beverages")
    item = Item.objects.create(
        category=category,
        name="Water",
        sku="WATER-001",
        unit="carton",
        reorder_level=Decimal("10.00"),
    )
    ledger = StockLedger(
        item=item,
        quantity_in=Decimal("5.00"),
        quantity_out=Decimal("2.00"),
        reference_type="stock_adjustment",
        reference_id=uuid4(),
    )

    with pytest.raises(ValidationError):
        ledger.full_clean()


@pytest.mark.django_db
def test_stock_transfer_posts_store_balances_and_ledger_entries():
    branch = Branch.objects.create(name="Main Hotel")
    main_store = StoreLocation.objects.create(branch=branch, name="Main Store")
    kitchen_store = StoreLocation.objects.create(branch=branch, name="Kitchen Store")
    category = Category.objects.create(name="Dry Goods")
    base_unit = UnitOfMeasure.objects.create(name="Kilogram", abbreviation="kg")
    sack_unit = UnitOfMeasure.objects.create(name="Sack", abbreviation="sack")
    item = Item.objects.create(
        category=category,
        name="Sugar",
        unit="kg",
        base_unit=base_unit,
        reorder_level=Decimal("10.00"),
    )
    ItemUnitPrice.objects.create(
        item=item,
        unit=sack_unit,
        conversion_factor=Decimal("50.0000"),
        selling_price=Decimal("180000.00"),
    )
    InventoryBalance.objects.create(
        item=item,
        store=main_store,
        quantity_in_stock=Decimal("120.00"),
    )
    InventoryBalance.objects.create(
        item=item,
        store=kitchen_store,
        quantity_in_stock=Decimal("5.00"),
    )
    transfer = StockTransfer.objects.create(
        from_store=main_store,
        to_store=kitchen_store,
    )
    transfer_item = StockTransferItem.objects.create(
        stock_transfer=transfer,
        item=item,
        unit=sack_unit,
        quantity=Decimal("2.00"),
    )

    transfer.apply_inventory_changes()

    transfer_item.refresh_from_db()
    assert transfer_item.base_quantity == Decimal("100.0000")
    assert InventoryBalance.objects.get(item=item, store=main_store).quantity_in_stock == Decimal("20.00")
    assert InventoryBalance.objects.get(item=item, store=kitchen_store).quantity_in_stock == Decimal("105.00")
    assert StockLedger.objects.filter(reference_id=transfer.id).count() == 2


@pytest.mark.django_db
def test_article_unit_conversion_requires_explicit_ratio_and_locks_after_use():
    branch = Branch.objects.create(name="Conversion Control Branch")
    store = StoreLocation.objects.create(branch=branch, name="Conversion Store")
    category = Category.objects.create(name="Packaged Drinks")
    piece = UnitOfMeasure.objects.create(name="Piece", abbreviation="pc")
    carton = UnitOfMeasure.objects.create(name="Carton", abbreviation="ctn")
    pallet = UnitOfMeasure.objects.create(name="Pallet", abbreviation="plt")
    item = Item.objects.create(
        category=category,
        name="Bottled Water",
        unit="pc",
        base_unit=piece,
        reorder_level=Decimal("24.00"),
    )

    invalid = ItemUnitPriceSerializer(data={
        "item": str(item.id),
        "unit": str(carton.id),
        "role": "purchase",
        "conversion_factor": "1.0000",
        "selling_price": "0.00",
        "is_active": True,
    })
    assert not invalid.is_valid()
    assert "conversion_factor" in invalid.errors

    configured = ItemUnitPriceSerializer(data={
        "item": str(item.id),
        "unit": str(carton.id),
        "role": "purchase",
        "conversion_factor": "12.0000",
        "selling_price": "0.00",
        "is_active": True,
    })
    assert configured.is_valid(), configured.errors
    conversion = configured.save()
    assert configured.data["base_equivalent"] == "1 ctn = 12 pc"

    transfer = StockTransfer.objects.create(from_store=store, to_store=store)
    transfer_line = StockTransferItemSerializer(data={
        "stock_transfer": str(transfer.id),
        "item": str(item.id),
        "unit": str(carton.id),
        "quantity": "2.00",
    })
    assert transfer_line.is_valid(), transfer_line.errors
    line = transfer_line.save()
    assert line.base_quantity == Decimal("24.000000")

    unconfigured = StockTransferItemSerializer(data={
        "stock_transfer": str(transfer.id),
        "item": str(item.id),
        "unit": str(pallet.id),
        "quantity": "1.00",
    })
    assert not unconfigured.is_valid()
    assert "unit" in unconfigured.errors

    locked = ItemUnitPriceSerializer(
        conversion,
        data={"conversion_factor": "10.0000"},
        partial=True,
    )
    assert not locked.is_valid()
    assert "non_field_errors" in locked.errors


def create_inventory_operations_context():
    user = get_user_model().objects.create_user(
        username="store-keeper",
        employee_code="EMP-STORE",
        password="test-pass-123",
    )
    department = Department.objects.create(name="Kitchen")
    employee = Employee.objects.create(
        user=user,
        department=department,
        designation="Store Keeper",
    )
    branch = Branch.objects.create(name="Main Hotel")
    store = StoreLocation.objects.create(branch=branch, name="Main Store")
    category = Category.objects.create(name="Kitchen Consumables")
    item = Item.objects.create(
        category=category,
        name="Cooking Gas",
        sku="GAS-001",
        unit="kg",
        reorder_level=Decimal("10.00"),
    )
    InventoryBalance.objects.create(
        item=item,
        store=store,
        quantity_in_stock=Decimal("40.00"),
    )
    return department, employee, store, item


def approve_store_request_for_department(requisition):
    head_user = get_user_model().objects.create_user(
        username=f"department-head-{uuid4()}",
        employee_code=f"HOD-{str(uuid4())[:8]}",
        password="test-pass-123",
    )
    head_user.groups.add(Group.objects.get_or_create(name="Department Head")[0])
    head = Employee.objects.create(
        user=head_user,
        department=requisition.department,
        branch=requisition.store.branch,
        designation="Department Head",
    )
    requisition.submit(actor=requisition.requested_by.user)
    requisition.approve_department(head, comments="Department need confirmed.")
    return head


@pytest.mark.django_db
def test_department_user_store_request_uses_own_identity(client):
    branch = Branch.objects.create(name="Identity Test Hotel")
    own_department = Department.objects.create(name="Housekeeping Identity Test")
    other_department = Department.objects.create(name="Finance Identity Test")
    store = StoreLocation.objects.create(
        branch=branch, name="Identity Test Store", is_default=True
    )
    user = get_user_model().objects.create_user(
        username="department-requester", employee_code="EMP-REQUESTER", password="test-pass-123"
    )
    own_employee = Employee.objects.create(
        user=user, department=own_department, branch=branch, designation="Requester"
    )
    user.groups.add(Group.objects.get_or_create(name="Requester")[0])
    other_user = get_user_model().objects.create_user(
        username="other-requester", employee_code="EMP-OTHER", password="test-pass-123"
    )
    other_employee = Employee.objects.create(
        user=other_user, department=other_department, branch=branch, designation="Finance Officer"
    )
    client.force_login(user)

    response = client.post(
        "/api/v1/store-requisitions/",
        {
            "department": str(other_department.pk),
            "requested_by": str(other_employee.pk),
            "store": str(store.pk),
            "purpose": "Room supplies",
        },
        content_type="application/json",
    )

    assert response.status_code == 201
    requisition = StoreRequisition.objects.get(pk=response.json()["id"])
    assert requisition.department == own_department
    assert requisition.requested_by == own_employee
    assert requisition.store == store


@pytest.mark.django_db
def test_store_requisition_exposes_issuing_store_name_and_address():
    branch = Branch.objects.create(name="Store origin branch")
    department = Department.objects.create(name="Store origin department")
    store = StoreLocation.objects.create(
        branch=branch,
        name="Main Dry Store",
        address="Basement, Block B",
    )
    user = get_user_model().objects.create_user(
        username="store-origin-requester",
        employee_code="EMP-STORE-ORIGIN",
    )
    employee = Employee.objects.create(
        user=user,
        department=department,
        branch=branch,
        designation="Requester",
    )
    requisition = StoreRequisition.objects.create(
        department=department,
        store=store,
        requested_by=employee,
    )

    payload = StoreRequisitionSerializer(requisition).data

    assert str(payload["store"]) == str(store.pk)
    assert payload["store_name"] == "Main Dry Store"
    assert payload["store_address"] == "Basement, Block B"


@pytest.mark.django_db
def test_requester_store_options_and_selection_are_limited_to_own_branch():
    branch = Branch.objects.create(name="Requester store branch")
    other_branch = Branch.objects.create(name="Other store branch")
    department = Department.objects.create(name="Requester store department")
    own_store = StoreLocation.objects.create(
        branch=branch,
        name="Housekeeping Store",
        address="Level 1, East Wing",
    )
    StoreLocation.objects.create(
        branch=branch,
        name="Inactive Store",
        is_active=False,
    )
    other_store = StoreLocation.objects.create(
        branch=other_branch,
        name="Other Branch Store",
    )
    user = get_user_model().objects.create_user(
        username="branch-store-requester",
        employee_code="EMP-BRANCH-STORE",
    )
    employee = Employee.objects.create(
        user=user,
        department=department,
        branch=branch,
        designation="Requester",
    )
    user.groups.add(Group.objects.get_or_create(name="Requester")[0])
    requisition = StoreRequisition.objects.create(
        department=department,
        requested_by=employee,
    )
    api_client = APIClient()
    api_client.force_authenticate(user)

    options = api_client.get("/api/v1/store-requisitions/store-options/")

    assert options.status_code == 200
    assert [(row["name"], row["address"]) for row in options.data] == [
        ("Housekeeping Store", "Level 1, East Wing")
    ]

    denied = api_client.patch(
        f"/api/v1/store-requisitions/{requisition.pk}/",
        {"store": str(other_store.pk)},
        format="json",
    )
    assert denied.status_code == 400

    accepted = api_client.patch(
        f"/api/v1/store-requisitions/{requisition.pk}/",
        {"store": str(own_store.pk)},
        format="json",
    )
    assert accepted.status_code == 200
    requisition.refresh_from_db()
    assert requisition.store == own_store


@pytest.mark.django_db
def test_store_requisition_requires_issuing_store_before_submit():
    branch = Branch.objects.create(name="Required store branch")
    department = Department.objects.create(name="Required store department")
    category = Category.objects.create(name="Required store supplies")
    item = Item.objects.create(
        category=category,
        name="Required store item",
        unit="piece",
        reorder_level=Decimal("1"),
    )
    user = get_user_model().objects.create_user(
        username="required-store-requester",
        employee_code="EMP-REQUIRED-STORE",
    )
    employee = Employee.objects.create(
        user=user,
        department=department,
        branch=branch,
        designation="Requester",
    )
    requisition = StoreRequisition.objects.create(
        department=department,
        requested_by=employee,
    )
    StoreRequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity_requested=Decimal("1.00"),
    )

    with pytest.raises(ValidationError, match="Select the issuing store"):
        requisition.submit(actor=user)


@pytest.mark.django_db
def test_store_request_requires_department_head_before_store_keeper_review():
    branch = Branch.objects.create(name="Approval Flow Hotel")
    department = Department.objects.create(name="Approval Flow Housekeeping")
    store = StoreLocation.objects.create(branch=branch, name="Approval Flow Store")
    category = Category.objects.create(name="Approval Flow Supplies")
    item = Item.objects.create(
        category=category, name="Approval Soap", unit="L", reorder_level=Decimal("1")
    )
    employee_user = get_user_model().objects.create_user(
        username="requesting-employee", employee_code="EMP-FLOW-EMPLOYEE"
    )
    employee = Employee.objects.create(
        user=employee_user, department=department, branch=branch, designation="Requester"
    )
    employee_user.groups.add(Group.objects.get_or_create(name="Requester")[0])
    head_user = get_user_model().objects.create_user(
        username="requesting-head", employee_code="EMP-FLOW-HEAD"
    )
    head = Employee.objects.create(
        user=head_user, department=department, branch=branch, designation="Department Head"
    )
    head_user.groups.add(Group.objects.get_or_create(name="Department Head")[0])
    stores_user = get_user_model().objects.create_user(
        username="approval-flow-storekeeper", employee_code="EMP-FLOW-STORES"
    )
    stores_user.groups.add(Group.objects.get_or_create(name="Store Keeper")[0])
    stores = Employee.objects.create(
        user=stores_user, department=department, branch=branch, designation="Store Keeper"
    )
    StoreKeeperAssignment.objects.create(store=store, employee=stores)

    employee_request = StoreRequisition.objects.create(
        department=department, store=store, requested_by=employee
    )
    request_line = StoreRequisitionItem.objects.create(
        requisition=employee_request,
        item=item,
        quantity_requested=Decimal("2"),
        remarks="For the second-floor guest rooms.",
    )
    employee_request.submit(actor=employee_user)
    assert employee_request.status == StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL
    assert employee_request.department_approved_by is None
    with pytest.raises(ValidationError, match="HOD-approved Department request"):
        employee_request.create_shortage_purchase_requisition(created_by=stores_user)

    stores_client = APIClient()
    stores_client.force_authenticate(stores_user)
    assert stores_client.get("/api/v1/store-requisitions/").data["results"] == []

    head_client = APIClient()
    head_client.force_authenticate(head_user)
    response = head_client.post(
        f"/api/v1/store-requisitions/{employee_request.pk}/department-approve/",
        {"comments": "The rooms require these supplies."},
        format="json",
    )
    assert response.status_code == 200
    employee_request.refresh_from_db()
    assert employee_request.status == StoreRequisitionStatus.SUBMITTED
    assert employee_request.department_approved_by == head
    assert employee_request.department_approval_comments == "The rooms require these supplies."
    assert stores_client.get("/api/v1/store-requisitions/").data["count"] == 1

    response = stores_client.patch(
        f"/api/v1/store-requisition-items/{request_line.pk}/",
        {"quantity_approved": "2.00", "storekeeper_comment": "Available in stock."},
        format="json",
    )
    assert response.status_code == 200
    request_line.refresh_from_db()
    assert request_line.remarks == "For the second-floor guest rooms."
    assert request_line.storekeeper_comment == "Available in stock."

    purchase = employee_request.create_shortage_purchase_requisition(
        created_by=stores_user, reason="No approval soap is available in the issuing store."
    )
    assert employee_request.status == StoreRequisitionStatus.AWAITING_PROCUREMENT
    assert employee_request.procurement_requisition == purchase
    assert purchase.requester == employee
    assert purchase.department == department
    assert purchase.items.get().quantity == Decimal("2")
    with pytest.raises(ValidationError, match="not been fully received"):
        employee_request.resume_after_procurement()

    purchase.status = PRStatus.FULFILLED
    purchase.save(update_fields=["status", "updated_at"])
    employee_request.resume_after_procurement()
    employee_request.refresh_from_db()
    assert employee_request.status == StoreRequisitionStatus.COMPLETED

    head_request = StoreRequisition.objects.create(
        department=department, store=store, requested_by=head
    )
    StoreRequisitionItem.objects.create(
        requisition=head_request, item=item, quantity_requested=Decimal("1")
    )
    head_request.submit(actor=head_user)
    assert head_request.status == StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL
    assert head_request.department_approved_by is None
    with pytest.raises(ValidationError, match="cannot approve their own"):
        head_request.approve_department(head)


@pytest.mark.django_db
def test_store_requisition_issue_and_department_return_update_stock():
    department, employee, store, item = create_inventory_operations_context()
    requisition = StoreRequisition.objects.create(
        department=department,
        store=store,
        requested_by=employee,
        purpose="Kitchen production",
    )
    requisition_item = StoreRequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity_requested=Decimal("12.00"),
    )

    approve_store_request_for_department(requisition)
    requisition.approve(approved_by=employee)
    assert InventoryBalance.objects.get(item=item, store=store).quantity_reserved == Decimal("12.00")
    issue = StockIssue.objects.create(
        requisition=requisition,
        store=store,
        issued_by=employee,
    )
    StockIssueItem.objects.create(
        issue=issue,
        requisition_item=requisition_item,
        quantity=Decimal("10.00"),
    )
    issue.apply_inventory_changes()

    requisition.refresh_from_db()
    requisition_item.refresh_from_db()
    assert requisition.status == StoreRequisitionStatus.PARTIALLY_ISSUED
    assert requisition_item.quantity_issued == Decimal("10.00")
    balance = InventoryBalance.objects.get(item=item, store=store)
    assert balance.quantity_in_stock == Decimal("30.00")
    assert balance.quantity_reserved == Decimal("2.00")

    store_return = StoreReturn.objects.create(
        department=department,
        store=store,
        received_by=employee,
        reason="Unused stock returned by kitchen",
    )
    StoreReturnItem.objects.create(
        store_return=store_return,
        item=item,
        quantity=Decimal("2.00"),
    )
    store_return.apply_inventory_changes()

    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("32.00")
    assert StockLedger.objects.filter(reference_id=issue.id).count() == 1
    assert StockLedger.objects.filter(reference_id=store_return.id).count() == 1


@pytest.mark.django_db
def test_cancelling_approved_request_releases_outstanding_reservation():
    _, employee, store, item = create_inventory_operations_context()
    requisition = StoreRequisition.objects.create(
        department=employee.department, store=store, requested_by=employee, purpose="Cancelled need"
    )
    StoreRequisitionItem.objects.create(requisition=requisition, item=item, quantity_requested=Decimal("12.00"))
    approve_store_request_for_department(requisition)
    requisition.approve(approved_by=employee)
    requisition.cancel(actor=employee.user)

    balance = InventoryBalance.objects.get(item=item, store=store)
    assert balance.quantity_reserved == Decimal("0.00")
    requisition.refresh_from_db()
    assert requisition.status == StoreRequisitionStatus.CANCELLED


@pytest.mark.django_db
def test_adjustment_and_count_cannot_reduce_stock_below_reserved_quantity():
    _, employee, store, item = create_inventory_operations_context()
    balance = InventoryBalance.objects.get(item=item, store=store)
    balance.quantity_reserved = Decimal("15.00")
    balance.save(update_fields=["quantity_reserved"])

    adjustment = StockAdjustment.objects.create(store=store, reason="Damage", approved_by=employee)
    StockAdjustmentItem.objects.create(stock_adjustment=adjustment, item=item, quantity_change=Decimal("-30.00"))
    adjustment.submit()
    adjustment.approve(approved_by=employee)
    with pytest.raises(ValidationError, match="below 15.00 reserved"):
        adjustment.apply()

    stock_count = StockCount.objects.create(store=store, conducted_by=employee)
    StockCountItem.objects.create(stock_count=stock_count, item=item, system_quantity=Decimal("40.00"), physical_quantity=Decimal("10.00"))
    stock_count.submit()
    stock_count.approve(approved_by=employee)
    with pytest.raises(ValidationError, match="below 15.00 reserved"):
        stock_count.apply_variances()


@pytest.mark.django_db
def test_stock_count_applies_variance_once():
    _, employee, store, item = create_inventory_operations_context()
    stock_count = StockCount.objects.create(
        store=store,
        conducted_by=employee,
    )
    StockCountItem.objects.create(
        stock_count=stock_count,
        item=item,
        system_quantity=Decimal("40.00"),
        physical_quantity=Decimal("37.00"),
    )

    stock_count.submit()
    stock_count.approve(approved_by=employee)
    stock_count.apply_variances()

    stock_count.refresh_from_db()
    assert stock_count.status == StockCountStatus.APPLIED
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("37.00")
    assert StockLedger.objects.get(reference_id=stock_count.id).quantity_out == Decimal("3.00")

    with pytest.raises(ValidationError):
        stock_count.apply_variances()


@pytest.mark.django_db
def test_reorder_rule_creates_hotel_purchase_requisition_when_stock_is_low():
    department, employee, store, item = create_inventory_operations_context()
    supplier = Supplier.objects.create(
        name="Gas Supplier",
        email="gas@example.com",
        phone="+256700000004",
        address="Kampala",
        tin_number="TIN-004",
        registration_number="REG-004",
    )
    rule = ReorderRule.objects.create(
        item=item,
        store=store,
        minimum_level=Decimal("45.00"),
        reorder_quantity=Decimal("25.00"),
        preferred_supplier=supplier,
    )

    requisition = rule.create_purchase_requisition(
        requester=employee,
        department=department,
    )

    assert requisition.request_type == RequisitionType.HOTEL_PURCHASE
    assert requisition.preferred_supplier == supplier
    assert requisition.items.get().quantity == Decimal("25.00")
    assert PurchaseRequisition.objects.filter(id=requisition.id).exists()


@pytest.mark.django_db
def test_reorder_rule_does_not_create_purchase_requisition_when_stock_is_enough():
    department, employee, store, item = create_inventory_operations_context()
    rule = ReorderRule.objects.create(
        item=item,
        store=store,
        minimum_level=Decimal("20.00"),
        reorder_quantity=Decimal("25.00"),
    )

    with pytest.raises(ValidationError):
        rule.create_purchase_requisition(requester=employee, department=department)

@pytest.mark.django_db
def test_employee_store_request_resolves_default_store_from_authenticated_branch():
    from apps.accounts.models import User
    from apps.departments.models import Branch, Department
    from apps.employees.models import Employee
    from apps.inventory.models import StoreLocation, StoreRequisition

    branch = Branch.objects.create(name="Main Branch", branch_code="RES")
    department = Department.objects.create(name="Housekeeping")
    user = User.objects.create_user(
        username="requester-resolution",
        employee_code="EMP-RESOLVE",
        password="test-pass-123",
    )
    employee = Employee.objects.create(
        user=user,
        department=department,
        branch=branch,
        designation="Requester",
    )
    user.groups.add(Group.objects.get_or_create(name="Requester")[0])
    store = StoreLocation.objects.create(
        name="Main Store",
        branch=branch,
        is_default=True,
        is_active=True,
    )
    api_client = APIClient()
    api_client.force_authenticate(user=user)
    response = api_client.post(
        "/api/v1/store-requisitions/",
        {"purpose": "Daily cleaning operations"},
        format="json",
    )
    assert response.status_code == 201, response.data
    request = StoreRequisition.objects.get(pk=response.data["id"])
    assert request.requested_by == employee
    assert request.department == department
    assert request.store is None

@pytest.mark.django_db
def test_department_head_can_reduce_quantity_without_overwriting_requester_quantity():
    branch = Branch.objects.create(name="HOD Quantity Hotel")
    department = Department.objects.create(name="HOD Quantity Housekeeping")
    store = StoreLocation.objects.create(branch=branch, name="HOD Quantity Store")
    category = Category.objects.create(name="HOD Quantity Supplies")
    item = Item.objects.create(category=category, name="HOD Quantity Paper", unit="ream", reorder_level=Decimal("1"))

    requester_user = get_user_model().objects.create_user(username="hod-qty-requester", employee_code="HOD-QTY-REQ")
    requester = Employee.objects.create(user=requester_user, department=department, branch=branch, designation="Requester")
    requester_user.groups.add(Group.objects.get_or_create(name="Requester")[0])

    head_user = get_user_model().objects.create_user(username="hod-qty-head", employee_code="HOD-QTY-HOD")
    head = Employee.objects.create(user=head_user, department=department, branch=branch, designation="Department Head")
    head_user.groups.add(Group.objects.get_or_create(name="Department Head")[0])

    keeper_user = get_user_model().objects.create_user(username="hod-qty-keeper", employee_code="HOD-QTY-SK")
    keeper = Employee.objects.create(user=keeper_user, department=department, branch=branch, designation="Store Keeper")
    keeper_user.groups.add(Group.objects.get_or_create(name="Store Keeper")[0])
    StoreKeeperAssignment.objects.create(store=store, employee=keeper)

    requisition = StoreRequisition.objects.create(department=department, store=store, requested_by=requester)
    line = StoreRequisitionItem.objects.create(requisition=requisition, item=item, quantity_requested=Decimal("10.00"))
    requisition.submit(actor=requester_user)

    head_client = APIClient()
    head_client.force_authenticate(head_user)
    response = head_client.post(
        f"/api/v1/store-requisitions/{requisition.pk}/department-approve/",
        {"items": [{"id": str(line.pk), "approved_quantity": "7.00"}]},
        format="json",
    )
    assert response.status_code == 200

    line.refresh_from_db()
    requisition.refresh_from_db()
    assert line.base_quantity_requested == Decimal("10.00")
    assert line.hod_approved_quantity == Decimal("7.00")
    assert line.quantity_approved == Decimal("0.00")
    assert requisition.status == StoreRequisitionStatus.SUBMITTED
    assert requisition.department_approved_by == head

    keeper_client = APIClient()
    keeper_client.force_authenticate(keeper_user)
    assign = keeper_client.post(
        f"/api/v1/store-requisitions/{requisition.pk}/assign-store/",
        {"store": str(store.pk)},
        format="json",
    )
    assert assign.status_code == 200

    too_high = keeper_client.patch(
        f"/api/v1/store-requisition-items/{line.pk}/",
        {"quantity_approved": "8.00", "storekeeper_comment": ""},
        format="json",
    )
    assert too_high.status_code == 400

    accepted = keeper_client.patch(
        f"/api/v1/store-requisition-items/{line.pk}/",
        {"quantity_approved": "6.00", "storekeeper_comment": "Forward six"},
        format="json",
    )
    assert accepted.status_code == 200
    line.refresh_from_db()
    assert line.quantity_approved == Decimal("6.00")
    assert line.base_quantity_requested == Decimal("10.00")
    assert line.hod_approved_quantity == Decimal("7.00")


@pytest.mark.django_db
def test_department_requisition_reference_uses_r_prefix():
    branch = Branch.objects.create(name="Reference Hotel")
    department = Department.objects.create(name="Reference Department")
    user = get_user_model().objects.create_user(username="reference-requester", employee_code="REF-REQ")
    employee = Employee.objects.create(user=user, department=department, branch=branch, designation="Requester")
    requisition = StoreRequisition.objects.create(department=department, requested_by=employee)
    assert requisition.requisition_no.startswith("R-")
    assert requisition.requisition_no[2:].isdigit()
    assert len(requisition.requisition_no[2:]) >= 5

@pytest.mark.django_db
def test_department_head_approval_is_not_failed_by_notification_error(monkeypatch):
    branch = Branch.objects.create(name="HOD Notification Hotel")
    department = Department.objects.create(name="HOD Notification Housekeeping")
    category = Category.objects.create(name="HOD Notification Supplies")
    item = Item.objects.create(
        category=category,
        name="HOD Notification Item",
        unit="piece",
        reorder_level=Decimal("1"),
    )

    requester_user = get_user_model().objects.create_user(
        username="hod-notify-requester", employee_code="HOD-NOTIFY-REQ"
    )
    requester = Employee.objects.create(
        user=requester_user,
        department=department,
        branch=branch,
        designation="Requester",
    )
    requester_user.groups.add(Group.objects.get_or_create(name="Requester")[0])

    head_user = get_user_model().objects.create_user(
        username="hod-notify-head", employee_code="HOD-NOTIFY-HOD"
    )
    head = Employee.objects.create(
        user=head_user,
        department=department,
        branch=branch,
        designation="Department Head",
    )
    head_user.groups.add(Group.objects.get_or_create(name="Department Head")[0])

    store = StoreLocation.objects.create(
        branch=branch,
        name="HOD Notification Store",
    )

    requisition = StoreRequisition.objects.create(
        department=department,
        store=store,
        requested_by=requester,
    )
    line = StoreRequisitionItem.objects.create(
        requisition=requisition,
        item=item,
        quantity_requested=Decimal("6.00"),
    )
    requisition.submit(actor=requester_user)

    def broken_notification(*args, **kwargs):
        raise RuntimeError("notification backend unavailable")

    monkeypatch.setattr(StoreRequisition, "_notify_stores", broken_notification)

    client = APIClient()
    client.force_authenticate(head_user)
    response = client.post(
        f"/api/v1/store-requisitions/{requisition.pk}/department-approve/",
        {"items": [{"id": str(line.pk), "approved_quantity": "6.00"}]},
        format="json",
    )

    assert response.status_code == 200
    requisition.refresh_from_db()
    line.refresh_from_db()
    assert requisition.status == StoreRequisitionStatus.SUBMITTED
    assert requisition.department_approved_by == head
    assert line.hod_approved_quantity == Decimal("6.00")

@pytest.mark.django_db
def test_one_article_can_have_multiple_active_suppliers():
    category = Category.objects.create(name="Office Supplies Multi Supplier")
    item = Item.objects.create(
        category=category,
        name="A4 Printing Paper Multi Supplier",
        sku="A4-MULTI-001",
        unit="ream",
        reorder_level=Decimal("5.00"),
    )
    supplier_a = Supplier.objects.create(
        name="Paper Supplier A",
        email="paper-a@example.com",
        phone="+256700001001",
        address="Kampala",
        tin_number="TIN-MULTI-A",
        registration_number="REG-MULTI-A",
    )
    supplier_b = Supplier.objects.create(
        name="Paper Supplier B",
        email="paper-b@example.com",
        phone="+256700001002",
        address="Kampala",
        tin_number="TIN-MULTI-B",
        registration_number="REG-MULTI-B",
    )

    first = SupplierItemPrice.objects.create(
        supplier=supplier_a,
        item=item,
        unit_price=Decimal("19500.00"),
        is_active=True,
        is_preferred=True,
    )
    second = SupplierItemPrice.objects.create(
        supplier=supplier_b,
        item=item,
        unit_price=Decimal("20250.00"),
        is_active=True,
        is_preferred=True,
    )

    assert first.item_id == second.item_id
    assert SupplierItemPrice.objects.filter(item=item, is_active=True).count() == 2
