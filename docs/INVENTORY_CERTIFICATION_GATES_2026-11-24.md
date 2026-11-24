# Inventory & Cost Control — Formal Certification Gate Register

**Prepared:** 24 November 2026
**Repository:** Tafiti-Automate/Hotel-Management-System
**Release baseline:** `back$front` at `488c5ef3d44b24bcc872dddc7081a60b7ec52093`
**GitHub branch state:** UNCHANGED. No branch push until all stages complete and approved.
**Status:** NOT CERTIFIED. This register records source review and staged, unexecuted corrections, not staging/user acceptance.

## Certification scope and use of Oracle references

The target is an internally certified **Hotel Inventory & Cost Control System**, assessed against the client's Materials Control reference workflows. This is **not** an Oracle-issued certification, trademark license, or declaration that every Oracle feature is replicated.

**The client's binding receiving decision:** when the Receiving Clerk completes a valid blind count and inspection, accepted goods must immediately post to Stock on Hand in the same atomic transaction. Rejected goods must not increase stock. The Store Keeper reviews GRN evidence and operates returns/transfers, but a second posting is not mandatory for an accepted live receiving transaction. Direct-to-department receipts are consumed directly and must not inflate store stock.

## Stage A — code and migration release gates — BLOCKED

- [x] Read latest CI and deployment evidence. Vercel frontend/backend success for baseline; GitHub Django CI failed (509 passed, 12 failed).
- [x] Distinguish ten Materials Control roles from 12 expanded ERP roles (HR Manager and Payroll Officer included).
- [x] Stage fixes for GRN owner authorization using the requisition property even when the LPO header store is empty.
- [x] Stage source-store and cross-property guards for legacy supplier returns and Store Keeper return requests.
- [x] Stage test fixes for API UUID presentation and payroll XLSX numeric page-size normalization.
- [ ] Execute the full Django, TypeScript, frontend unit and production build checks against the **staged changes**. No green result currently exists for them because they have not been pushed or deployed.
- [ ] Reconcile the outstanding `SupplierReturnRequest.created_by` migration drift. Do not apply unverified migrations to the live database.
- [ ] Obtain migration, PostgreSQL restore, 4-decimal baseline and period lock evidence for the tested SHA.
- [ ] Zero critical/high defects; green all mandatory checks.

## Stage B — physical inventory, stores and procurement — NOT SIGNED OFF

Required witnessed scenarios, including four-decimal base quantities and negative permission tests:
1. PO 10.0000, receive 10.0000, accept 8.0000, reject 2.0000. SOH and the GRN ledger increase by exactly 8.0000, once; supplier rejection evidence preserved.
2. PO 10.0000, accepted partial 5.0000, remaining five units receivable without duplicating stock or delivery note.
3. Duplicate supplier delivery note / duplicate GRN posting blocked, even on concurrent requests.
4. Correct per-line store destinations when the PO header has no store.
5. Separate receiving property/owner access, blind counts and read-only post-lock LPO comparison.
6. Store issues, FEFO batches and signed department pickup reconcile to reservations, WAC snapshots and ledger.
7. Two-store approved transfer: dispatch reduces source once, virtual transit recorded; receipt increases destination once, with source cost preserved.
8. Supplier returns from Store Keeper reports, independent Cost Control review, quarantined quantity release/deduction, supplier credit reference, independent property isolation.
9. Blind physical stocktake, frozen theoretical snapshot, independent Finance approval, stale-count block, single variance posting.
10. Reconciliation of opening stock + accepted receipts + returns in + transfers in − issues − transfers out − supplier returns − POS/recipe use − waste ± approved adjustments = closing SOH.

**Required evidence:** transaction IDs, four-decimal expected/observed quantities, monetary valuations, actor, test property, screenshot/API response and ledger records.

## Stage C — financial and cost control — NOT SIGNED OFF

- [ ] Weighted-average cost and batch valuation reconcile per store/article after full, partial and rejected receipts.
- [ ] Recipe yield/conversions and POS sales depletion produce COGS and stock ledger once, with idempotent import.
- [ ] Three-way LPO/GRN/invoice matching, supplier credits and GRNI accrual/clearing by period are documented and matched.
- [ ] Department consumption is expensed to the right cost centre; returns and wastage valued from immutable snapshots.
- [ ] Finance verifies balanced journals, correct mapping, valid period and repeat-export checksums.
- [ ] If an external GL integration is contracted, obtain the accounting package's **posting acknowledgment and reconciliation**; a CSV preview alone is not sufficient.
- [ ] Closed fiscal periods reject backdated operational postings and unauthorized adjustments.

## Stage D — witnessed user acceptance and reliability — NOT RUN

- [ ] Staging environment uses a restored, anonymized database and approved schema, never uncontrolled production modifications.
- [ ] Ten inventory/procurement role accounts have the correct property and store assignments. Full ERP audit separately addresses HR and Payroll accounts.
- [ ] Positive/negative tests cover System Administrator, Department Supervisor, Department Head, Cost Controller, Store Keeper, Receiving Clerk, Procurement Manager, Financial Manager, Accounts Payable Clerk and General Manager.
- [ ] At least two independent test properties; no unauthorized inter-property reads or writes.
- [ ] Concurrent duplicate receiving, transfers, stocktake, fiscal close and posting attempts tested.
- [ ] Real PostgreSQL migration, backups and **restore** verified before signoff.
- [ ] Screens, GRN/return vouchers, approved PDFs, CSV, exports, errors, keyboard accessibility and dark mode accepted per role.

