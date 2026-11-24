# Backend CI remediation — 24 November 2026

Baseline c715dfe: 536 backend tests passed, 5 failed; frontend and both Vercel deployments passed. All month-end tests passed in that run.

* Two receiving regression fixtures posted without acceptance inspection. They now explicitly prove that uninspected posting cannot create ledger entries or apply stock, then create acceptance evidence and exercise the full GRN posting path. Partial receipt status and duplicate-post protection remain asserted.
* The Uganda demo seed now assigns explicit synthetic acquisition costs to its opening stock and records matching immutable ledger valuation snapshots. No existing live balances are backfilled. The demo seed regression verifies every opening stock valuation.
* The read-only Stock on Hand permission regression accepts a 403 permission rejection or 405 method rejection, and now independently verifies quantity and valuation did not change.
* The payroll XLSX test normalizes the absolute row reference returned by openpyxl without changing the workbook or its print layout.

No receiving, inventory authorization, WAC, or payroll production controls were relaxed. These source changes require a new CI run; client acceptance and isolated PostgreSQL reconciliation remain distinct release gates.
