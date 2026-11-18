"""Phase A: four-decimal stock quantities survive persistence, conversions and postings.

Only quantities are widened. Currency totals and booked historical cost snapshots
must remain at their existing monetary precision and never be recomputed by migrations.
"""
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.finance.models import SupplierInvoice, SupplierInvoiceItem
from apps.inventory.models import (
    InventoryBalance, InventoryBatch, Item, StockCountItem, StockLedger,
    StockTransfer, StockTransferItem, StoreRequisitionItem, UnitOfMeasure,
)
from apps.materials_control.models import POSSaleLine, RecipeIngredient, WasteRecord
from apps.procurement.models import (
    GoodsInspectionItem, GoodsReceiptItem, PurchaseOrder,
    PurchaseOrderItem, PurchaseRequisition, RequisitionItem,
)
from apps.sales.models import SaleItem
from core.constants.choices import LedgerReferenceType, PRStatus
from tests.test_inventory import create_inventory_operations_context
from tests.test_procurement import authorize_order_for_test, create_procurement_context


@pytest.mark.parametrize("model,fields", [
    (InventoryBalance, ("quantity_in_stock", "quantity_reserved")),
    (InventoryBatch, ("quantity", "remaining_quantity")),
    (StockLedger, ("quantity_in", "quantity_out")),
    (StoreRequisitionItem, ("quantity_requested", "base_quantity_requested", "quantity_approved", "quantity_issued")),
    (StockTransferItem, ("quantity", "base_quantity")),
    (StockCountItem, ("system_quantity", "physical_quantity")),
    (RequisitionItem, ("quantity", "approved_quantity", "procurement_quantity")),
    (PurchaseOrderItem, ("quantity", "base_quantity", "finance_approved_base_quantity")),
    (GoodsReceiptItem, ("quantity_received", "base_quantity")),
    (GoodsInspectionItem, ("quantity_received", "quantity_accepted", "quantity_rejected")),
    (SupplierInvoiceItem, ("quantity", "base_quantity")),
    (SaleItem, ("quantity", "base_quantity")),
    (WasteRecord, ("quantity", "base_quantity")),
    (POSSaleLine, ("quantity",)),
    (RecipeIngredient, ("quantity", "base_quantity")),
])
def test_all_operational_base_quantities_support_four_decimals(model, fields):
    for field in fields:
        assert model._meta.get_field(field).decimal_places == 4, f"{model.__name__}.{field}"


def test_monetary_fields_stay_at_two_decimals_and_stock_cost_at_four():
    assert PurchaseOrderItem._meta.get_field("unit_cost").decimal_places == 2
    assert SupplierInvoice._meta.get_field("subtotal").decimal_places == 2
    assert InventoryBalance._meta.get_field("weighted_average_cost").decimal_places == 4
    assert StockLedger._meta.get_field("total_cost_snapshot").decimal_places == 4


@pytest.mark.django_db
def test_fractional_store_transfer_preserves_exact_quantity_and_historical_value():
    department, employee, source, item = create_inventory_operations_context()
    from apps.inventory.models import StoreLocation
    destination = StoreLocation.objects.create(branch=source.branch, name="Fractional receiving bin")
    balance = InventoryBalance.objects.get(item=item, store=source)
    balance.weighted_average_cost = Decimal("1000.0000")
    balance.save(update_fields=["weighted_average_cost"])
    before = balance.quantity_in_stock

    transfer = StockTransfer.objects.create(from_store=source, to_store=destination)
    line = StockTransferItem.objects.create(
        stock_transfer=transfer, item=item, quantity=Decimal("0.1255"),
    )
    assert line.base_quantity == Decimal("0.1255")
    transfer.approve(approved_by=employee)
    transfer.dispatch(dispatched_by=employee)
    balance.refresh_from_db()
    assert balance.quantity_in_stock == before - Decimal("0.1255")
    departure = StockLedger.objects.get(
        store=source, reference_type=LedgerReferenceType.STOCK_TRANSFER,
        reference_id=transfer.pk,
    )
    assert departure.quantity_out == Decimal("0.1255")
    assert departure.total_cost_snapshot == Decimal("125.5000")

    transfer.receive(received_by=employee)
    destination_balance = InventoryBalance.objects.get(store=destination, item=item)
    assert destination_balance.quantity_in_stock == Decimal("0.1255")
    receipt = StockLedger.objects.get(
        store=destination, reference_type=LedgerReferenceType.STOCK_TRANSFER,
        reference_id=transfer.pk,
    )
    assert receipt.quantity_in == Decimal("0.1255")
    assert receipt.total_cost_snapshot == departure.total_cost_snapshot


@pytest.mark.django_db
def test_purchase_and_grn_do_not_drop_fractional_units_before_posting():
    employee, department, supplier, item = create_procurement_context()
    requisition = PurchaseRequisition.objects.create(
        requester=employee, department=department,
        reason="Fractional kitchen supplies", status=PRStatus.APPROVED,
    )
    RequisitionItem.objects.create(
        requisition=requisition, item=item,
        quantity=Decimal("0.1255"), approved_quantity=Decimal("0.1255"),
        estimated_unit_cost=Decimal("1000.00"),
    )
    order = PurchaseOrder.objects.create(
        requisition=requisition, supplier=supplier, ordered_by=employee,
    )
    order_line = PurchaseOrderItem.objects.create(
        purchase_order=order, item=item,
        quantity=Decimal("0.1255"), unit_cost=Decimal("1000.00"),
    )
    assert order_line.base_quantity == Decimal("0.1255")
    authorize_order_for_test(order)
    order.issue(sent_by=employee)
    from apps.procurement.models import GoodsReceiptNote
    grn = GoodsReceiptNote.objects.create(purchase_order=order, received_by=employee)
    receipt = GoodsReceiptItem.objects.create(
        goods_receipt=grn, purchase_order_item=order_line,
        quantity_received=Decimal("0.1255"),
    )
    assert receipt.base_quantity == Decimal("0.1255")
    receipt.refresh_from_db()
    assert receipt.base_quantity == Decimal("0.1255")


@pytest.mark.django_db
def test_conversion_normalizes_to_four_places_without_losing_integer_range():
    _, _, store, item = create_inventory_operations_context()
    assert item.quantity_in_base_units(Decimal("1.23456")) == Decimal("1.2346")
    field = InventoryBalance._meta.get_field("quantity_in_stock")
    assert field.max_digits - field.decimal_places == 10
    over_precision = InventoryBalance(
        item=item, store=store, quantity_in_stock=Decimal("0.00001"),
    )
    with pytest.raises(ValidationError) as error:
        over_precision.full_clean()
    assert "quantity_in_stock" in error.value.message_dict
