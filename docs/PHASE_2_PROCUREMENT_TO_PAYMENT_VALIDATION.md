# Phase 2 — Procurement-to-payment functional validation

**Date:** 17 November 2026  
**Branch:** `back$front`  
**Status:** First implementation and API control pass; not yet live acceptance-certified.

## Reference workflow

Department request / requisition → Department Head review → procurement sourcing / supplier quotation → LPO authorization → receiving and inspection → GRN stock posting by Stores → supplier invoice three-way matching → independent approval → supplier payment → accounting reconciliation.

The prior reference audit maps these stages to the historical Materials Control manuals. This project retains its own modern Next.js interface and Django backend; passing source tests does not imply exact Oracle workflow parity.

## Audited implementation evidence

- Purchase requisitions and lines: `apps/procurement/views.py`, `models.py`, `transaction_controls.py`.
- Role-based LPO approval and requisition sourcing: `apps/approvals`, `apps/procurement/transaction_controls.py`.
- GRN reception and posting authorization: `GoodsReceiptNoteViewSet`, `GoodsReceiptItemViewSet`, `post_grn_to_inventory`.
- Three-way matching and invoice ledger: `apps/finance/models.py` (`SupplierInvoice.perform_three_way_match`, `SupplierInvoiceItem.invoiceable_base_quantity`).
- Payment authorization and idempotency: `SupplierPayment.post` uses row locks, approved status and outstanding balance checks.
- Frontend review: `EnterpriseInvoiceMatching`, `EnterprisePurchaseRequisitionBuilder`, `EnterpriseApprovalInbox` and procurement workspace.

## Confirmed defects corrected in this pass

1. **Invoice rematching after approval or payment.** `SupplierInvoice.perform_three_way_match` previously had no lifecycle status precondition and could rewrite approved/paid invoice status. It now accepts only `draft` or `exception`, leaving booked or paid documents locked.
2. **Payment action role authorization.** `match`, `approve-for-payment` and supplier payment `post` now require an active Accounts Payable Clerk and explicitly deny IT administrators/superusers. Existing independent approver and preparer checks in the models remain in force.
3. **Cross-property financial reads.** Supplier invoice, invoice-line and payment viewsets now scope queries to the assigned hotel via the purchase order's requisition branch; where no hotel is attached to the branch, access is scoped to that branch. Missing/inactive employee property assignment returns no records.
4. **Creation-path authorization and payment immutability.** Supplier invoice, invoice-line and payment creation now check Accounts Payable authority and the related purchase order’s property; invoices and payments cannot be inserted into an unauthorized hotel using known foreign-key IDs. Posted/cancelled payment amounts cannot be modified through normal PATCH/PUT.
5. **Receiving and supplier-return action controls.** The stand-alone GRN item `post-to-inventory` action was removed; inventory booking must use the authorized parent GRN lifecycle. Supplier-return headers and lines now require an assigned Receiving Clerk for creates/edits and post/acknowledge actions, scope reads by receiving ownership or property, and lock posted returns against edits.
6. **Tests:** `test_phase2_grn_line_posting.py` checks the removed item posting route and retained document posting route; `test_phase2_supplier_return_authorization.py` checks IT denials, cross-property access and posted-line locks.
7. Tests: `test_phase2_invoice_controls.py` validates denied actions, locked invoice states and posted-payment immutability; `test_phase2_finance_property_scope.py` tests two-property reads and blocked cross-hotel invoice/payment creation.

## Still required before Phase 2 completion