## Stage E — certificate and final GitHub release — BLOCKED

**Release conditions (all required):**
- [ ] Every relevant automated job passes on the exact source SHA.
- [ ] All mandatory B/C/D scenarios pass, with zero unexplained differences.
- [ ] Zero unresolved critical/high security, inventory or accounting defects.
- [ ] Stores, Receiving, Procurement, Cost Control, Finance and an authorized client representative have signed the evidence register.
- [ ] Backup/restore and rollback evidence is retained; production release documented.
- [ ] No unapproved Oracle branding or claim of Oracle's official certification.
- [ ] Only after the above: create **one consolidated commit and push** to `back$front` and verify deployment; do not push intermediate fixes or branches.

**Owner signoff (intentionally blank):**
- Receiving Clerk: __________ Date: ________
- Store Keeper: __________ Date: ________
- Procurement Manager: __________ Date: ________
- Cost Controller: __________ Date: ________
- Financial Manager: __________ Date: ________
- General Manager / Client: __________ Date: ________
- Technical Lead / Independent Auditor: __________ Date: ________

## Notable scope risks and exclusions requiring client confirmation

- Separate daily fresh-produce **Market List** workflow remains open in prior audits.
- Inter-hotel stock transfer accounting is not enabled as a general-purpose workflow.
- Barcode/mobile scanner acceptance is not established.
- Live third-party GL posting is not established; existing GL exports are not independently booked.
- Existing legacy supplier-return records are controlled by Cost Controller, while the new Store Keeper **report** → Cost Controller **approval and dispatch** process is separate; users must accept that segregation before certification.

No checkbox above may be marked PASS solely because code or tests exist. Staged changes have not been validated by GitHub Actions and this register is **not** an issued certificate.


## Unpushed implementation candidate — review pass (24 November 2026)

**Staged only:** proposed source changes live in an unreferenced Git tree, not a
branch commit. The production and `back$front` branches remain untouched.
Nothing listed below is a verified live system behavior until the checks run.

### Stage A source corrections prepared

- Add separate `--materials-control` readiness audit of the ten inventory
  roles, retaining all 12 expanded ERP roles in the default audit.
- Correct GRN owner/property checks where the PO header has no store.
- Correct supplier-return checks to use actual posted GRN line destinations,
  with same-hotel and hotel-less branch isolation.
- Correct stale UUID type and payroll paper-size test expectations.
- Require a **configured OPEN fiscal period** before a Receiving Clerk's
  accepted delivery auto-posts; missing-period and closed-period handling must
  pass staging tests. **Production must be checked for fiscal-period setup
  before merging this stricter control.**
- Known migration blocker remains: `SupplierReturnRequest.created_by` is
  reported by `makemigrations --check` as an outstanding AlterField. Do not
  invent or apply a migration without generating and reviewing its exact diff
  on the restored staging database.

### Stage B inventory integrity prepared

- Entirely rejected GRN lines record locked inspection evidence but **never**
  create on-hand, batch, ledger, WAC or direct department consumption.
- Approved transfer receipts fail closed when source dispatch ledger quantity
  or immutable valuation cannot be reconciled to transfer items.
- Transfer dispatch blocks missing/zero source WAC **before** removing stock;
  zero-cost supplier samples require a separately approved valuation policy.
- `audit_grn_posting --json --strict` compares each posted GRN's accepted
  quantity and historical cost with matching immutable receipt-ledger rows and
  direct departmental consumption, without mutating records.
- `audit_inventory_precision` includes supplier-return quarantine quantities
  in the checksum and rejects balances whose combined reservations and
  quarantines exceed physical on-hand stock.

### Stage C–E gates still open

- GRNI by fiscal period, actual external accounting booking/acknowledgment
  (if included in contract), and independently reconciled supplier credits.
- Real staging/PostgreSQL restore and migration test, concurrency and
  full receiving/transfer/stocktake/POS/GL witnesses.
- Ten-role positive and negative browser/API tests, independent role signatures,
  release SHA evidence and management acceptance.

**Never certify or push based only on staged source.** Prior baseline (488c5ef):
509 Django tests passed, 12 failed, plus a procurement migration check failure.
No staged code build, PostgreSQL migration execution or staff UAT has yet run.

### Read-only staging audit commands

On an authorized, restored and isolated hotel test database (not production):

```bash
python manage.py audit_inventory_precision --json --strict
python manage.py audit_grn_posting --json --strict
python manage.py audit_role_readiness --materials-control --json --strict
```

Record actual command output, relevant per-store/item ledger IDs, tested release
SHA and reviewer. The read-only GRN audit validates **receipts to ledger**, not
opening balance + all movement types to closing SOH. The latter must be
independently reconciled from a known opening snapshot before certification.
