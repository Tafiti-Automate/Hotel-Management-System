# Phase 1F: guest folio and cashier custody foundation

A front office employee with the required model permission may open a unique,
property-scoped folio for a **checked-in** guest. Retries return the same folio.
The folio does not yet contain accommodation/POS charges or payments.

An assigned Cashier may open one active till session, recording opening cash
float and ownership. Duplicate shifts, cross-property/outlet access and
non-cashier posting are blocked. Closing and all tender posting remain disabled.

The guest folio exposes balance=null: no journal yet exists to prove a zero balance.
**Never treat this null as proof of payment or permit checkout on this basis.**

These APIs do not call Sale.complete_sale, CashFlow, CustomerLedger,
StockLedger, guest-folio charge posting, refunds or POS settlement. Existing
Materials Control remains unchanged.

NEXT: implement the idempotent folio journal, tax, approved accommodation rates,
cashier tender allocations, recipe depletion, refunds, and exact-once GL posting;
only then enable room charges and final guest checkout.

Deployment: one consolidated branch commit, full GitHub Actions verification.

## Phase 1F follow-up: custody-only cashier close

A cashier may close their own active assigned-outlet till with a counted amount,
optional handover note, recorded employee and timestamp. Repeated close is
rejected; unauthorized and cross-property access is blocked. Closing a till
is **not** settlement, cash variance reconciliation or revenue recognition.
The counted cash cannot yet be matched to expected tender totals because POS
payments and tender journals are not live. The UI/API must not label a closed
session as a reconciled shift. No guest checkout is enabled.
