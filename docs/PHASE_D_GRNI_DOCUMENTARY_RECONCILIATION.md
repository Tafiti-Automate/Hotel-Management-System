# Phase D increment: GRNI documentary reconciliation (read-only)

**Branch**: `back$front`
**Scope:** Finance access, posted receiving valuation, matched supplier invoices,
and clear documentation of unposted exposure.

## What is implemented

The Financial Manager month-end closing wizard now has a new step 2:
**Goods Received Not Invoiced reconciliation**.

`GET /api/v1/fiscal-periods/<uuid>/grni-reconciliation/`

The Finance-only endpoint uses the same property-scoping and role checks as
the existing fiscal-period controller. It retrieves **posted GRN lines** with
accepted inspection quantities and frozen LPO base-unit cost, restricted by
the fiscal period branch and receipt/posted date. It compares these against
existing matched/approved/paid invoice evidence with the applicable dates.

- For line-item invoices, matched value is the invoiced base quantity
  multiplied by its approved purchase-order base-unit cost (no current supplier
  catalogue rates).
- An unambiguous single header-only matched invoice may cover a whole LPO.
- Ambiguous or repeated header-only invoice allocations, supplier returns,
  missing historical posting dates and overmatching produce explicit review
  warnings. Such warnings mean Finance must **not** treat the result as a
  verified final account balance.
- The result gives the LPO/supplier/cost center, GRN count, accepted base
  quantity, received value, invoiced value, estimated unmatched exposure,
  and exception list.
- No financial postings, GRNI accruals, debit/credit journal rows, ledger
  state transitions or production migrations occur from this endpoint.

## Critical accounting boundary

**This increment is not complete GRNI accounting.** The current supplier
invoice record does not retain a complete immutable timestamp of each
three-way matching state change. The report is therefore a **current-state
documentary reconciliation**, not an independently verifiable as-of
historical subledger. Matched invoices and supplier returns processed after
the date may affect apparent historical positions and require Finance review.

Next implementation must introduce financially sound, immutable accrual and
clearing entries, historical posting evidence, independent approvals and
atomic idempotent external-GL reconciliation. It must distinguish direct
delivery expense from store-asset GRNI treatment without duplicating invoice
stock valuation. Do not automatically generate or post journal entries merely
because this report has a numeric difference.

## Acceptance

- Verify zero posted receipts, a posted partially invoiced GRN, a fully
  matched invoice, an unvalued or anomalous receipt and a return.
- Verify Accounts Payable, Store Keeper and System Administrator cannot use
  the Finance-only endpoint; an authorized Finance user may view only
  eligible property data.
- Verify no GLExport, inventory movement or supplier invoice is written.
- Verify the month-end page renders GRNI figures and exception notes,
  and the full Django/Next.js CI passes.
- Run live, cross-role tests on a **restored PostgreSQL staging database**,
  with an independently verified backup and reconciliation records.

The Stores and Procurement modules are not signed off as fully complete:
physical count freezes, inter-hotel logistics, supplier debit-note clearing,
receiving quality exceptions, and realistic multi-user UAT remain open.
