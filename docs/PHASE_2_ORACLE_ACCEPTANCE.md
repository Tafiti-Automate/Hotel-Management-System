# Phase 2 — Oracle Materials Control operational acceptance gate

**Branch:** `back$front`  
**Baseline reviewed:** 18 November 2026  
**Status:** Source-level checks are passing; live end-to-end acceptance is **NOT SIGNED OFF**.

## Scope and evidence hierarchy

The hotel project follows the client-supplied Oracle Materials Control target for procurement, stores, inventory, suppliers, invoice controls, costing and separation of duties. The historic MICROS-Fidelio screens are a workflow/ergonomics reference, not an authorization to copy the proprietary application.

Evidence must be distinguished:

- **SOURCE:** code, serializers, migrations or automated tests exist.
- **CI:** branch build, Django tests, TypeScript, frontend tests and build succeed.
- **STAGING:** a real deployed frontend and API complete the transaction with named authorized testers, screenshots and database/audit references.
- **SIGNED OFF:** Finance, Stores, Procurement, Cost Control and the client accept the witnessed results.

A passing CI run proves only the CI level. Do not claim 98–99% or Oracle parity until the remaining evidence is recorded.

## Mandatory end-to-end witness (single connected transaction)

Use a **non-production hotel/property** with a configured accounting period, UOM, supplier quote and role assignments. Use original document identifiers in the evidence sheet; do not put passwords, staff personal data or bank details in Git.

| Step | Actor | Positive acceptance | Mandatory denial / reconciliation |
|---|---|---|---|
| 1. Department store requisition | Department Supervisor | Draft, lines, submit and request history saved | Requester cannot approve own request or increase submitted quantities |
| 2. Department approval | Department Head | Reductions and comments are preserved separately from original quantity | Unauthorized department or higher-than-requested approval denied |
| 3. Cost control and shortage handoff | Cost Controller, Store Keeper | Approved demand, reservation, shortage and linked purchasing request agree | No silent stock adjustment or cross-store access |
| 4. Vendor quote and source approval | Procurement Manager, delegated approvers | Supplier, quote, validity, unit conversion, budget/threshold decision and audit trail | No self-approval or unauthorized supplier-price edits |
| 5. Purchase order | Procurement Manager | Approved LPO retains requisition links, quantities, destinations and approved price | Duplicate or premature LPO issue blocked |
| 6. Physical receiving and inspection | Receiving Clerk | Blind count and inspection evidence retained; accepted/rejected amounts distinct | No confidential commercial price access or other property's GRN edits |
| 7. Stock receipt | Assigned Store Keeper | Verified GRN increases the correct store stock **once** and writes immutable ledger/WAC snapshot | Inactive accounts, unassigned stores, early posting and duplicate posting blocked |
| 8. Invoice and three-way match | Accounts Payable Clerk | PO, accepted GRN, invoice lines and amounts agree | Incorrect quantity/price and duplicate invoice blocked |
| 9. Approval and payment | Independent AP actor(s) | Approval, partial and final payment history, outstanding balance and control actor saved | Maker–checker conflicts, overpayment, re-posting blocked |
| 10. Finance close and exports | Financial Manager | Fiscal close, balanced exports, immutable historical postings and GL checksum witnessed | Backdating into closed period and unauthorized finance access blocked |

Repeat with a *second property* and an unauthorized user to prove cross-property separation for at least GRNs, balances, invoices, and finance reports. Repeat with a partly rejected delivery and a direct-to-workspace receipt (which must not increase store SOH).

## Additional control witnesses

1. Outlet store issue / transfer / pickup acknowledgment: movement ledger and virtual-transit balances reconcile; FEFO and expiration rules hold.
2. Recipe, POS sales depletion, waste and COGS: source quantity and cost reconcile to the stock ledger, and imports do not duplicate postings.
3. Blind stock count: theoretical quantity frozen; count edits locked after submit; independent variance approval and posting; resulting GL evidence.
4. Ten canonical roles: for each role, record permitted page (200), denied action (403 or 404), property scope, and actual permitted mutation.
5. Documents and navigation: invoices, requisitions, GRNs, history and relevant report drilldowns survive reload and reflect the actual backend statuses.
6. UI feedback: success notices only follow successful server commits; warnings and deletion dialogs identify the affected record; unauthorized and validation errors are actionable.
7. Exports: compare screen, CSV, printable output, GL totals and bank reconciliation against source transactions.

## Deployment preflight (read-only)

Once the release SHA and deployment environment are confirmed, an authorized operator may run from the deployed backend:

```sh
python manage.py audit_role_readiness --json --strict
```

This does not provision users, touch stock or certify their permissions. Ensure approved backups and deployment change control before any database migrations or role setup.

## Evidence record for each row

| Field | Required value |
|---|---|
| Environment and frontend/backend release SHA | Actual staging deployment, not assumed from GitHub CI |
| Property, role and scenario | Authorized operator role and approved test property |
| Source and resulting document IDs | Store request / PR / LPO / GRN / invoice / payment / ledger / export |
| Expected and actual quantities | Original, approved, received, accepted, rejected, issued, invoiced and paid, as applicable |
| Expected and actual monetary amounts | Order, received valuation, WAC, invoice variance, payment balance and journal debit/credit |
| Positive / negative HTTP and UI outcomes | With dates and screenshots or secure logs |
| Independent review | Store, Procurement, Cost Control, Finance and client testers as appropriate |
| Result | PASS, FAIL, BLOCKED or NOT RUN; a blocker has an owner and follow-up issue |

## Known release blockers as of this baseline

- **No staging acceptance evidence available here:** actual deployed URLs, deployed SHAs, role-assigned accounts and witness records have not been provided to this audit.
- **Four-decimal base-unit precision is not certified end to end:** some inventory balance/ledger and API quantity fields still have 2-decimal constraints. This requires a coordinated migration, conversion contract and reconciliation, not a cosmetic input-field change.
- **Accounting handoff:** GL export is evidence for an external accounting package; booked external GL import, reconciliation and bank-side confirmation remain to be witnessed.
- **Browser and report coverage:** role-by-role navigation, cross-property data and report/export parity remain unverified in live staging.

## This hardening pass

Inactive accounts are denied GRN evidence and Store Keeper verification/posting even with a previously authenticated request context. The regression test also demonstrates that after the account is reactivated, the authorized Store Keeper can still complete a one-time GRN posting.

Do not push a new deployment for every test step. Consolidate fixes, pass the GitHub code checks, then perform one controlled staging deployment and record results.
