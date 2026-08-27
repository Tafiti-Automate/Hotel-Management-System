# Tafiti Hotel V10.5 — Store Keeper post-GRN completion fix

## Client rule
The Store Keeper acts once on an HOD-approved Department requisition: select the destination store, confirm/reduce the quantity, and forward it to Procurement. Receiving a supplier delivery later must not reopen the same requisition for another Store Keeper decision.

## Fix
- Added `completed` to Department requisition statuses.
- A fully received linked Procurement requisition now closes the original `R-xxxxx` request as `completed`.
- Partial deliveries leave the original request at `awaiting_procurement` until the remaining approved quantity is received.
- GRN posting no longer changes a requisition back to `submitted` / `Pending Store Keeper`.
- The Store Keeper receives an informational receipt notification only; no action is requested.
- Migration `inventory.0024_complete_received_department_requisitions` repairs already-reopened production requests and deletes only their obsolete stock-decision notifications.
- Existing request, HOD, Store Keeper, Procurement, LPO, Finance, GM, supplier and GRN history remains intact.

## Resulting flow
Requester → HOD → Store Keeper → Procurement → Finance → GM → Supplier → Receiving/GRN → Department Requisition Completed.

There is no second Store Keeper approval/reservation/pick/issue step in this client workflow.
