# PostgreSQL LPO Row-Lock Fix

## Problem
PostgreSQL raised:

`FOR UPDATE cannot be applied to the nullable side of an outer join`

while an LPO approver saved quantity decisions through `review-quantities`.

## Root cause
`PurchaseOrderItem` rows were locked using `select_for_update()` in the same query that used `select_related("item", "unit", "requisition_item")`. `unit` and `requisition_item` are nullable, so Django generated `LEFT OUTER JOIN`s and PostgreSQL rejected the `FOR UPDATE` query.

## Fix
The code now:
1. Locks only the `PurchaseOrderItem` primary keys inside the existing transaction.
2. Loads `item`, `unit`, and `requisition_item` in a second query while the row locks remain held.

This preserves concurrency protection and does not change the LPO approval workflow, roles, quantities, permissions, or API routes.

## Backend scan
The backend was scanned for other `select_for_update()` + `select_related()` combinations.

Two unsafe PurchaseOrderItem usages with nullable relationships were found and corrected:
- `apps/procurement/models.py` — approval quantity review.
- `apps/procurement/views.py` — draft LPO quantity editing.

The remaining direct combinations use required/non-null relationships and do not create the nullable-side outer join that caused this PostgreSQL error:
- `SupplierPayment -> invoice`
- `RequisitionItem -> item`
- `GoodsReceiptItem -> goods_receipt / purchase_order_item / item`
- `StockIssue -> requisition / store`

## Deployment
No migration is required. Replace the two backend files and redeploy/restart the backend.
