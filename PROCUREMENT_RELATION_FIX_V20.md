# Procurement relationship fix v20

Resolved Django system-check errors `fields.E302` and `fields.E303` caused by a reverse accessor collision on `PurchaseRequisition.source_store_requisition`.

## Change

The existing `StoreRequisition.procurement_requisition` reverse accessor was renamed from:

- `source_store_requisition`

to:

- `linked_store_requisition`

The explicit `PurchaseRequisition.source_store_requisition` field remains the authoritative source link for the new procurement workflow.

Migration added:

`apps/inventory/migrations/0015_alter_storerequisition_procurement_requisition.py`

After deployment, run migrations normally.
