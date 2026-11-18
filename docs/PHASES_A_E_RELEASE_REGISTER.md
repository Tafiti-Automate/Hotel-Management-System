# Oracle Materials Control — Phases A–E delivery and acceptance register

**Working branch:** `back$front`  
**Reference:** client-supplied `Oracle_Materials_Control_Complete_User_Guide.pdf` and historical `screenshoracle.pdf`  
**Status:** Incremental implementation; NOT yet Oracle-equivalent or production-accepted.

The reference requires seven invariants: segregation of duties, store assets versus departmental expense, virtual transit, four-decimal base-unit quantities, moving weighted-average cost, immutable booked documents, and fiscal locking. Never treat a menu item or a green CI job as evidence that all seven work correctly with real hotel transactions.

## Phase A — Financial and inventory controls

| Requirement | Current implementation / evidence | Remaining gate |
|---|---|---|
| Transfer bypass | Legacy `/stock-transfers/{id}/apply/` and misattached `assign-store` action removed. Model-level `dispatch(require_approval=False)` now still requires prior approval; compatibility booking requires approved + in-transit. | Run approved, rejected, duplicate, cross-property and two-store actor tests in staging |
| Transfer document locking | API headers and lines cannot be changed after approval/dispatch; status/approver/receipt fields are server-owned. | Independently approve cross-property business rules before enabling inter-property movement |
| Stock adjustments | Assigned Store Keeper drafts/edits lines and submits; Financial Manager independently approves/rejects; assigned keeper posts once during an open period. Cost Controller reviews evidence. Booking amount uses historical known WAC, not store-entered unit-cost claims. | Test real role accounts and reconcile stock ledger to GL |
| Four-decimal base units | Conversion factors and cost snapshots already support four decimals, but multiple quantity columns remain at two decimals. | **IMPLEMENTED IN CODE / AWAITING STAGING SIGN-OFF** — widened 58 quantity columns across inventory, procurement, sales, finance and materials-control; updated conversions, posting calculations, serializers and selected frontend quantity views. Historical monetary figures are not altered. Production migration and data reconciliation remain gated on a verified backup. |
| Closed-period and booked-document controls | Existing signals, blocked stock ledger edits and fiscal close checks; strengthened in earlier phases. | Verify every reversal, old-dated write path and correct handling of approved corrections under concurrency |

## Phase B — Procurement

| Requirement | Current implementation / evidence | Remaining gate |
|---|---|---|
| Supplier/RFQ quote workflow | Buyer proposes catalogue quotes; Cost Controller approves published prices. Requisition-level normalized RFQ comparison, qualified-bid thresholds, supplier award history, locked winning bids and role/property controls implemented in code. | Validate frontend award and monetary threshold policy with real Procurement, Cost Control and Finance staging users |
| Market Lists | Standard department/store requisitions and PRs exist. | **OPEN — separate daily fresh/perishable Market List workflow from agreed client reference** |
| Commercial approvals | Procurement → Finance → GM LPO approval route, quantity limits, supplier allocation and controlled print issue exist. | Positive/negative monetary-threshold, budget-override and supplier-award witnessed tests |
| Blind GRN / HACCP | Receiving role hides ordered prices/counts; tracked lot and expiry mandatory. New `requires_delivery_temperature` article flag makes observed delivery temperature mandatory on both API and UI for applicable articles. | Test actual chilled/frozen goods, full HACCP thresholds and quality rejection evidence |

## Phase C — Stores

| Requirement | Current implementation / evidence | Remaining gate |
|---|---|---|
| FEFO picking / expiry | Expiry-ordered batches, stock issues and virtual transit exist. | Verify oldest-expiring allocation, aisle-sorted picking / packing printouts |
| Outlet handover | Transit dispatch and signed pickup/acknowledgment logic exist. | Role-specific real stock-movement and cost-center evidence |
| Store-to-store transfers | Controlled approval → dispatch → destination receipt; legacy bypass disabled. | Same-hotel branch transfers supported; separate inter-hotel GL policy and unrelated-hotel transfers **NOT ENABLED** |
| Stocktakes | Read-only theoretical count snapshots, Finance approval, Store Keeper variance posting and audit exist. | Movement-freeze race tests, scanner entry, decimal bottle counts, variance reconciliation |
| Supplier/department returns | Return and supplier credit mechanisms exist. | Trace returned batch, supplier debit and stock valuation to GL |

## Phase D — Accounting

Existing invoice/GRN three-way match, partial payment, supplier credit note, fiscal period checks, inventory valuation previews and balanced, checksum-protected CSV GL export are supported by code/tests. **The following are not signed off:** explicit GRNI accrual/reversal by fiscal period, booked external accounting-system import, complete stock-versus-department P&L recognition, bank reconciliation and full monthly cost-center cost analysis.

Do not treat a balanced GL preview or CSV as proof that SunSystems/SAP/Sage/QuickBooks has posted the journal.

## Phase E — Ten-role UAT and release

