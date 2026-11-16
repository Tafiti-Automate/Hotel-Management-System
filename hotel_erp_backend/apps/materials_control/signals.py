"""Closed periods protect posted business dates across backend entry points."""
from django.db.models.signals import pre_delete, pre_save
from django.dispatch import receiver
from django.utils import timezone

from apps.finance.models import Expense, SupplierInvoice, SupplierInvoiceItem, SupplierPayment
from apps.inventory.models import (
    StockAdjustment, StockAdjustmentItem, StockCount, StockCountItem, StockIssue,
    StockIssueItem, StockLedger, StockTransfer, StockTransferItem,
    StoreRequisition, StoreRequisitionItem, StoreReturn, StoreReturnItem,
)
from apps.materials_control.models import POSImportBatch, POSSaleLine, WasteRecord
from apps.materials_control.services import assert_period_open
from apps.procurement.models import (
    GoodsReceiptNote, GoodsReceiptItem, PurchaseOrder, PurchaseOrderItem,
    PurchaseRequisition, RequisitionItem,
)


def check(branch_id, business_date):
    if branch_id:
        assert_period_open(branch_id, business_date or timezone.localdate())


@receiver(pre_save, sender=WasteRecord)
@receiver(pre_delete, sender=WasteRecord)
def protect_waste(sender, instance, **kwargs):
    check(instance.outlet.branch_id if instance.outlet_id else None,
          instance.created_at.date() if instance.created_at else None)


@receiver(pre_save, sender=POSImportBatch)
@receiver(pre_delete, sender=POSImportBatch)
def protect_pos_batch(sender, instance, **kwargs):
    check(instance.outlet.branch_id if instance.outlet_id else None, instance.business_date)


@receiver(pre_save, sender=POSSaleLine)
@receiver(pre_delete, sender=POSSaleLine)
def protect_pos_line(sender, instance, **kwargs):
    if instance.batch_id:
        check(instance.batch.outlet.branch_id, instance.batch.business_date)


@receiver(pre_save, sender=GoodsReceiptNote)
@receiver(pre_delete, sender=GoodsReceiptNote)
def protect_receipt(sender, instance, **kwargs):
    if instance.purchase_order_id:
        check(instance.purchase_order.requisition.branch_id, instance.received_date)


@receiver(pre_save, sender=SupplierInvoice)
@receiver(pre_delete, sender=SupplierInvoice)
def protect_invoice(sender, instance, **kwargs):
    if instance.purchase_order_id:
        check(instance.purchase_order.requisition.branch_id, instance.invoice_date)


@receiver(pre_save, sender=SupplierPayment)
@receiver(pre_delete, sender=SupplierPayment)
def protect_payment(sender, instance, **kwargs):
    if instance.invoice_id:
        check(instance.invoice.purchase_order.requisition.branch_id, instance.payment_date)


@receiver(pre_save, sender=Expense)
@receiver(pre_delete, sender=Expense)
def protect_expense(sender, instance, **kwargs):
    check(instance.store.branch_id if instance.store_id else None, instance.date)


@receiver(pre_save, sender=StockLedger)
@receiver(pre_delete, sender=StockLedger)
def protect_ledger(sender, instance, **kwargs):
    check(instance.store.branch_id if instance.store_id else None,
          instance.created_at.date() if instance.created_at else None)


@receiver(pre_save, sender=StockTransfer)
@receiver(pre_delete, sender=StockTransfer)
def protect_transfer(sender, instance, **kwargs):
    business_date = instance.created_at.date() if instance.created_at else None
    if instance.from_store_id:
        check(instance.from_store.branch_id, business_date)
    if instance.to_store_id and instance.to_store_id != instance.from_store_id:
        check(instance.to_store.branch_id, business_date)


@receiver(pre_save, sender=StockCount)
@receiver(pre_delete, sender=StockCount)
def protect_stock_count(sender, instance, **kwargs):
    check(instance.store.branch_id if instance.store_id else None, instance.count_date)


@receiver(pre_save, sender=StockAdjustment)
@receiver(pre_delete, sender=StockAdjustment)
def protect_adjustment(sender, instance, **kwargs):
    check(instance.store.branch_id if instance.store_id else None,
          instance.created_at.date() if instance.created_at else None)


@receiver(pre_save, sender=PurchaseRequisition)
@receiver(pre_delete, sender=PurchaseRequisition)
def protect_purchase_requisition(sender, instance, **kwargs):
    check(instance.branch_id, instance.expected_date)