**Critical accounting and role acceptance**
- End-to-end seeded fixture through requisition approval, sourced PO, authorized LPO, blind receipt, inspection, GRN posting, invoice and partial/full payment.
- Test three-way quantity/price exceptions, supplier credits, cancelled/returned goods, invoice cross-line cumulative matching and payment overrun.
- **Partially addressed:** cross-property invoice and payment creation is blocked and object lookups use scoped querysets. Complete tests for invoice line foreign keys and other mutation paths, including payments posted concurrently.
- Validate invoice and payment object creation and editing are restricted to the correct stages and actor, beyond the new custom action checks.
- **Partially addressed:** supplier return header/line endpoints now check receiving ownership and property. Confirm property-scoped GRN and PO line reads and mutations, including dynamic/nested endpoints, with seeded two-property browser tests.
- Verify inventory GL journal entries and reconciliation with payable balance and period locks.
- Confirm actual deployment plus ten real-role journeys, specifically separation of invoice creator vs approver and payment preparer vs poster.

## Release gate

Do not call the whole purchase-to-pay process complete without green CI, database migration checks, seeded end-to-end workflow execution and live/staging acceptance evidence. Earlier CI successes apply only to the commits they tested.

## Incremental combined-journey validation (17 November 2026)

- **Cross-property FK update protection:** invoice, invoice-line and payment `PATCH/PUT` actions now validate the original and proposed purchase-order/invoice property, rather than relying only on scoped lists and creates. Regression tests attempt to reassign authorized records to another property's PO and invoice and verify no database mutation.
- **Approved PO → received GRN → matched invoice → split settlement:** `test_phase2_payment_journey.py` exercises the real ORM models in one test transaction: approved and issued PO with a received line, three-way matching, rejection of invoice self-approval, independent approval, two posted payments, overpayment rejection, prevention of double posting, and prohibition on rematching paid invoices. This test now creates a real GRN inspection decision, posts the receipt into InventoryBalance and StockLedger, and verifies the posted quantities before matching and settling the invoice. It remains a model-level integration test, not a full multi-role UI and approval-queue acceptance test.
- **CI is the release gate.** Source changes do not certify live browser behavior, fiscal-period GL postings, or payment provider settlement. Continue with seeded positive and negative workflows through actual GRN posting, supplier credits, accounting reconciliation and user acceptance.

## Duplicate invoice allocation controls (17 November 2026)

The matching engine historically permitted a second **header-only** invoice to match the same posted GRN value because the no-line fallback did not consider other matched invoices for the same LPO. We now disallow header-only matching when any invoice against that LPO has already reached matched, approved, partially paid, or paid status. Similarly, detailed lines now refuse matching when an earlier header-only invoice already claims the receipt, rather than silently double-allocating accepted quantity. The rejected invoice is marked **exception**, preserving the existing matched/approved invoice and identifying the reconciliation task. The detailed-line partial-invoice path remains available for new allocations when no earlier header-only invoice obscures their quantity attribution.

Automated coverage: two new tests in `test_finance_integration.py` exercise both header→header/line and line→header sequences. This is intentionally conservative: a supplier may send several real invoices, but they must use **line-level allocations** for successive partial deliveries, or first reverse/reconcile a header-only matched invoice. Credit-note offsetting and supplier-return quantity reconciliation still need explicit financial integration tests before production acceptance.


## Supplier return, quantity and credit-note safety (17 November 2026)

- Dispatch of vendor returns now checks the **original posted GRN** and source store, and limits each article's aggregate return quantity to the accepted quantity actually posted minus previously dispatched returns linked to that GRN. Merely having available stock elsewhere in a store no longer authorizes returning another delivery's articles.
- Multiple lines for the same article are summed for checking. The stock-on-hand balance is checked inside the transaction, and the locked return row is rechecked to prevent duplicate dispatch or duplicate stock-ledger deductions.
- Supplier acknowledgement is now a one-time locked operation. A recorded credit-note reference cannot be silently overwritten or reused case-insensitively on another return for the same supplier. The existing credit-note number is **documentary evidence only**.
- `test_phase2_supplier_return_quantities.py` exercises a posted inspected delivery with accepted and rejected quantities, partial supplier returns, rejected excess returns without ledger changes, repeat posting rejection, and credit-note reference integrity.

