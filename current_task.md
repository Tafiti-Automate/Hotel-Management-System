# Current Task — Client Procurement Workflow V2

## Status: implementation complete; deployment/UAT pending

### Implemented

- [x] Multi-item Department Requisition retained.
- [x] Requester commercial data hidden.
- [x] HOD approval and self-approval protection retained.
- [x] Store Manager/Stores Manager consolidated into Store Keeper.
- [x] Multiple Store Keeper/store assignments retained.
- [x] Store Keeper destination selection and per-line quantity confirmation retained.
- [x] Supplier allocation moved to requisition-line level.
- [x] Different Articles can use different suppliers.
- [x] Supplier current-price confirmation retains price history.
- [x] Article-specific purchase/base UOM conversion enforced during Procurement allocation.
- [x] Automatic LPO grouping/splitting by supplier implemented.
- [x] Fixed Financial Manager → General Manager LPO approval route implemented.
- [x] Finance quantity reduction preserved separately.
- [x] Rejected LPO is terminal and requires a reason.
- [x] ORIGINAL/COPY print control retained.
- [x] Supplier email issue and lead-time start retained.
- [x] Receiving Clerk inspection permissions added.
- [x] Partial receipt/over-receipt protection retained.
- [x] GRN quantity remains independent of LPO quantity.
- [x] GRN posting re-checks the original Department Requisition.
- [x] Resume quantity uses Store Keeper-forwarded quantity.
- [x] Store Keeper stock-issue permissions added.
- [x] Department/Store Requisition, Purchase Requisition, LPO and GRN references normalized to shared numeric sequence.
- [x] PO compatibility reference mirrors LPO number.
- [x] Operational roles/permissions locked as predefined policy.
- [x] Access Management role permission editing removed.
- [x] Tot UOM seeded as an available unit.
- [x] Procurement UI changed to task queues and item-level supplier allocation.
- [x] UOM conversion preview added to supplier allocation.
- [x] PostgreSQL migration schema/data work separated to avoid pending-trigger errors.

### Validation completed

- [x] Backend Python source compile check.
- [x] Frontend TS/TSX syntax-transpilation check across 39 source files.
- [x] Focused test source updated for fixed LPO route.
- [x] Focused test source added for multi-supplier LPO splitting and numeric LPO references.

### Deployment/UAT required

- [ ] Deploy migrations.
- [ ] Run `setup_hotel_roles`.
- [ ] Confirm Financial Manager and General Manager assignments.
- [ ] Confirm Store Keeper store assignments.
- [ ] Run full Django automated tests in the project environment.
- [ ] Run fresh frontend `npm ci && npm run build` in CI/project environment.
- [ ] Run complete role-based client UAT documented in `CLIENT_WORKFLOW_IMPLEMENTATION_V2.md`.
