# Receiving Clerk UI / Workflow V10.3

## Client workflow implemented

The Receiving Clerk now works from one simple flow:

1. Open **Receiving & GRN**.
2. Search the supplier delivery using the **LPO number printed on the supplier invoice** or filter by **supplier**.
3. Open the matching issued/partially received LPO.
4. Enter the **supplier invoice number** and received date.
5. For each LPO article, see the original LPO quantity, previously received quantity and outstanding quantity.
6. Enter only **Quantity received now** for the articles physically delivered.
7. Click **Generate GRN**.
8. The GRN is generated and posted; stock is updated for the actual received quantity only.
9. If the supplier delivered less than the LPO balance, the LPO remains under Ready LPOs as **Partial** for the later delivery.
10. The generated GRN remains under **GRN History**.

## UI changes

Removed from the Receiving Clerk UI:
- four KPI cards
- two-step workflow diagram
- Receive goods / Inspect tabs
- Ready LPO dropdown
- Draft GRN dropdown
- LPO item dropdown
- separate "Open GRN", "Record received quantity", "Start inspection", "Record decision" and "Post accepted goods" buttons

Added:
- Ready LPOs and GRN History tabs
- LPO/supplier search
- supplier filter
- full LPO receiving screen
- item-by-item ordered / previously received / outstanding / receive-now quantities
- single Generate GRN action
- persistent GRN history after the LPO becomes fully received

## Backend control

`POST /api/v1/purchase-orders/{id}/receive-delivery/`

The action is restricted to Receiving Clerk/System Administrator and:
- accepts only issued or partially received LPOs
- validates branch access
- validates invoice duplication and over-receipt
- creates the GRN and receipt lines atomically
- preserves the original LPO quantity
- creates the accepted inspection audit record internally
- posts the actual received quantity to inventory
- updates LPO status to partially received or fully received

No database migration is required for V10.3.