**Accounting limitation:** No separate supplier credit-note amount or approved AP credit-posting model is currently exposed in this flow. Recording a credit-note number must **not** automatically alter a supplier invoice's balance, paid amount or GL account. Actual credit valuation, approval, allocation to open invoice(s), tax treatment and balanced reversal journals require a separately controlled and tested implementation. Reconciliation between supplier returns, supplier acknowledgements, payable balances and GL is therefore **not yet signed off**.


## Controlled supplier credit-note settlement and GL reversal (17 November 2026)

**Implementation:** `apps/finance/models.py` now defines `SupplierCreditNote`, backed by migration `finance/0006_suppliercreditnote.py`, serializer and `/api/v1/supplier-credit-notes/` (create/list/detail, `POST /<id>/approve/`, `POST /<id>/post/`). The invoice-matching workspace now displays available acknowledged returns and related credits, and gives authorized operators the prepare, approve and post actions.

**Separation of duties:** An Accounts Payable Clerk prepares the valued credit. A **different Financial Manager** approves; a **different Accounts Payable Clerk** posts it. A user cannot approve their own credit or post the credit they prepared or approved. The original return must be posted into inventory, supplier-acknowledged, have a unique documentary credit-note reference, and belong to the same supplier/LPO as the approved invoice. Finance and AP credit-note endpoints retain the Phase 2 property scope; IT cannot approve/post.

**Valuation and posting:** Credit subtotal must not exceed the returned article quantity valued at actual accepted GRN/LPO rates; repeated lines of the same article use the weighted receipt value. Tax cannot exceed the original invoice's proportional input-VAT amount. Posting locks the invoice and credit, rejects closed periods or credits above the unpaid invoice balance, and records posted credit against `SupplierInvoice.credited_amount`. The displayed outstanding invoice balance now equals **invoice total minus posted payments minus posted credits**. Supplier credit posting does not pretend that the vendor has refunded cash.

**GL:** The period export includes a balanced reversal for each posted credit (Dr supplier payable, Cr original invoice debit account and input VAT account where taxable). Existing branch GL invoice mappings provide those accounts, and an unconfigured tax account blocks export. The period-close checklist now blocks unresolved draft/approved credit notes. Tests exercise real received/posted GRN stock, supplier return, maker/checker roles, credit valuation, invoice balance and balanced GL rows, including VAT.

**Deploy safely:** This feature adds a new migration and new role permissions. After an approved database backup and deployment of both backend and frontend, run `python manage.py migrate` and `python manage.py setup_hotel_roles`, then exercise credit creation, approval, posting, branch isolation, fiscal period close and GL export with staging users. Do not run role/user-provisioning commands against production to bypass missing assignments.

**Not yet certified:** Real bank settlement and bank GL movements are separate from supplier credit posting; rejected-goods replacement, supplier debit-note exchange, inventory valuation journals on stock return, and deployed multi-user acceptance still need testing. This update does **not** claim that all balance-sheet GL postings for cash payments and inventory movements are complete.


## Supplier payment GL and period-lock controls (17 November 2026)

**Implemented:** `GLAccountMapping.SOURCE_PAYMENT` (source `supplier_payment`, with migration `materials_control/0005_gl_supplier_payment_source.py`) permits each property to configure the debit account for trade payables and the credit account for its **bank/cash clearing ledger**. `GLExport.generate` now emits **two separate balanced rows per posted supplier payment**, on the original payment date, using only payments belonging to the exported property and fiscal period. A missing active payment mapping causes an explicit export validation failure instead of silent omission. The invoice and supplier-credit reversal entries remain separately identifiable. Cash/bank GL is a **clearing entry**, not proof of external settlement.

**Fiscal and bank controls:** `SupplierPayment.post` now blocks an attempted posting into a closed fiscal period of the purchase order's property; selected inactive bank accounts are rejected, while the existing two-person payment preparation/posting rule and invoice balance caps remain in force. Posting the same payment twice is still blocked.

