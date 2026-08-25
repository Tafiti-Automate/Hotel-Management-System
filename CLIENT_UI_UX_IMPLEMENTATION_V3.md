# Client Procurement UI/UX Implementation V3

## Scope boundary

This release implements UI/UX only around the client-confirmed procurement process. It does not introduce new business modules, approval layers, supplier portals, supplier scoring, budgeting rules, POS/front-office functions, or speculative management analytics.

## Implemented user experience

### Fixed role navigation
- Requester: Dashboard, My Requisitions.
- Department Head: Dashboard, Department Approvals.
- Store Keeper: Dashboard, Store Keeper Queue.
- Cost Controller: Dashboard, Suppliers, Supplier Quotations, Articles, Categories, Units of Measure, UOM Conversions.
- Procurement Manager: Dashboard, Procurement Queue.
- Financial Manager: Dashboard, LPO Approvals.
- General Manager: Dashboard, Final LPO Approvals.
- Receiving Clerk: Dashboard, Receiving & GRN.

The navigation remains permission-aware and does not expose supplier/pricing work to Department or Store Keeper roles.

### Task-first role dashboards
Each standard role lands on a dashboard that answers what needs attention now. Counts and queue links are based on operational records already available to the signed-in role.

### Supplier master
The Cost Controller has a focused supplier management screen with:
- supplier identity, TIN and contact details;
- status;
- payment terms/address;
- supplied Articles and their quotation-backed current prices;
- direct access to edit the supplier or open the quotation catalogue.

### Supplier quotations
The former wide technical supplier catalogue is replaced by a focused table showing:
- Supplier;
- Article;
- Purchase UOM;
- Quoted Price;
- Quotation Reference and validity;
- Lead Time;
- Status.

Quotation price remains Cost Controller master data. Procurement can confirm a different current price later without overwriting the original quotation.

### Department Requester / HOD
Existing multi-item Department Requisition behavior is preserved. Requester/HOD screens remain non-commercial: no supplier or price information is exposed.

### Store Keeper
The Store Keeper queue now highlights:
- requests needing a stock/store decision;
- requests awaiting Procurement;
- requests ready for issue;
- completed issues.

When processing an HOD-approved request, current store availability is shown as context. The Store Keeper still explicitly decides the carried-forward quantity; the UI does not invent an automatic shortage rule or overwrite the Department quantity.

### Procurement Manager
The Procurement workspace now emphasizes:
- Store Requisitions requiring supplier allocation;
- supplier allocation per Article line;
- vetted supplier quotation comparison;
- Procurement quantity separate from Store Keeper quantity;
- current confirmed price;
- mandatory reason when Procurement changes the quoted price;
- automatic grouping of lines into separate LPOs by supplier;
- LPO preparation;
- approved LPO print/email actions;
- supplier delivery pending records.

### Finance / General Manager
Finance and General Manager receive decision-focused LPO workspaces rather than generic Procurement navigation.
- Finance sees the financial quantity review and approve/reduce/reject controls.
- General Manager sees final approval/rejection controls.
- The LPO approval timeline remains visible.
- Rejected LPOs remain terminal/read-only for downstream actions.

### LPO document control
The UI keeps the existing controlled document behavior:
- first controlled print = ORIGINAL;
- later controlled prints = COPY;
- supplier email issue is recorded;
- lead time starts from successful supplier issue.

### Receiving Clerk
Receiving is presented as a two-step task:
1. Receive goods against an issued LPO.
2. Confirm accepted/rejected quantity and post the GRN.

The LPO quantity remains read-only. Actual receipt is recorded separately and partial delivery/outstanding quantity controls remain intact.

### Post-GRN Store Keeper completion
After Procurement receiving replenishes the issuing store, the originating Department Requisition can return to the Store Keeper for the normal stock decision/issue path. The Store Keeper dashboard exposes ready-to-issue work.

## Visual standards applied
- task-first dashboards rather than decorative cards;
- one clear next action per workflow area;
- compact professional tables;
- consistent status badges;
- client-facing numeric references prioritized over internal IDs;
- responsive layouts for dashboards and supplier tables;
- role-specific information boundaries shown in the UI;
- no permission matrix exposed to standard operational users.

## Validation completed in this workspace
- All backend Python source files compile successfully.
- All 41 frontend TypeScript/TSX source files pass TypeScript syntax transpilation.
- Django runtime `manage.py check` could not run in this workspace because Django dependencies are not installed here.
- A full Vite production build could not be run in this workspace because frontend dependencies were not available locally. The repository retains its normal `npm ci` / `npm run build` workflow for CI/deployment.

## Required client UAT before demonstration
Use separate accounts for Requester, Department Head, Store Keeper, Cost Controller, Procurement Manager, Financial Manager, General Manager and Receiving Clerk.

Test one complete scenario:
1. Cost Controller registers vetted suppliers, Articles, UOM/conversions and supplier quotations.
2. Requester creates one multi-item Department Requisition.
3. HOD approves it.
4. Store Keeper selects the destination store and confirms/reduces line quantities without seeing supplier prices.
5. Procurement allocates different suppliers to different Articles where appropriate and confirms current prices.
6. System creates separate LPOs by supplier.
7. Finance approves/reduces/rejects as appropriate.
8. General Manager performs final approval/rejection.
9. Procurement prints the ORIGINAL approved LPO and emails it to the supplier.
10. Receiving Clerk records a partial delivery and posts the GRN without changing the LPO quantity.
11. Remaining delivery is received and posted.
12. Store Keeper completes issue to the originating Department.

The release should only be presented as client-ready after this role-based end-to-end UAT succeeds against the deployed database.
