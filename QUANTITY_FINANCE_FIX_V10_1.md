# Tafiti Hotel — LPO Quantity & Finance Review Fix V10.1

## Fixed issues

### 1. LPO quantity no longer becomes a fractional supplier pack
The requisition/LPO quantity now stays in the Article's request/base UOM.

Example:
- Department / Store Keeper quantity: **1 Ream**
- Supplier quotation: **UGX 97,500 per Carton**
- Conversion: **1 Carton = 5 Reams**
- LPO: **1 Ream × UGX 19,500 = UGX 19,500**

The supplier quotation remains stored at UGX 97,500 per Carton for price-history/audit purposes.

Migration `procurement.0026_normalize_open_lpo_base_uom` repairs unfinished existing allocations and LPOs. Issued supplier-facing LPOs are deliberately not rewritten.

### 2. Financial Manager can actually review the LPO
A Financial Manager clicking an LPO from the authoritative approval inbox is now always opened in the Finance review stage rather than being misclassified as General Manager review.

Finance can:
- see Procurement quantity and LPO amount;
- retain the quantity;
- reduce the quantity (reason required when reduced);
- save the quantity decision;
- approve and send to the General Manager;
- reject with a reason.

The first pending Finance LPO is opened automatically to reduce unnecessary clicks.

### 3. Approval timeline is sequential
While Finance is pending, the General Manager step displays as waiting rather than appearing as another simultaneously active pending decision.

## Validation
- `npm run build`: PASS (`tsc -b && vite build`, 69 modules transformed)
- Python source compilation: PASS (261 Python files)
- `vercel_build.sh` shell syntax: PASS
- Regression test source added for a 1-Ream request against a 5-Ream Carton supplier quotation.