**Regression evidence:** `test_phase2_payment_journey.py` extends the approved-LPO → inspected GRN → invoice → two posted payments journey to verify that the period GL cannot export without a payment mapping, then produces four payment GL rows with total debit and credit both equal to the two-payment settlement. `test_phase2_payment_period_lock.py` verifies that attempting payment posting after period close or against an inactive bank account leaves the payment in draft status.

**Outstanding accounting limitation:** The existing `BankTransaction` register is independent of `SupplierPayment` and lacks a permanent reconciliation link to external settlement. The new payable/bank clearing GL rows must therefore be reconciled against actual bank statements or a controlled bank integration; **bank confirmation is not represented as verified**. The `StockLedger` tracks physical quantities, not immutable historical unit valuations, and the original invoice/credit-note GL entries already reverse their invoice-side stock amounts. Generating another return valuation journal from current catalogue prices would double-count or invent valuations. Historical inventory cost snapshots and bank transaction reconciliation must be designed and tested before full materials-control GL certification.


## Bank entry matching and reconciliation controls (17 November 2026)

**Implementation:** `SupplierPaymentReconciliation` has been introduced in `apps/finance/models.py` with migration `finance/0007_supplierpaymentreconciliation.py`. The API collection is `/api/v1/supplier-payment-reconciliations/` with `POST /<id>/confirm/` as the controlled financial review action. The Accounts Payable Clerk prepares a one-to-one match of a **posted** supplier payment against an existing, separately recorded bank withdrawal; a different Financial Manager confirms with a mandatory review note. System Administrator and AP users cannot confirm. Property-scoped querysets and payment foreign-key checks prevent matching an invoice outside the clerk's assigned hotel.

**Evidence checks:** The payment must be posted and have a bank account. The recorded bank entry must have a reference, use the **same bank account and amount**, represent a **withdrawal**, and be in an open fiscal period for the supplier invoice's property. A unique link from both sides prohibits reusing a supplier payment or bank entry. Source foreign keys and confirmed matches cannot be updated or removed; matched bank entries are also locked against ordinary update/deletion to protect the audit trail. Confirming evidence does **not** post another payment, change AP balances or create duplicate GL entries.

**Automated controls:** `test_phase2_supplier_bank_reconciliation.py` covers API creation/confirmation, duplicate attempts, wrong account, amount and direction, IT denial, independent maker/checker, immutable matched evidence and unchanged payable balances.

**Limitations and operational safeguards:** The existing `BankTransaction` table may contain **manually entered** transactions. Consequently a confirmed match verifies internal consistency of two database records, **not** independent bank settlement, actual ownership of the bank account, bank statement authenticity, or proof that funds arrived. A future certified bank statement import or bank API ingestion must provide trusted source identifiers, duplicate-detection keys, settlement timestamps and reconciliation controls before claiming external settlement verification. Do not auto-create bank entries from supplier payments just to satisfy the match. The financial ledger continues to use the supplier payment posting as the source of the AP/bank clearing GL entry, not this documentary reconciliation.

**Deployment:** A new finance migration and modified group permissions are required. Only after an approved database backup and staging validation should the deployment administrator run `python manage.py migrate` and `python manage.py setup_hotel_roles`. Production bank records and credentials were not accessed in these tests.


## Historical stock movement valuation snapshots (17 November 2026)

**New non-destructive inventory migration:** `inventory/0032_stockledger_valuation_snapshots.py` adds nullable `unit_cost_snapshot`, `total_cost_snapshot`, `wac_before`, and `wac_after` to immutable `StockLedger` movements. Null is deliberate on **older** entries whose transaction-time cost cannot be evidenced: historical valuation is **not** backfilled from current catalogue prices or current store WAC. A new valued movement must have all four fields and its total must reconcile to quantity × recorded unit price.

**Current capture:** The GRN receipt posting snapshots the actual base-unit procurement cost and weighted-average cost immediately before and after receipt. Store issue posting snapshots historical batch depletion cost and WAC; supplier return dispatch snapshots its store's transaction-time WAC. Receipt cost precision is fixed at four decimal places, with the total derived from the same rounded unit snapshot, avoiding inconsistent audit values. All snapshots are immutable because posted stock ledger rows cannot be updated or deleted.

