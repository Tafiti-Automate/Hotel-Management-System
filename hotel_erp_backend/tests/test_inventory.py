from decimal import Decimal
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
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
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("30.00")

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
