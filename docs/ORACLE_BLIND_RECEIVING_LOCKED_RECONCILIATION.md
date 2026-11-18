# Oracle-style receiving: blind count → locked reconciliation

The receiving screen operates in two controlled stages.

## Stage 1 — Physical blind count

The assigned Receiving Clerk opens **Ready LPOs → Review & Receive** and
records actual delivered quantities, any rejected quantities and inspection
reasons, supplier reference, batch/lot, expiry and HACCP temperature. The UI
and purchase-order-item serializer conceal approved, outstanding and ordered
quantities and all supplier costs during this stage. Commercial LPO PDF
preview is explicitly forbidden to noncommercial receiving users.

`POST /api/v1/purchase-orders/<id>/receive-delivery/` saves an atomic GRN,
inspection and immutable physical count. A short-delivery explanation is **not**
required before saving because that would leak the ordered quantity through
server-side validation. An optional supplier note can be supplied, but the UI
now requests any variance explanation **after** the count is locked.

At commitment time `GoodsReceiptNote.blind_count_locked_at` is set. The GRN
status becomes `received`. Stock does **not** increase; Store Keeper posting
remains an independent action. Persisted locked count lines, inspection
decisions and the GRN header cannot be silently changed through the normal
CRUD routes or the model save path. The internal inventory-posted flag remains
updatable by the verified posting route without changing counted values.

## Stage 2 — Server-side quantity reconciliation

`GET /api/v1/grns/<id>/blind-reconciliation/`

Available only to the **active Receiving Clerk who recorded that GRN**, after
`blind_count_locked_at` is committed, in the correct branch/property.
A before-lock attempt is rejected. The report computes, for **every LPO
article**, ordered quantity, prior committed quantities from earlier GRNs,
quantity due before this delivery, actual blind count, accepted quantity,
rejected quantity, shortage, excess and remaining after inspection. No supplier
price, PO value, unit cost, tax or financial information is returned.

The screen opens the read-only reconciliation immediately after successful
save, without requiring the clerk to navigate to another module. It also
remains available from GRN History for newly locked receipts.

`POST /api/v1/grns/<id>/variance-note/` records **one** immutable-explanation
entry for a GRN with a variance, with a hash-chained AuditLog record. It cannot
change quantities or be resubmitted to overwrite the explanation. Further
quantity disagreements must be resolved through Store Keeper/Cost Control and
a documented correction workflow; the UI intentionally has no "edit count"
action.

## Security and release acceptance

- Compare the pre-lock hidden PO-line API and PDF preview permissions.
- Verify after-lock comparisons across partial deliveries, zero-received
  Articles, rejections, a second Receiving Clerk and another property.
- Verify API update/delete, ORM count changes and GRN cancellation are blocked.
- Verify Store Keeper can independently post only accepted stock to inventory.
- Apply migration `procurement.0037` to a restored staging PostgreSQL
  database after backup verification. Deployments do not prove migrations ran.
- Run automated backend/frontend CI and ten-role UAT before sign-off.

Legacy GRNs without a committed `blind_count_locked_at` retain their existing
read-only receipt preview. They are **not** misrepresented as independently
locked blind counts.

**Not implemented here:** an independent controlled correction/reversal
document wizard, historical backfill, live UAT sign-off, or production migration.
