# Procurement Handoff Visibility V9.5

## Issue
The Procurement workspace showed a non-zero **New Store Requisitions** count, but Procurement Manager/Officer landed on **Prepare LPO** and could not see the requisition rows.

## Root cause
The frontend still treated supplier allocation as the legacy Vendor Quotation stage and gated it with:

- `procurement.view_vendorquotation`
- `procurement.change_vendorquotation`

The client-approved Procurement role no longer uses that legacy quotation workflow. Supplier selection is performed from the supplier item-price/quotation catalogue, while the requisition allocation itself is stored on requisition lines.

The backend was already correct and authorizes the workspace with `inventory.view_supplieritemprice`.

## Fix
`ProcurementWorkbench.tsx` now uses:

- View: `inventory.view_supplieritemprice`
- Change: `procurement.change_requisitionitem`

The Procurement role now lands on the supplier-allocation/New Store Requisitions stage when the role is loaded.

`access.ts` was also aligned with the current workflow and explicitly includes `Procurement Officer` in the strict procurement workspace routes.

## Expected flow
1. Store Keeper forwards `R-xxxxx`.
2. Procurement Manager/Officer opens **New Store Requisitions**.
3. The original `R-xxxxx` appears in the list.
4. Procurement selects supplier/current price for each item.
5. After all lines are allocated, the requisition moves to **Prepare LPO**.
6. LPO then proceeds to Finance and General Manager approval.

## Validation
- Changed TypeScript/TSX files were transpiled with TypeScript 5.8.3: zero syntax diagnostics.
- Backend role specification confirms Procurement Manager has `supplieritemprice` view/change and requisition item CRUD through the fixed role template.
- No database migration is required.