# Child records can be edited through dedicated DRF endpoints. Apply the same
# fiscal lock to line-level writes, not merely parent status transitions.
@receiver(pre_save, sender=SupplierInvoiceItem)
@receiver(pre_delete, sender=SupplierInvoiceItem)
def protect_invoice_item(sender, instance, **kwargs):
    if instance.invoice_id:
        invoice = instance.invoice
        check(invoice.purchase_order.requisition.branch_id, invoice.invoice_date)


@receiver(pre_save, sender=GoodsReceiptItem)
@receiver(pre_delete, sender=GoodsReceiptItem)
def protect_receipt_item(sender, instance, **kwargs):
    if instance.goods_receipt_id:
        receipt = instance.goods_receipt
        check(receipt.purchase_order.requisition.branch_id, receipt.received_date)


@receiver(pre_save, sender=PurchaseOrder)
@receiver(pre_delete, sender=PurchaseOrder)
def protect_purchase_order(sender, instance, **kwargs):
    if instance.requisition_id:
        requisition = instance.requisition
        check(requisition.branch_id, requisition.expected_date)


@receiver(pre_save, sender=PurchaseOrderItem)
@receiver(pre_delete, sender=PurchaseOrderItem)
def protect_purchase_order_item(sender, instance, **kwargs):
    if instance.purchase_order_id:
        requisition = instance.purchase_order.requisition
        check(requisition.branch_id, requisition.expected_date)


@receiver(pre_save, sender=RequisitionItem)
@receiver(pre_delete, sender=RequisitionItem)
def protect_requisition_item(sender, instance, **kwargs):
    if instance.requisition_id:
        check(instance.requisition.branch_id, instance.requisition.expected_date)


@receiver(pre_save, sender=StockTransferItem)
@receiver(pre_delete, sender=StockTransferItem)
def protect_transfer_item(sender, instance, **kwargs):
    if instance.stock_transfer_id:
        transfer = instance.stock_transfer
        check(transfer.from_store.branch_id,
              transfer.created_at.date() if transfer.created_at else None)


@receiver(pre_save, sender=StockAdjustmentItem)
@receiver(pre_delete, sender=StockAdjustmentItem)
def protect_adjustment_item(sender, instance, **kwargs):
    if instance.stock_adjustment_id:
        adjustment = instance.stock_adjustment
        check(adjustment.store.branch_id,
              adjustment.created_at.date() if adjustment.created_at else None)


@receiver(pre_save, sender=StockCountItem)
@receiver(pre_delete, sender=StockCountItem)
def protect_stock_count_item(sender, instance, **kwargs):
    if instance.stock_count_id:
        count = instance.stock_count
        check(count.store.branch_id, count.count_date)


@receiver(pre_save, sender=StockIssue)
@receiver(pre_delete, sender=StockIssue)
def protect_stock_issue(sender, instance, **kwargs):
    check(instance.store.branch_id if instance.store_id else None,
          instance.issue_date)


@receiver(pre_save, sender=StockIssueItem)
@receiver(pre_delete, sender=StockIssueItem)
def protect_stock_issue_item(sender, instance, **kwargs):
    if instance.issue_id:
        issue = instance.issue
        check(issue.store.branch_id, issue.issue_date)


@receiver(pre_save, sender=StoreReturn)
@receiver(pre_delete, sender=StoreReturn)
def protect_store_return(sender, instance, **kwargs):
    check(instance.store.branch_id if instance.store_id else None,
          instance.return_date)


@receiver(pre_save, sender=StoreReturnItem)
@receiver(pre_delete, sender=StoreReturnItem)
def protect_store_return_item(sender, instance, **kwargs):
    if instance.store_return_id:
        returned = instance.store_return
        check(returned.store.branch_id, returned.return_date)


@receiver(pre_save, sender=StoreRequisition)
@receiver(pre_delete, sender=StoreRequisition)
def protect_store_requisition(sender, instance, **kwargs):
    if instance.requested_by_id:
        check(instance.requested_by.branch_id,
              instance.created_at.date() if instance.created_at else None)


@receiver(pre_save, sender=StoreRequisitionItem)
@receiver(pre_delete, sender=StoreRequisitionItem)
def protect_store_requisition_item(sender, instance, **kwargs):
    if instance.requisition_id:
        request = instance.requisition
        check(request.requested_by.branch_id,
              request.created_at.date() if request.created_at else None)
