# Department Head Approval UI V6

## Scope
This revision changes only the Department Head requisition approval experience. The procurement workflow and requester, Store Keeper, Procurement, Finance, GM and Receiving business rules are unchanged.

## HOD queue
- Page title is **Department Approvals**.
- Header states how many requests need attention.
- Removed the redundant `Pending approvals` tab.
- Removed the right-side approval panel and requisition dropdown.
- Queue shows only: requisition number, requester, date, item count/preview and **Review**.
- Removed progress graphics and repeated pending-status badges from the queue.
- Search now uses `Search requisition, requester or item...`.
- User-facing dates use a readable `25 Aug 2026` format.
- An empty queue shows `You're all caught up`.

## Review page
Selecting **Review** opens a dedicated decision view with:
- Requisition number
- Requested by
- Department
- Date
- Requested Articles
- Quantity
- UOM
- Item note

No supplier, price, store allocation, procurement or finance fields are shown to the Department Head.

## Decisions
- **Approve** opens a short confirmation only.
- Normal approval does not require a comment.
- **Reject** opens a dialog and requires a rejection reason.
- Successful approval returns to the pending queue and sends the requisition to the Store Keeper.
- Successful rejection returns to the queue.

## Responsive behaviour
The approval list and item review collapse to simpler layouts on smaller screens.

## Validation
- `InventoryWorkbench.tsx` was parsed/transpiled with TypeScript 5.8.3: zero syntax diagnostics.
- Full `npm ci` could not complete in the isolated workspace before timeout, so a fresh `tsc -b && vite build` should still be run by the deployment/CI environment.