**Automated tests:** `test_phase2_inventory_valuation_snapshots.py` asserts accepted quantity and historical receipt cost, supplier return WAC and amount, rejection of partial or mathematically inconsistent snapshots, legacy movements retaining unknown valuation as NULL, and ledger immutability. Existing procurement and inventory test suites continue to guard balance movements.

**Remaining before GL inventory valuation certification:** Source and destination transfer snapshots, store adjustments, physical counts, direct-to-department deliveries, outlet issues and POS depletion require complete historical valuation coverage; not every existing posting path is cost-snapshotted yet. A transaction-time journal allocation policy also needs mapping to inventory clearing, inventory asset, consumption/COGS and variance accounts, including treatment of differences between supplier-credit value and store WAC. The existing GL exporter intentionally **does not** create stock movement journal values from today's prices. Only after all cost-sensitive movement types are proven should the stock-to-GL posting exporter be extended; otherwise incomplete or duplicate journals could misstate balances.

**Deployment:** Apply migration only after a production backup and approved rollout. Confirm historical ledger rows remain null and new rows capture immutable values in staging. No production data has been altered in this development pass.


## Transfers, adjustments and physical count valuation (17 November 2026)

**Store transfers:** The source-store dispatch now captures its transaction-time weighted-average cost, amount, and before/after WAC in the immutable outbound stock ledger entry. When the goods are received, the destination reads the original dispatch value, rather than the potentially changed *current* source WAC. Incoming value is combined with the destination's existing quantity and value to calculate destination WAC. This preserves the cost of inventory in transit and documents the two sides under the same transfer reference. Legacy transfers lacking a trustworthy dispatch snapshot retain NULL valuation on receipt; the system does not invent acquisition prices. A status recheck under the transfer row lock prevents competing dispatch attempts from posting duplicate stock movements.

**Approved stock adjustments:** Outgoing variance and incoming adjustment movements now capture cost at posting where available. For positive corrections an explicit adjustment-line unit cost may be used, otherwise the existing store WAC is applied; incoming cost changes store WAC proportionately. The approved state is rechecked under the locked adjustment row before applying stock movements. When neither a verified adjustment cost nor an existing WAC exists, the ledger valuation remains NULL.

**Physical stock counts:** Approved count variances now snapshot the existing store WAC for quantity differences. When WAC is unknown, the movement retains unvalued NULL fields rather than falsely claiming the variance is costless.

**Automated verification:** `test_phase2_inventory_transfer_and_variance_costs.py` verifies that a transfer in transit preserves dispatch cost despite subsequent source WAC changes, destination WAC is correctly blended, an approved adjustment records explicit unit cost and recalculates WAC, and a stock-count shortage captures transaction-time WAC. These tests complement the earlier immutable historical GRN/issue/vendor-return snapshot tests.

**Remaining accounting work:** Historical POS depletion and restaurant recipe consumption, store/department returns, direct department receipts, and variance/COGS general-ledger account allocations require additional source-specific valuation and balanced-entry tests. Posting a GL journal from an unvalued legacy movement would fabricate an amount; therefore such rows must stay outside automated valued stock journals until source costs can be independently evidenced. Deployment must apply the prior inventory valuation migration `0032_stockledger_valuation_snapshots.py` before these posting paths are used. No production records were modified during development.


## POS depletion and waste historical valuation — one batched deployment

POS recipe depletion and outlet waste now capture the **transaction-time store WAC** in immutable StockLedger unit/total snapshots with before/after WAC. These are recorded alongside existing POS sale-line COGS; posting a POS batch twice must not double-deduct inventory or revalue the historical sale. A missing/zero WAC is retained as **NULL**, not treated as a supported zero-value cost. Tests cover priced and unpriced POS movements, immutable historical COGS on reprocessing, and priced/unpriced waste.

