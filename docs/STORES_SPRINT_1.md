# Sprint 1 — Storekeeper Fulfillment and GRN Posting

## Scope

This sprint connects the existing blind Receiving Clerk GRNs to Storekeeper
verification, posting to store stock, internal requisition dispatch and signed
Outlet Supervisor pickup. It does **not** implement Sprint 2–4 procurement,
recipes/POS or period-close redesigns.

## New authenticated screens

| Route | Role | Operation |
| --- | --- | --- |
| `/stores/grn-posting` | Store Keeper | Unposted GRN queue, PO vs counted/accepted comparison, post accepted goods |
| `/stores/transfers` | Store Keeper | Multi-select approved store requests, adjust quantities, print picking/packing, dispatch |
| `/transfers/incoming` | Department Supervisor | Verify dispatched issue and sign physical receipt |

All screens reuse the existing authenticated dashboard shell. Rights are checked
again on the Django API, including assigned issuing stores.

## API endpoints

- `GET /api/v1/grns/unposted-queue/` — received/unposted GRNs, LPO comparisons and fiscal-period status
- `POST /api/v1/grns/{uuid}/post-to-inventory/` — transactional Storekeeper-only GRN posting
- `GET /api/v1/store-requisitions/fulfillment-queue/` — assigned approved requests, base quantities and bin order
- `POST /api/v1/store-requisitions/dispatch-batch/` — one atomic transaction for 1–25 requisitions; body: `{"requests":[{"id":"<uuid>","quantities":{"<line-uuid>":"3.00"}}]}`
- `POST /api/v1/store-requisitions/{uuid}/dispatch-transfer/` — one request with the same quantities map
- `POST /api/v1/stock-issues/{uuid}/acknowledge/` — assigned Outlet Supervisor completes pickup; consumes the virtual transit holding

The old `stock-issues/{uuid}/apply/` API is routed through the same new
transit service, preventing a different UI from bypassing transit controls.

## Posting invariants

1. **Open periods required.** Configure a `FiscalPeriod` with `status=open`
   covering the GRN's receiving date before posting; current dispatch and pickup
   dates must also fall inside an open configured period.
2. **GRN to stock.** The system locks the GRN and stock position, posts only
   accepted Article base quantities and updates `InventoryBalance.weighted_average_cost`.
   Existing batch positions are used to backfill WAC during migration where costs
   are available. Unknown historical opening valuations are not invented.
3. **Transfer dispatch.** Storekeeper issues only Cost-Control-approved outstanding
   base quantities, within physical stock. Each dispatch writes an immutable
   source OUT and virtual-transit IN `StockLedger` row and reduces source
   SOH/reservations. No department consumption is recognized yet.
4. **Signed pickup.** Only the original requesting Supervisor can sign. The service
   locks the issue, debits transit, posts DepartmentConsumption using the recorded
   dispatch WAC, and records receiver + signature timestamp. A second signature
   cannot post a second consumption.
5. **Close guard.** A fiscal period cannot close with an internal issue still in
   virtual transit. Dispatch and pickup audit timestamps are preserved.
6. **Protected audit.** Dispatched vouchers and lines cannot be deleted or
   modified; the WAC, transit fields and receiver identities are API read-only.

The virtual location is an inactive `StoreLocation` named
`Virtual Transit Store — Internal Dispatch`, one per property. Inactive
locations do not appear in ordinary issuing-store pickers. The two ledger sides
allow an inventory auditor to reconcile physical source stock, stock in transit
and final department consumption.

## Deployment and checks

Run Django migrations on the database before using the new screens. Configure
an open fiscal period for each operating property and assign the Storekeeper
to the relevant issuing stores with `StoreKeeperAssignment`.

The sprint adds tests in `hotel_erp_backend/tests/test_department_supply_workflow.py`
for accepted GRN WAC posting, idempotence, issued-vs-transit balances,
signed pickup, period-close blockers and atomic batch rollback.

The full legacy Django test suite had existing failures in the preceding
commit. Any new CI report must distinguish those from Sprint 1 regressions.
