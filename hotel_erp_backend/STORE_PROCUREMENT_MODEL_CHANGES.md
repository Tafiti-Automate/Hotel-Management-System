# Store, Stock, Requisition and Procurement Model Improvements

This update strengthens the hotel management backend around stores, stock control, internal requisitions and procurement.

## Inventory / Store additions

- `ReorderRule` for store-level or general reorder controls.
- `StoreRequisition` and `StoreRequisitionItem` for departments requesting stock from stores.
- `StockIssue` and `StockIssueItem` for issuing approved requisition items and reducing stock.
- `StoreReturn` and `StoreReturnItem` for returns from departments back to the store.
- `StockCount` and `StockCountItem` for physical stock taking and variance posting.

## Procurement additions

- `VendorQuotationItem` for item-by-item supplier quotation comparison.
- `GoodsInspection` and `GoodsInspectionItem` for accepted/rejected received goods.
- `SupplierReturn` and `SupplierReturnItem` for returning rejected/damaged goods to suppliers.

## Workflow now supported

Department -> Store Requisition -> Approval -> Stock Issue -> Stock Ledger Update

Purchase Requisition -> Supplier Quotation Items -> Purchase Order -> GRN -> Inspection -> Stock Posting -> Supplier Return where needed

Stock Count -> Variance Approval -> Stock Ledger Adjustment

## New API endpoints

Inventory:

- `/api/v1/inventory/reorder-rules/`
- `/api/v1/inventory/store-requisitions/`
- `/api/v1/inventory/store-requisition-items/`
- `/api/v1/inventory/stock-issues/`
- `/api/v1/inventory/stock-issue-items/`
- `/api/v1/inventory/store-returns/`
- `/api/v1/inventory/store-return-items/`
- `/api/v1/inventory/stock-counts/`
- `/api/v1/inventory/stock-count-items/`

Procurement:

- `/api/v1/procurement/quotation-items/`
- `/api/v1/procurement/goods-inspections/`
- `/api/v1/procurement/goods-inspection-items/`
- `/api/v1/procurement/supplier-returns/`
- `/api/v1/procurement/supplier-return-items/`

## Important next command

After installing the project dependencies, run:

```bash
python manage.py makemigrations inventory procurement
python manage.py migrate
python manage.py check
```

The uploaded environment did not include an importable Django installation, so migrations were not generated inside this sandbox.