No additional migration is needed beyond the existing nullable StockLedger snapshot migration. This change intentionally **does not auto-generate inventory-to-GL entries**: restaurant consumption/waste mappings, invoice-side double-count prevention, and unvalued historical rows must be accounted for and tested before GL automation. Staging acceptance and the previously described deployment prerequisites remain outstanding.


## Inventory-to-GL preflight reconciliation — read-only accounting safeguard

Finance can now open `GET /api/v1/fiscal-periods/<id>/inventory-valuation-reconciliation/` for its authorized property. The calculation groups **transaction-time stock ledger costs** by movement type (receipts, consumption, POS, waste, adjustments and returns), reports the count of historically unvalued movements separately, and checks whether outgoing/incoming transfer values and quantities balance **within the selected period**. A transfer dispatched at the end of one month and received in the next may generate a legitimate informational warning.

The method is intentionally **read-only**: it does not create stock or GL transactions, does not assign missing historical prices, and cannot double-book the original supplier invoice/credit entries. Missing costs or unmatched transfer halves are surfaced to Finance rather than hidden by a falsely balanced ledger. It provides evidence for the subsequent approved mapping of stock movements to inventory asset, in-transit, consumption, COGS and variance accounts. Finance must verify that supplier invoice GL debits actually point to the intended inventory asset/clearing account before activating any stock-to-GL automation.

This stage requires no migration or frontend build changes; its server endpoint uses the existing fiscal-period property scope and Financial Manager permission. Staging role testing is still required before production certification.


## Stock-to-GL journal accounting preview

The Finance fiscal-period endpoint `GET /api/v1/fiscal-periods/<id>/inventory-gl-preview/` now proposes balanced, **unposted** inventory GL entries for stock issues, POS COGS, waste and stock variance adjustments using immutable historical ledger costs. New optional mapping sources are `stock_consumption`, `pos_cogs`, `stock_waste` and `stock_variance` under migration `materials_control/0006_inventory_gl_preview_sources.py`. Only approved IT administrators configure mappings; Finance reviews candidate journal rows. Missing mappings, missing historical amounts and invalid cost amounts block partial previews. A physical surplus reverses the normal debit and credit direction. GRN receipts, vendor credits and store transfers are excluded pending invoice-side duplication checks and in-transit accounting policy. **No journals are posted or exported** by this change. Production migration and staging acceptance remain outstanding.


## Store Keeper receiving handoff: line destination source of truth

The real receiving-to-stores API handoff was checked against the Oracle-style workflow. In some valid LPOs, `PurchaseOrder.store` is empty because the intended store belongs to each PO/GRN line. Earlier store-keeper receipt visibility looked only at the LPO header store, which could hide a legitimate GRN from the assigned keeper. The revised `_store_keeper_receipt_scope` uses assigned, active store IDs and actual GRN-line destinations, requires the purchase requisition's property to match the keeper's branch, and excludes mixed-destination documents from an actionable keeper queue. A regression test creates an approved requisition and issued LPO with a blank header store, receives and inspects an accepted GRN, then exercises `/grns/unposted-queue/`, `/grns/<id>/verification/` and `/grns/<id>/post-to-inventory/` using the assigned Store Keeper. It checks SOH and historical ledger count and rejects duplicate posting. This is CI-backed API acceptance, not proof of a deployed browser journey.


## Supplier invoice approval concurrency gate

The Invoice Matching → Finance Approval transition now locks and re-reads the persisted `SupplierInvoice` row inside `transaction.atomic` before moving from `matched` to `approved`. A stale browser/API object cannot approve an invoice already paid, cancelled or approved by another request, nor overwrite a newer audit decision. The preparer/approver segregation is rechecked against the locked database record. The regression fixture verifies paid and cancelled status preservation, a valid independent approval, and rejection of repeated stale approvals. This strengthens the procure-to-pay path; it does not itself certify all live role/browser journeys or production accounting.
