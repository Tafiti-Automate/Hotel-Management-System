from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ValidationError

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
    StockIssue,
    StockIssueItem,
    StockLedger,
    StockTransfer,
    StockTransferItem,
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
from core.constants.choices import RequisitionType, StockCountStatus, StoreRequisitionStatus
from apps.inventory.serializers import (
    CategorySerializer,
    ItemUnitPriceSerializer,
    StockTransferItemSerializer,
    StoreLocationSerializer,
)


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
    assert root_row["children_count"] == 1
    assert root_row["item_count"] == 1
    assert child_row["parent_name"] == "Beverages"
    assert child_row["item_count"] == 1

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
        user=user, department=own_department, branch=branch, designation="Department Head"
    )
    other_user = get_user_model().objects.create_user(
        username="other-requester", employee_code="EMP-OTHER", password="test-pass-123"
    )
    other_employee = Employee.objects.create(
        user=other_user, department=other_department, branch=branch, designation="Finance Officer"
    )
    group = Group.objects.create(name="Department Head")
    group.permissions.add(
        Permission.objects.get(content_type__app_label="inventory", codename="add_storerequisition"),
        Permission.objects.get(content_type__app_label="inventory", codename="view_storerequisition"),
    )
    user.groups.add(group)
    client.force_login(user)

    response = client.post(
        "/api/v1/store-requisitions/",
        {
            "department": str(other_department.pk),
            "requested_by": str(other_employee.pk),
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
def test_store_request_department_approval_and_head_bypass():
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
        user=employee_user, department=department, branch=branch, designation="Attendant"
    )
    head_user = get_user_model().objects.create_user(
        username="requesting-head", employee_code="EMP-FLOW-HEAD"
    )
    head = Employee.objects.create(
        user=head_user, department=department, branch=branch, designation="Department Head"
    )
    head_group = Group.objects.create(name="Department Head")
    head_user.groups.add(head_group)

    employee_request = StoreRequisition.objects.create(
        department=department, store=store, requested_by=employee
    )
    StoreRequisitionItem.objects.create(
        requisition=employee_request, item=item, quantity_requested=Decimal("2")
    )
    employee_request.submit(actor=employee_user)
    assert employee_request.status == StoreRequisitionStatus.PENDING_DEPARTMENT_APPROVAL

    employee_request.approve_department(head, "Needed for guest rooms")
    assert employee_request.status == StoreRequisitionStatus.SUBMITTED
    assert employee_request.department_approved_by == head

    purchase = employee_request.create_shortage_purchase_requisition(
        created_by=head_user, reason="No approval soap is available in the issuing store."
    )
    assert employee_request.status == StoreRequisitionStatus.AWAITING_PROCUREMENT
    assert employee_request.procurement_requisition == purchase
    assert purchase.requester == employee
    assert purchase.department == department
    assert purchase.items.get().quantity == Decimal("2")
    with pytest.raises(ValidationError, match="not yet been posted"):
        employee_request.resume_after_procurement()

    InventoryBalance.objects.create(
        item=item, store=store, quantity_in_stock=Decimal("2")
    )
    employee_request.resume_after_procurement()
    assert employee_request.status == StoreRequisitionStatus.SUBMITTED

    head_request = StoreRequisition.objects.create(
        department=department, store=store, requested_by=head
    )
    StoreRequisitionItem.objects.create(
        requisition=head_request, item=item, quantity_requested=Decimal("1")
    )
    head_request.submit(actor=head_user)
    assert head_request.status == StoreRequisitionStatus.SUBMITTED
    assert head_request.department_approved_by == head


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

    requisition.submit()
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
def test_employee_store_request_resolves_default_store_from_authenticated_branch(api_client):
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
        designation="Attendant",
    )
    store = StoreLocation.objects.create(
        name="Main Store",
        branch=branch,
        is_default=True,
        is_active=True,
    )
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
    assert request.store == store
