# Hotel ERP — Finalisation: Historical Inventory GL export and permissions

The revised GL export now includes balanced, historical-cost StockLedger consumption, POS COGS, waste and stock variance rows. It deliberately excludes GRN receipts, supplier-return credits and transfers to prevent double-counting against supplier-side accounting.

## Finance correctness
- The source is the immutable stock ledger cost snapshot; present-day average cost is never substituted.
- Missing valuation or a required GL mapping blocks the entire export. No partial CSV can be created.
- The fiscal period is re-read and locked. The exported CSV has a SHA-256 checksum and repeat requests return the same export where the payload is unchanged.
- CSV export does not itself book an entry into a third-party accounting package. A complete accounting integration still requires provider-specific posting acknowledgments and reconciliation evidence.
- Access to CSV, list and detail is Financial Manager only, in addition to the existing property scope.

## Tests and operational signoff
- Automated tests cover balanced stock journals, excluded GRN receipts, idempotence, missing-cost fail-closed behavior and non-Finance GL access rejection.
- Record the deployed SHA, real ten-role acceptance, live financial mapping review, 4-decimal base quantities, backup and restore evidence, end-to-end interface screenshots and the external accounting posting acknowledgment before calling the hotel project 100% complete.
- Existing UI files on the latest customer commit are preserved in this backend-only change.
