# Store Purchase Request Flow Audit

The Store Keeper replenishment workflow is wired as follows:

1. **Store Keeper creates a Store Purchase Request**
   - Source: `store_purchase`
   - Destination store is taken from an active Store Keeper assignment.
   - Request is created in `APPROVED` state so it enters Procurement sourcing directly.

2. **Procurement Officer / Procurement Manager receives the request**
   - Both roles are notified.
   - Procurement Workbench sourcing filters include `store_purchase`, `store_requisition`, and legacy `store_shortage` sources.
   - Procurement can review/reduce quantities and reject an individual line or the complete request.

3. **Supplier allocation**
   - Procurement selects an active supplier quotation maintained by the Cost Controller.
   - Procurement cannot override the quotation price.

4. **LPO preparation**
   - Procurement Officer / Manager can create the draft LPO.
   - Draft LPO quantities can be adjusted within the approved requisition balance.
   - Unit prices remain controlled by the supplier quotation.

5. **LPO approvals**
   - Level 1: Procurement/Purchasing Manager
   - Level 2: Financial Manager
   - Level 3: General Manager

6. **Supplier issue**
   - After final approval, Procurement sends the controlled LPO to the registered supplier email.
   - Successful issue changes the LPO to `ISSUED`.
   - Receiving Clerk is notified after the issue state is committed.

7. **Receiving Clerk**
   - The Receiving Clerk workspace includes `ISSUED` and `PARTIALLY_RECEIVED` LPOs for the same branch.
   - The clerk records delivered quantities and creates a GRN in `RECEIVED` state.

8. **GRN posting**
   - Posting remains a separate controlled action.
   - `Post GRN` applies accepted receipt quantities to inventory and updates LPO/requisition fulfillment state.

## Fixes in this release

- Added `store_purchase` to all Procurement sourcing/queue filters.
- Prevented Procurement Officer from calling the Purchasing Manager-only approval inbox.
- Removed the Store Keeper form statement about unavailable supplier/price fields.
- Simplified Store Purchase Request control notes and notifications.
- Added Receiving Clerk notification after an LPO is successfully issued to the supplier.
