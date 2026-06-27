from django.db import models


class ItemBusinessType(models.TextChoices):
    CONSUMABLE_EXPENSE = "consumable_expense", "Consumable / Operating Expense"
    RESALE_REVENUE = "resale_revenue", "Resale / Revenue Item"
    FIXED_ASSET = "fixed_asset", "Fixed Asset"
 


class PRStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SUBMITTED = "submitted", "Submitted"
    HOD_APPROVED = "hod_approved", "Head of Department Approved"
    PROCUREMENT_APPROVED = "procurement_approved", "Procurement Approved"
    FINANCE_APPROVED = "finance_approved", "Finance Approved"
    DIRECTOR_APPROVED = "director_approved", "Director Approved"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


class RequisitionType(models.TextChoices):
    DEPARTMENT = "department", "Department requisition"
    HOTEL_PURCHASE = "hotel_purchase", "Hotel purchase requisition"


class ApprovalStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    SKIPPED = "skipped", "Skipped"


class POStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    ISSUED = "issued", "Issued"
    PARTIALLY_RECEIVED = "partially_received", "Partially Received"
    RECEIVED = "received", "Received"
    CANCELLED = "cancelled", "Cancelled"


class LedgerReferenceType(models.TextChoices):
    GOODS_RECEIPT = "goods_receipt", "Goods Receipt"
    PURCHASE_ORDER = "purchase_order", "Purchase Order"
    STOCK_ADJUSTMENT = "stock_adjustment", "Stock Adjustment"
    STOCK_ISSUE = "stock_issue", "Stock Issue"
    STOCK_TRANSFER = "stock_transfer", "Stock Transfer"
    SALE = "sale", "Sale"
    RETURN_TO_VENDOR = "return_to_vendor", "Return to Vendor"
    STORE_RETURN = "store_return", "Store Return"
    STOCK_COUNT = "stock_count", "Stock Count"


class StoreRequisitionStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SUBMITTED = "submitted", "Submitted"
    APPROVED = "approved", "Approved"
    PARTIALLY_APPROVED = "partially_approved", "Partially Approved"
    REJECTED = "rejected", "Rejected"
    PARTIALLY_ISSUED = "partially_issued", "Partially Issued"
    ISSUED = "issued", "Issued"
    CANCELLED = "cancelled", "Cancelled"


class StockCountStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    IN_PROGRESS = "in_progress", "In Progress"
    SUBMITTED = "submitted", "Submitted"
    APPROVED = "approved", "Approved"
    APPLIED = "applied", "Applied"
    CANCELLED = "cancelled", "Cancelled"


class GoodsInspectionStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    PARTIALLY_ACCEPTED = "partially_accepted", "Partially Accepted"
    ACCEPTED = "accepted", "Accepted"
    REJECTED = "rejected", "Rejected"


class SupplierReturnStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    APPROVED = "approved", "Approved"
    POSTED = "posted", "Posted"
    CANCELLED = "cancelled", "Cancelled"


class StockTransferStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    IN_TRANSIT = "in_transit", "In Transit"
    COMPLETED = "completed", "Completed"
    CANCELLED = "cancelled", "Cancelled"


class StockAdjustmentStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    APPLIED = "applied", "Applied"
    CANCELLED = "cancelled", "Cancelled"


class CashFlowType(models.TextChoices):
    INFLOW = "inflow", "Inflow"
    OUTFLOW = "outflow", "Outflow"


class BankTransactionType(models.TextChoices):
    DEPOSIT = "deposit", "Deposit"
    WITHDRAWAL = "withdrawal", "Withdrawal"
    TRANSFER = "transfer", "Transfer"


class CustomerLedgerType(models.TextChoices):
    INVOICE = "invoice", "Invoice"
    PAYMENT = "payment", "Payment"
    ADJUSTMENT = "adjustment", "Adjustment"


class SaleStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PENDING = "pending", "Pending"
    PARTIALLY_PAID = "partially_paid", "Partially Paid"
    PAID = "paid", "Paid"
    CANCELLED = "cancelled", "Cancelled"
