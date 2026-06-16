from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from apps.customers.models import Customer, CustomerLedger
from apps.departments.models import Branch, Department
from apps.employees.models import Employee
from apps.finance.models import CashFlow, PaymentMethod
from apps.inventory.models import (
    Category,
    InventoryBalance,
    Item,
    ItemUnitPrice,
    StockLedger,
    StoreLocation,
    UnitOfMeasure,
)
from apps.sales.models import Sale, SaleItem
from core.constants.choices import CustomerLedgerType, SaleStatus


@pytest.mark.django_db
def test_sale_completion_posts_stock_cashflow_and_customer_ledger_once():
    user = get_user_model().objects.create_user(
        username="cashier",
        employee_code="EMP-SALE",
        password="test-pass-123",
    )
    department = Department.objects.create(name="Restaurant")
    employee = Employee.objects.create(
        user=user,
        department=department,
        designation="Cashier",
    )
    branch = Branch.objects.create(name="Main Hotel")
    store = StoreLocation.objects.create(branch=branch, name="Restaurant Store")
    category = Category.objects.create(name="Restaurant Stock")
    base_unit = UnitOfMeasure.objects.create(name="Bottle", abbreviation="btl")
    crate_unit = UnitOfMeasure.objects.create(name="Crate", abbreviation="crt")
    item = Item.objects.create(
        category=category,
        name="Mineral Water",
        unit="bottle",
        base_unit=base_unit,
        reorder_level=Decimal("10.00"),
    )
    ItemUnitPrice.objects.create(
        item=item,
        unit=crate_unit,
        conversion_factor=Decimal("12.0000"),
        selling_price=Decimal("84000.00"),
    )
    InventoryBalance.objects.create(
        item=item,
        store=store,
        quantity_in_stock=Decimal("30.00"),
    )
    customer = Customer.objects.create(name="Room 204 Guest")
    payment_method = PaymentMethod.objects.create(name="Cash")
    sale = Sale.objects.create(
        customer=customer,
        store=store,
        recorded_by=employee,
        payment_method=payment_method,
        amount_paid=Decimal("12000.00"),
    )
    sale_item = SaleItem.objects.create(
        sale=sale,
        item=item,
        unit=crate_unit,
        quantity=Decimal("2.00"),
        unit_price=Decimal("7000.00"),
    )

    sale.complete_sale()

    sale.refresh_from_db()
    customer.refresh_from_db()
    sale_item.refresh_from_db()
    assert sale_item.base_quantity == Decimal("24.0000")
    assert sale.total_amount == Decimal("14000.00")
    assert sale.balance == Decimal("2000.00")
    assert sale.status == SaleStatus.PARTIALLY_PAID
    assert sale.inventory_changes_applied is True
    assert InventoryBalance.objects.get(item=item, store=store).quantity_in_stock == Decimal("6.00")
    assert StockLedger.objects.get(reference_id=sale.id).quantity_out == Decimal("24.00")
    assert CashFlow.objects.get(reference=sale.receipt_no).amount == Decimal("12000.00")
    assert customer.balance == Decimal("2000.00")
    assert CustomerLedger.objects.filter(
        customer=customer,
        transaction_type=CustomerLedgerType.INVOICE,
    ).count() == 1
    assert CustomerLedger.objects.filter(
        customer=customer,
        transaction_type=CustomerLedgerType.PAYMENT,
    ).count() == 1

    with pytest.raises(ValidationError):
        sale.complete_sale()
