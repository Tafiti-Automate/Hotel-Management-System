# Hotel Inventory & Cost Control — Materials Control Reference Audit

**Date:** 2026-11-17  
**Branch:** `back$front`  
**Purpose:** Track implementation and release readiness against the two reference PDFs provided by the client, while retaining our original product branding, modern forest-green Next.js UI and Django backend.

## Reference hierarchy and limitations

1. **Oracle_Materials_Control_Complete_User_Guide.pdf**, four pages: the client-provided target specification. Relevant sections: seven accounting invariants (p. 1), procurement/receiving/stock movement/POS processes (p. 2), stocktake, fiscal close and role matrix (p. 3), and end-to-end hand-offs (p. 4).
2. **screenshoracle.pdf**, 331 PDF pages, historical MICROS-Fidelio Materials Control user manual (version noted inside as 8.0.02, with 2007 material). Its table of contents covers Master Data (guide pp. 58–122), Purchase (123–184), Store (185–260), Production (261–311), and Results (312–330). Use it to benchmark ergonomics, screen concepts and transactional workflows, **not** as proof of the current Oracle product's exact behavior or a license to reproduce proprietary visuals.

**Audit legend:** *Present in code* = identified implementation, not an end-to-end acceptance test. *Confirmed defect* = code-level mismatch with a concrete fix. *Requires validation* = needs fixture/live transactional tests before certifying parity. *Not established* = no claim of complete implementation.

## Module coverage crosswalk

| Reference capability | Repository evidence | Assessment and next acceptance check |
|---|---|---|
| User accounts, roles and permissions (historical manual: System / Users; target spec p. 3) | `apps/accounts/role_templates.py`, `core/permissions/roles.py`, `frontend/src/lib/access.ts` | **Present in code.** Validate the complete 10-role matrix for both API access and GUI navigation; never elevate roles to work around 403. |
| Supplier master data and contracted quotes (manual: Suppliers, Price Quotes; spec p. 2) | `apps/vendors/urls.py`, `apps/inventory/views.py` quote proposal viewset, EnterpriseQuoteMatrix | **Confirmed defect fixed previously:** frontend used `suppliers`, Django registers `vendors`. Confirm quotations can be drafted, reviewed, approved and expire correctly. |
| Article groups, units, and conversions (manual: Units, Item Groups, Articles; spec pp. 1–2) | `apps/inventory/models.py` category, item, UOM, item-unit-price; frontend Article screens | **Present in code.** Verify 4-tier order/delivery/base/recipe conversion and 4-decimal quantity rounding with independent unit tests. |
| Department requisition → approvals → PR → PO (spec pp. 2, 4) | `apps/inventory/department_request_v2.py`, `apps/procurement/transaction_controls.py`, `apps/approvals` | **Present in code.** Verify request ownership and threshold approvals, no self-approval, order creation and clean failure recovery. |
| Blind receiving, inspections, batch, expiry and WAC (spec p. 2; manual Receiving) | Procurement GRN/inspection models, `transaction_controls.py`, `apps/inventory/models.py` | **Present in code.** Validate receiving role cannot inspect ordered prices/quantities; verify GRN posting affects balance and WAC only once. |
| Transfers, FEFO, virtual transit and pickup confirmation (spec pp. 1–2, 4; manual Transfers / Issue Requests) | `apps/inventory/stores_fulfillment.py`, `apps/inventory/models.py` transfer/issue records | **Present in code.** Validate dispatch → transit → outlet acknowledgement, same-property boundaries, no double debit. |
| Stocktake blind count, audit and variance (spec p. 3; manual Inventory) | `StockCountViewSet`, `StockCountItemViewSet`, `EnterpriseStocktakeSheet`, `EnterpriseStocktakeVariance` | **Confirmed defects:** Cost Controller was missing read rights to stock-count/items/ledger, fixed earlier; duplicate/misplaced action routes on count and count-item viewsets removed in this audit. **High-priority review remaining:** enforce explicit role separation for approval and variance posting (including object-level/store scope), verify frozen theoretical snapshot and booked count immutability. |
| Recipe costing, nested recipes, waste and POS depletion (spec p. 2; manual Production) | `apps/materials_control/recipe_costing.py`, recipe/POS/waste viewsets, migrations for nested recipes | **Present in code.** Test recipe yield, cyclic recipe handling, POS mapping, idempotent sales depletion and valuation. |
| Invoice 3-way match, supplier returns, GRNI (spec pp. 2–3) | `apps/finance` supplier invoices, `apps/procurement` GRNs and returns | **Present in code.** Exercise mismatched price, quantity, debit notes and posting authorization before acceptance. |
| Fiscal period lock and GL export (spec pp. 1, 3) | `FiscalPeriod`, `GLExport`, budget and period-context endpoints | **Present in code.** Verify no backdating across *all* document write paths after close, balanced GL journals and closure blockers. |
| Operational reports, search, dense keyboard-friendly screens (historical manual: Results/Reports; p. 11 keyboard shortcuts) | Reports app, EnterpriseTable, Next.js screens, green corporate layout | **Present in code.** Validate filters, exports, focus order, responsive dense tables and accessible errors by role. |

