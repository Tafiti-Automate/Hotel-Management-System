# Supplier Quotation Visibility Fix

## Problem
A Cost Controller could save a supplier quotation against an Article, but Procurement Officer/Manager could still see "No active supplier quotation is available for this article."

## Cause
The Procurement sourcing panel was matching quotations from the application-wide `supplierItems` cache. The Procurement workspace API returned requisitions and requisition lines, but did not return the supplier quotations for those exact Articles. If the global reference-data request was stale, delayed, or independently permission-scoped, the requisition line existed while its quotation list was empty.

## Fix
- The backend `requisitions/workspace?stage=quote` response now includes active supplier-item quotations for the exact Articles present in the visible requisitions.
- Only active quotation rows with an active Supplier and active Article are returned.
- The frontend normalizes the workspace quotation payload into the same structure used by the supplier quotation catalogue.
- Procurement sourcing now prefers the workspace quotation rows and only falls back to the global catalogue when the workspace payload is unavailable.
- Supplier quotation matching remains by the Article UUID, not by display name, avoiding name/path ambiguity.
- Unit price remains read-only in Procurement; the Cost Controller remains the price authority.

## Procurement sourcing relationship
`RequisitionItem.item` -> `SupplierItemPrice.item` -> Supplier / Purchase UOM / Quoted price / Quotation reference.

A quotation upload remains documentary evidence attached to the supplier catalogue price record; the actual supplier/price option used by Procurement is the active `SupplierItemPrice` record.
