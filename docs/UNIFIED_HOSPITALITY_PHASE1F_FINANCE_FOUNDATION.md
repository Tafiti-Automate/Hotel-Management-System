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
