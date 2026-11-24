# Inventory Certification — Witness Script & Sign-off Sheet

**Status:** NOT EXECUTED / NOT CERTIFIED. This is a test script, not a release certificate.
**Published code baseline:** `488c5ef`. Staged fixes are UNPUSHED and unvalidated.

## 1. Preconditions (block if missing)

- Approved isolated **staging** frontend/API and PostgreSQL instance restored
  from verified backup, with no real financial/production side effects.
- Record tested frontend/backend build SHA, schema migration state and backup
  restore checksum. Confirm valid OPEN fiscal periods for tested properties.
- Two hotel properties A/B; each role has a distinct authorized user.
- 4-decimal stock ledger and batch balances agree with opening valuations.
- Run `makemigrations --check --dry-run` and complete Django + Next.js tests.
  No open critical/high defects may remain.

## 2. Transaction witness matrix — enter actual references

| ID | Role | Transaction / expected result | Evidence ref | Observed | Status | Reviewer |
|---|---|---|---|---|---|---|
| INV-01 | Department Supervisor → Head | Request, revise, approve; no self-approval | — | — | NOT RUN | — |
| INV-02 | Procurement → Finance → GM | RFQ, LPO, thresholds, UOM and locked price | — | — | NOT RUN | — |
| INV-03 | Receiving Clerk | Count 10, accept 8, reject 2; SOH increases 8 once on confirmation | — | — | NOT RUN | — |
| INV-04 | Receiving Clerk | Accept a 5/10 partial; LPO outstanding 5; later second GRN | — | — | NOT RUN | — |
| INV-05 | Receiving Clerk | Full rejection records GRN; SOH, ledger, batch and consumption unchanged | — | — | NOT RUN | — |
| INV-06 | Receiving Clerk | Repeated delivery note and concurrent duplicate submission rejected | — | — | NOT RUN | — |
| INV-07 | Receiving Clerk | No/open/closed fiscal period; only OPEN may post accepted stock | — | — | NOT RUN | — |
| INV-08 | Store Keeper / Cost Controller | FEFO issue, signed departmental pickup and accurate value | — | — | NOT RUN | — |
| INV-09 | Store Keeper destination | Approved transfer dispatch, virtual transit, cost-preserving receipt once | — | — | NOT RUN | — |
| INV-10 | Store Keeper / Cost Controller | Return report, quarantine, approval, vendor dispatch, credit note evidence | — | — | NOT RUN | — |
| INV-11 | Store Keeper → Finance | Blind physical stocktake, frozen count, variance approval and single posting | — | — | NOT RUN | — |
| INV-12 | POS / Cost Controller | Recipe sales depletion, idempotent import, correct food cost | — | — | NOT RUN | — |
| INV-13 | Accounts Payable / Finance | PO/GRN/invoice three-way match; GRNI and supplier credit reconciliation | — | — | NOT RUN | — |
| INV-14 | Financial Manager | Balanced GL, period close, backdating rejection, external ACK if contracted | — | — | NOT RUN | — |
| INV-15 | All ten inventory roles | 200 permitted/403 denied, two-property isolation, evidence on screens/printouts | — | — | NOT RUN | — |
| INV-16 | Technical lead | Restore drill, performance/concurrency, duplicate-safe recovery | — | — | NOT RUN | — |

## 3. Reconciliation formulas

For each store and article at **four decimal places**:

```
Closing SOH = Opening SOH + accepted GRNs + transfer receipts
            + eligible department returns + approved positive adjustments
            - store issues - transfer dispatches - supplier returns
            - POS recipe depletion - waste - approved negative adjustments

Available SOH = Closing SOH - reserved quantity - quarantined quantity
```

Do not treat a "posted" GRN with zero accepted quantity as positive stock.
Direct-to-department GRN consumption must not increase store SOH.

For each priced receipt:
```
New WAC = (Opening Quantity × Previous WAC + Accepted Base Quantity × Approved Base Unit Cost)
          / (Opening Quantity + Accepted Base Quantity)
```

Historical receipt, issue and transfer monetary values must reconcile to
immutable ledger price snapshots. Allow only published 4-decimal rounding
differences; no unexplained discrepancy is acceptable.

## 4. Required outputs and reviewers

Attach (in secure project records, not credentials in Git):
- Input source document, user role, timestamp and test branch.
- Resulting GRN/LPO/issue/stocktake IDs and WAC ledger rows.
- Screen/PDF/CSV/GL comparisons and rejected-action evidence.
- Backup/restore and migration checks.
- Written independent Stores, Procurement, Cost Controller, Finance and
  client sign-off. Leave blank until actually witnessed.

**Release rule:** Only after every mandatory row is PASS, all code/migration
checks are green and client/Finance witnesses sign may one consolidated push
to `back$front` be authorized. This report is not an Oracle-issued
certification or a claim of Oracle product parity.
