# Inventory accuracy — immediate accepted GRN posting and stocktake safeguards

**Branch:** `back$front` | **Implementation:** code-level; operational sign-off pending.

## Receiving and Stock on Hand — approved business rule

When the Receiving Clerk finishes a valid delivery with inspection, the system
**immediately and atomically posts accepted goods to Stock on Hand**. No second
Store Keeper posting is required.

- The physical count remains blind until saved and locked; the clerk can then
  compare with approved ordered quantities, but never sees commercial prices.
- Only accepted quantity increases stock, WAC and immutable stock-ledger rows.
  Rejected quantity is retained in the inspection evidence and excluded.
- Partial deliveries increase the received Store stock by the accepted partial
  quantity and leave the LPO balance eligible for later deliveries.
- The GRN, inspection, stock batch, stock ledger and balance are committed in
  one database transaction. Any failure rolls back all writes.
- Posted GRNs cannot be posted twice or have their physical lines silently
  modified. The originating clerk may add a single audited discrepancy note
  after the count locks, including after posting; financial amounts and stock
  quantities do not change.
- A separate Store Keeper posting console may handle legacy or manually
  entered unposted GRNs, but is not a mandatory step in normal receiving.

## Stocktake

- The backend compares the frozen theoretical count quantity with current
  Stock on Hand under row locks at variance posting. If the stock changed
  since the snapshot, it rejects the whole adjustment. A new count is needed;
  intervening stock movements must never be overwritten silently.
- The Store Keeper screen no longer offers a Finance-only approval control.
- Blind physical counters cannot view theoretical quantities or display fake
  calculated variances when the backend omits those fields.
- Input, validation and quantity display support four decimal places.

## Still open

Real user acceptance for full/partial/partly rejected deliveries and
duplicate prevention, transfer and supplier-credit reconciliation, inventory
GL posting, period-close controls, supplier return fixes, and role-by-role
negative permission testing. Full Oracle Hospitality parity is not certified.