## Verified API route audit

Compared frontend enterprise workbench `useBackendRows` collection names in `OperationsAdmin.tsx` and `ProcurementFinance.tsx` against registered DRF router resources in the inventory, procurement, finance, materials control, vendor, accounts, approvals and departments URL modules. **All referenced collection roots in these two files map to registered endpoints after the `suppliers → vendors` resolver.** This is **not** an exhaustive check of every page, dynamic action URL or runtime role authorization. Dynamic requests and server responses still need validation.

## Changes implemented in this pass

1. Remove `StockCountItemViewSet` actions `submit`, `approve`, `reject` and `assign-store`: these methods were copied from other document types, and the returned StockCountItem object does not support those workflows.
2. Remove the unrelated `assign-store` action from `StockCountViewSet`: it referenced StoreRequisition fields and statuses on a StockCount.
3. Add `test_stocktake_route_safety.py` to assert the invalid routes are not published while the legitimate stock count `submit` action remains available.
4. Earlier fixes already on this branch: Cost Controller read-only stocktake permissions with regression tests; supplier endpoint canonicalization with a frontend test; forest-green visual theme.

## Follow-up work — prioritized, not claimed complete

**P0 security and accounting**
- Explicit role/record permission review for stock count approval and variance application; ensure the count originator cannot unilaterally approve and post shrinkage, consistent with the reference separation-of-duties rule.
- Booked document immutability and fiscal-period lock audit across every mutation endpoint (GRNs, transfers, returns, adjustments, waste, invoices).
- Full reconciliation tests: WAC, GRNI, GL debit-credit equality, returns and variance journals.

**P1 operational flow**
- Automated role-by-role journey tests for all 10 roles, including scope of property/department/store and forbidden actions.
- Field-level blind receiving restrictions and physical count validation; expiration/temperature and batch tracing.
- Supplier quotation lifecycle, purchase requisition consolidation, approval thresholds and error recovery.

**P2 interface and reporting**
- Audit the remaining frontend pages and every action route, not just enterprise `useBackendRows` collections.
- Confirm navigation, empty/error/loading states, keyboard workflows, data grids, exports and printed reports.
- Reuse the established forest-green palette without imitating Oracle branding or reproducing old proprietary screen artwork.

## Release criteria

Do **not** describe the system as Oracle-equivalent or fully complete until: (a) all Django and Next.js CI checks pass, (b) each of the 10 roles passes positive/negative API access tests, (c) complete requisition-to-payment and stocktake-to-GL transactions have been exercised on seeded test data, and (d) production deployment and permissions have been verified separately.
