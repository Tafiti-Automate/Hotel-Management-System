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