- Automated code test coverage includes the canonical ten-role collection access contracts and selected denied actions, receipt/property restrictions, Finance controls, requisition approval, transfer valuation, supplier invoice matching and payments.
- This delivery adds negative transfer-bypass and adjustment maker/checker API regression coverage, and conditionally mandatory HACCP temperature receiving tests.
- Full ten-user browser UAT is **NOT RUN** until the actual staging frontend/backend release SHAs, real property-assigned accounts, seeded data and signed witnesses are available.
- Run the deployed read-only `python manage.py audit_role_readiness --json --strict`, then follow `docs/PHASE_2_ORACLE_ACCEPTANCE.md` for each transaction and denied action.
- Record request → approval → LPO → GRN → SOH/WAC → invoice → payment, outlet issue and pickup, stock count and variance, and fiscal close/GL evidence across at least two test properties.

## Controlled deployment

1. GitHub Actions Django checks/tests and frontend typechecks/tests/build must all pass on the exact branch SHA.
2. Obtain approved backups **before** applying schema migrations and role permission synchronization in an existing hotel database.
3. Release only the verified SHA to staging. Do not repeatedly push solely to trigger Vercel.
4. Collect independent Store, Purchasing, Cost Control, Finance and management UAT signoff before declaring feature or Oracle-equivalence completion.

**Important:** The user requested completion of all five phases. The changes in this increment are foundational controls and testing—not an assertion that all five phases are complete.


## Four-decimal schema migration safety and reconciliation (Phase A)

The migration batch updates numeric base quantities from `DECIMAL(12,2)` to
`DECIMAL(14,4)`, preserving the existing **ten integer digits**. Invoice
quantity variance is widened from `DECIMAL(15,2)` to `DECIMAL(17,4)`,
preserving thirteen integer digits. Monetary amounts and GL journal cents
retain their original two-decimal schema; WAC and historical valuation snapshots
retain four decimals. The migrations are **schema-only** and do not recalculate
historical quantities or prices.

**Required before deployment to a real hotel database:**

1. Perform and verify a restore-capable Neon/PostgreSQL snapshot, including
   migrations state and financial/stock tables. Do not run blindly in production.
2. Audit per-store/article opening stock and reservations, recorded stock-ledger
   movement totals, unmatched GRNs, transfers in transit, inventory batches and
   stocktakes. Export opening/closing stock valuations for comparison.
3. Test these five migration files against a restored staging database and then
   rerun the full branch suite and role permission synchronization.
4. Reconcile opening stock + recorded receipts - booked issues +/- transfers and
   adjustments = closing stock for each store/article at four-decimal precision;
   compare balances and inventory cost snapshots before and after migration.
5. Release only with Finance and Store Keeper signoff. **Decimals already rounded
   in older two-place database columns cannot be reconstructed by widening them.**

Files: `inventory/0034_four_decimal_quantities.py`,
`procurement/0035_four_decimal_quantities.py`,
`sales/0003_four_decimal_quantities.py`,
`finance/0008_four_decimal_quantities.py`, and
`materials_control/0007_four_decimal_quantities.py`.

## Staging migration evidence — operator procedure

This is an **operator-controlled staging activity**, not a permission to access the
production Neon database. The precision audit is strictly read-only with respect
to the database and intentionally excludes staff names, supplier contact details
and operational document descriptions. It hashes row identifiers and numeric
values only. The produced JSON is **not a database backup**.

Before any schema change, an authorized operator must create a verified,
restorable PostgreSQL/Neon backup or database branch. Use separate staging
database credentials and record the commit SHA for the tested release.

Run on the **restored staging database** from the hotel backend working directory:

```bash
python manage.py audit_inventory_precision --json --strict --write-baseline /secure/audit-before.json
python manage.py migrate --plan
python manage.py migrate
python manage.py audit_inventory_precision --json --strict --baseline /secure/audit-before.json
python manage.py audit_role_readiness --json --strict
```

The migration must not have other operational stock transactions between
the BEFORE and AFTER snapshots. A mismatched numeric checksum, any reserved
quantity exceeding on-hand, an overdrawn inventory batch, or an invalid ledger
movement is a blocker. Keep the BEFORE JSON independently; the audit refuses
to overwrite an existing file. Use environment-specific Django settings and
review deployment migration locking and maintenance windows before running.

A passing audit alone does not establish financial sign-off. Finance must still
review the opening and closing value reconciliation and unknown historical-cost
count. The test suite currently uses SQLite, so **PostgreSQL migration execution
against restored staging data has not been witnessed in CI**.

## Procurement RFQ comparison controls

The Procurement workspace now provides a requisition-specific comparison
of complete bids at the **same approved base quantities**, regardless of
supplier quotation UOM. An expired quote, incomplete quotation, inactive
supplier, invalid unit conversion or insufficient quoted quantity is not a
qualified bidder. Thresholds count **qualified vendors**, not the presence of
incomplete quotation records.

Only active, branch-assigned Procurement Managers may award, with a written
reason and audit event. Cost Control, Finance and Management can read eligible
commercial evidence within their hotel; Receiving and Department users cannot.
Awarded RFQ headers and lines cannot be rewritten after selection.

The workflow is not an automated purchase award: authorized Procurement must
select and justify the supplier. Article catalogue prices remain separately
approved by Cost Control. The distinct perishable Market List workflow is
**not implemented by this increment** and remains an open Phase B gate.
