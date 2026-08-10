# Commercial ERP hardening — implementation status

Budget control is intentionally excluded from this phase.

## Implemented in this package

- GRN posting now refuses to proceed until the receipt is inspection-ready.
- Cumulative receiving is checked against the outstanding LPO line quantity.
- Duplicate GRN item posting remains protected by row locks and the applied flag.
- Supplier payment posting now validates the current invoice balance while holding database locks, reducing concurrent overpayment risk.
- Store Request lists show article names and requested quantities, not only document references.
- Store Request detail records include requested, approved, issued and outstanding quantities.
- Status labels and colours use a single canonical frontend map.
- Record drawers no longer contain generic instructional wording.
- Existing search, status and date filters remain available on standard tables.

## Requires environment/UAT verification

- Complete role-by-role happy-path and negative-path UAT.
- Branch-isolation API tests for every sensitive endpoint.
- SMTP delivery and LPO resend verification.
- FEFO allocation against real batches and expiry dates.
- Notification deep links for every workflow event.
- Server-side global search across all document types.
- Mobile testing using actual phones/tablets.
- Full dark-mode visual regression testing.
- Route-level frontend code splitting.

A successful frontend build is included, but backend automated checks must be run in the project's configured Python virtual environment.
