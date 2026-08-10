# Current Hotel Operations ERP UI/UX Behaviour

> **Document classification: CURRENT STATE / EVIDENCE BACKED**
>
> Audit date: 2026-08-01
>
> Evidence environment: repository working tree on branch `back$front`
>
> Production deployment and complete role-based live UAT: **not verified in this audit**

Companion documents:

- [Target UI/UX Design Specification](Hotel_Operations_ERP_UI_UX_Design_Specification.md)
- [UI/UX Gap Register](UI_UX_GAP_REGISTER.md)

## 1. Purpose and Evidence Rule

This document records only behaviour supported by inspected frontend code,
backend routes, database models, role definitions or automated-test sources.
It does not promote a design proposal to current functionality.

A current-state claim should identify as many of these evidence types as apply:

1. React screen or component.
2. Reachable frontend route.
3. Backend endpoint or action.
4. Database model and status transition.
5. Role or model permission.
6. Automated test.
7. Observed deployed live behaviour.

## 2. Status and Verification Vocabulary

| Label | Meaning |
|---|---|
| `VERIFIED` | Frontend, API, database result, permissions and deployed live behaviour have been exercised and recorded. |
| `IMPLEMENTED–UNVERIFIED` | Relevant code exists and compiles, but the complete deployed role journey has not been live-tested. |
| `PARTIAL` | Only part of the described capability exists or some paths are not connected. |
| `PROPOSED` | No implementation supporting the described capability was found. |
| `BLOCKED` | Delivery depends on missing backend behaviour or a business decision. |
| `NOT SUPPORTED` | The current product deliberately does not provide the behaviour. |

Verification evidence in this document uses:

- `CODE` — source inspected.
- `BUILD` — TypeScript validation and/or production frontend build passed.
- `TEST SOURCE` — an automated test exists; this does not claim it was run in this audit.
- `LIVE` — observed against the deployed application and database.

No capability in this audit is labelled `LIVE` unless explicitly stated.

## 3. Current Application Structure

### 3.1 Launch and module selection

Status: `PARTIAL` · Evidence: `CODE`

- The launchpad exposes the active Hotel Operations and Human Resources workspaces.
- Finance, Front Office, Restaurant/POS and Maintenance are displayed as planned workspaces, even though Finance functionality is also reachable inside Hotel Operations.
- Only a superuser or System Administrator who can access both Operations and HR is offered module switching. Other roles enter their authorised operational landing page directly.
- The launchpad does not currently show Recent documents, My Tasks or operational alert counts.

Evidence:

- [`frontend/src/screens/Launchpad.tsx`](frontend/src/screens/Launchpad.tsx)
- [`frontend/src/lib/access.ts`](frontend/src/lib/access.ts)
- [`frontend/src/state/AppContext.tsx`](frontend/src/state/AppContext.tsx)

### 3.2 Authenticated application shell

Status: `IMPLEMENTED–UNVERIFIED` · Evidence: `CODE`, `BUILD`

The authenticated shell contains:

- A role-filtered left sidebar.
- A header with an inert global-search field, task shortcut, help control, notifications and user menu.
- A breadcrumb-like module/current-page strip.
- A main workspace rendering dashboards, lists, workbenches, documents, reports and configuration.

The current navigation deliberately separates workflow entry points from raw
record lists:

- **Start here · workflows:** Department supply & stores, Procurement to receiving, Supplier invoices & payment and My approval queue.
- **Record groups:** procurement, inventory and stores records.
- **Partners & control:** suppliers, reports, audit log and settings.

Evidence:

- [`frontend/src/screens/AppShell.tsx`](frontend/src/screens/AppShell.tsx)
- [`frontend/src/components/Header.tsx`](frontend/src/components/Header.tsx)
- [`frontend/src/components/Sidebar.tsx`](frontend/src/components/Sidebar.tsx)
- [`frontend/src/lib/access.ts`](frontend/src/lib/access.ts)

### 3.3 Route access

Status: `IMPLEMENTED–UNVERIFIED` · Evidence: `CODE`

The frontend checks route access using Django-style permission codenames. A
route requiring several permissions is available when the user has at least one
of the listed view permissions. Action controls inside workbenches apply more
specific change permissions and, for sensitive inventory decisions, role checks.

Principal operational routes:

| Route | React screen | Purpose |
|---|---|---|
| `dashboard` | `Dashboard` or `StoresDashboard` | Role-aware queues and KPIs. |
| `workflow-stores` | `InventoryWorkbench` | Department requests, issues and inventory controls. |
| `workflow-procure` | `ProcurementWorkbench` | Requisition lines through supplier return. |
| `workflow-pay` | `FinanceWorkbench` | Supplier invoices, payments, expenses and banking. |
| `requisitions`, `orders`, `grns`, etc. | `ListView` | Searchable record lists. |
| `detail` | `DetailView` | Requisition or purchase-order document detail. |
| `reports`, `reportview` | `Reports`, `ReportView` | Report catalogue, filters and exports. |
| `audit-log` | `AuditLog` | Searchable audit events. |
| `access-management` | `AccessManagement` | Roles and user accounts. |
| `workflow-configure` | `WorkflowHub` | Configuration navigation. |

Evidence:

- [`frontend/src/screens/AppShell.tsx`](frontend/src/screens/AppShell.tsx)
- [`frontend/src/lib/access.ts`](frontend/src/lib/access.ts)

## 4. Current Role Model

Status: `IMPLEMENTED–UNVERIFIED` · Evidence: `CODE`, `TEST SOURCE`

The backend creates these operational groups:

| Role | Current permission scope summary |
|---|---|
| System Administrator | All model permissions. |
| General Manager | View all; selected approval, procurement and inventory changes. |
| Procurement Manager | Procurement, suppliers, quotations, purchase orders and related sourcing records. |
| Finance Controller | Finance CRUD, approval decisions and procurement evidence required for matching. |
| Stores Manager | Inventory movement/control CRUD and receiving visibility. |
| Store Keeper | Store requisitions, issues, returns and counts; supporting inventory visibility. |
| Department Requester | Department store-requisition CRUD plus item/unit visibility. |
| Department Head | Department request CRUD plus approval decisions. |
| Receiving Officer | GRN, inspection, return and attachment operations. |
| Auditor | View permissions across installed models. |

This is a model-permission baseline. Some API actions impose additional status,
ownership, department or named-role rules.

Evidence:

- [`hotel_erp_backend/apps/accounts/management/commands/setup_hotel_roles.py`](hotel_erp_backend/apps/accounts/management/commands/setup_hotel_roles.py)
- [`hotel_erp_backend/tests/test_auth.py`](hotel_erp_backend/tests/test_auth.py)
- [`hotel_erp_backend/apps/inventory/views.py`](hotel_erp_backend/apps/inventory/views.py)
- [`hotel_erp_backend/apps/procurement/views.py`](hotel_erp_backend/apps/procurement/views.py)

## 5. Current Dashboards

### 5.1 Shared role-aware dashboard

Status: `PARTIAL` · Evidence: `CODE`

The shared dashboard has explicit configurations for Department Head, Stores
Manager, Procurement Manager, Finance Controller, General Manager and HR
Administrator, with a fallback for other roles. It displays KPIs, charts and one
action queue using records loaded into application state.

Limitations:

- The Finance Controller dashboard is based mainly on requisitions and purchase orders, not the full supplier-invoice/payment datasets used by the finance workbench.
- The Procurement dashboard does not expose every quotation and supplier-response metric proposed in the target design.
- The dashboard does not provide a universal quick-create menu.

Evidence: [`frontend/src/screens/Dashboard.tsx`](frontend/src/screens/Dashboard.tsx)

### 5.2 Stores dashboard

Status: `PARTIAL` · Evidence: `CODE`

The Stores Manager receives a dedicated dashboard showing pending store
requests, unposted issues, low-stock articles, near-expiry batches, available
units and inventory value. It links to the stores workbench, balances, GRNs and
batches.

It does not reproduce every target metric such as today's receipts, transfers
and returns as separate cards.

Evidence: [`frontend/src/screens/StoresDashboard.tsx`](frontend/src/screens/StoresDashboard.tsx)

## 6. Current Operational Workflows

### 6.1 Department material request to issue

Status: `IMPLEMENTED–UNVERIFIED` · Evidence: `CODE`, `BUILD`, `TEST SOURCE`

The frontend now presents this role-owned journey:

1. Department requester prepares the request and adds all articles.
2. Department Head reviews employee-created requests.
3. Stores Manager decides approved quantities and reserves stock.
4. Stores team creates the issue voucher and pick lines.
5. Stores team posts the issue, reducing stock and recording consumption.
6. Stores team records the employee receiving the handover.

The workspace groups that journey into five role/status-aware task cards:
**Prepare request**, **Department approval**, **Stores availability decision**,
**Procurement shortage**, and **Pick and issue**. Each card displays its current
queue count and reveals only that stage's controls. Pick, posting and receipt
acknowledgement remain controlled substeps inside the final card.

A Department Head-created request skips department review and moves directly to
Stores. When stock is unavailable, Stores can create or link a procurement
requisition and later resume the original store request.

Actual store-requisition statuses:

`draft` → `pending_department_approval` or `submitted` →
`approved` / `partially_approved` / `awaiting_procurement` →
`partially_issued` → `issued`

Terminal alternatives include `rejected` and `cancelled`.

Evidence:

- [`frontend/src/screens/InventoryWorkbench.tsx`](frontend/src/screens/InventoryWorkbench.tsx)
- [`frontend/src/components/FormDrawer.tsx`](frontend/src/components/FormDrawer.tsx)
- [`hotel_erp_backend/apps/inventory/models.py`](hotel_erp_backend/apps/inventory/models.py)
- [`hotel_erp_backend/apps/inventory/views.py`](hotel_erp_backend/apps/inventory/views.py)
- [`hotel_erp_backend/core/constants/choices.py`](hotel_erp_backend/core/constants/choices.py)
- [`hotel_erp_backend/tests/test_inventory.py`](hotel_erp_backend/tests/test_inventory.py)

### 6.2 Purchase requisition to accepted receipt

Status: `IMPLEMENTED–UNVERIFIED` · Evidence: `CODE`, `BUILD`, `TEST SOURCE`

The procurement workbench exposes six connected work areas:

1. Add requisition articles and submit.
2. Record supplier quotations and select an award.
3. Create and issue the LPO.
4. Record the goods receipt.
5. Inspect and accept or reject delivered quantities.
6. Return rejected or damaged goods when required.

The backend exposes separate resources for requisitions and lines, approval
workflows, quotations and lines, purchase orders and lines, GRNs and lines,
inspections and lines, supplier returns and lines, attachments, communications
and requisition history.

Actual purchase-requisition statuses include:

`draft`, `submitted`, `returned`, `hod_approved`,
`procurement_approved`, `finance_approved`, `director_approved`, `approved`,
`partially_ordered`, `ordered`, `partially_received`, `fulfilled`, `closed`,
`rejected` and `cancelled`.

Purchase-order statuses are separately limited to `draft`, `issued`,
`partially_received`, `received` and `cancelled`.

Evidence:

- [`frontend/src/screens/ProcurementWorkbench.tsx`](frontend/src/screens/ProcurementWorkbench.tsx)
- [`hotel_erp_backend/apps/procurement/urls.py`](hotel_erp_backend/apps/procurement/urls.py)
- [`hotel_erp_backend/apps/procurement/models.py`](hotel_erp_backend/apps/procurement/models.py)
- [`hotel_erp_backend/core/constants/choices.py`](hotel_erp_backend/core/constants/choices.py)
- [`hotel_erp_backend/tests/test_procurement.py`](hotel_erp_backend/tests/test_procurement.py)
- [`hotel_erp_backend/tests/test_approvals.py`](hotel_erp_backend/tests/test_approvals.py)

### 6.3 Supplier invoice to payment

Status: `IMPLEMENTED–UNVERIFIED` · Evidence: `CODE`, `BUILD`, `TEST SOURCE`

The finance workbench provides:

1. Supplier-invoice registration against a received or partially received LPO.
2. Three-way match using purchase order, posted accepted receipt and invoice.
3. Approval for payment.
4. Draft supplier-payment creation.
5. Payment posting against the approved invoice balance.

The same workbench also exposes operating expenses, bank accounts and
transactions, and payment-method configuration.

Actual supplier-invoice statuses:

`draft` → `matched` or `exception` → `approved` →
`partially_paid` → `paid`, with `cancelled` as a terminal alternative.

Supplier payments use `draft`, `posted` and `cancelled`.

Evidence:

- [`frontend/src/screens/FinanceWorkbench.tsx`](frontend/src/screens/FinanceWorkbench.tsx)
- [`hotel_erp_backend/apps/finance/urls.py`](hotel_erp_backend/apps/finance/urls.py)
- [`hotel_erp_backend/apps/finance/models.py`](hotel_erp_backend/apps/finance/models.py)
- [`hotel_erp_backend/tests/test_finance_integration.py`](hotel_erp_backend/tests/test_finance_integration.py)

### 6.4 Other inventory controls

Status: `PARTIAL` · Evidence: `CODE`, `TEST SOURCE`

The inventory workbench contains tabs for transfers, adjustments, stock counts,
returns, reorder rules, batches/expiry and department consumption.

Backend state models include:

- Transfer: `pending` → `in_transit` → `completed` or `cancelled`.
- Adjustment: `draft` → `pending` → `approved` → `applied` or `cancelled`.
- Count: `draft` / `in_progress` → `submitted` → `approved` → `applied` or `cancelled`.
- Supplier return: `draft` → `approved` → `posted` or `cancelled`.

Known backend action-routing concerns remain listed in the gap register; the
presence of frontend buttons does not prove every adjustment/count path works in
production.

Evidence:

- [`frontend/src/screens/InventoryWorkbench.tsx`](frontend/src/screens/InventoryWorkbench.tsx)
- [`hotel_erp_backend/apps/inventory/models.py`](hotel_erp_backend/apps/inventory/models.py)
- [`hotel_erp_backend/apps/inventory/views.py`](hotel_erp_backend/apps/inventory/views.py)
- [`hotel_erp_backend/tests/test_inventory.py`](hotel_erp_backend/tests/test_inventory.py)

### 6.5 Article unit conversion and valuation control

Status: `IMPLEMENTED–UNVERIFIED` · Evidence: `CODE`, `BUILD`, `TEST`

Every stock Article now requires a base stock unit when it is maintained through
the API. Purchase, issue and alternate units are configured per Article using
an explicit ratio such as `1 carton = 12 pieces`. The React application exposes
these definitions through **Article unit conversions** and shows conversion
previews during quotation, LPO and receipt entry.

The backend no longer silently treats an unconfigured carton, pallet or other
unit as a factor of one. Invalid units are rejected. Conversion definitions are
locked after transaction use, purchase-order totals use the supplier's selected
purchase unit, received stock is posted in base units, inventory batches carry
base-unit cost, and three-way matching compares the accepted base quantity at
the normalized base-unit cost.

Evidence:

- [`frontend/src/components/FormDrawer.tsx`](frontend/src/components/FormDrawer.tsx)
- [`frontend/src/screens/ProcurementWorkbench.tsx`](frontend/src/screens/ProcurementWorkbench.tsx)
- [`hotel_erp_backend/apps/inventory/models.py`](hotel_erp_backend/apps/inventory/models.py)
- [`hotel_erp_backend/apps/procurement/models.py`](hotel_erp_backend/apps/procurement/models.py)
- [`hotel_erp_backend/apps/finance/models.py`](hotel_erp_backend/apps/finance/models.py)
- [`hotel_erp_backend/tests/test_inventory.py`](hotel_erp_backend/tests/test_inventory.py)
- [`hotel_erp_backend/tests/test_procurement.py`](hotel_erp_backend/tests/test_procurement.py)
- [`hotel_erp_backend/tests/test_finance_integration.py`](hotel_erp_backend/tests/test_finance_integration.py)

## 7. Current Cross-Cutting UI Behaviour

### 7.1 Forms and quick creation

Status: `PARTIAL` · Evidence: `CODE`, `BUILD`

- A generic drawer creates and edits configured master and document records.
- Forms with more than six visible fields are divided into pages of four fields.
- Department material requests explicitly use a two-phase flow: save request details, then add one or more request items in the inventory workbench.
- Purchase requisitions similarly return to the procurement workbench for line entry.
- Save buttons display `Saving…` and are disabled while the request is active.
- Frontend mutation requests include in-flight duplicate protection, but backend idempotency is not documented as a general guarantee.

Evidence:

- [`frontend/src/components/FormDrawer.tsx`](frontend/src/components/FormDrawer.tsx)
- [`frontend/src/state/AppContext.tsx`](frontend/src/state/AppContext.tsx)
- [`frontend/src/lib/api.ts`](frontend/src/lib/api.ts)

### 7.2 Smart tables

Status: `PARTIAL` · Evidence: `CODE`

Generic lists provide local search, status filtering, sorting, pagination,
column selection, saved view settings, row selection and CSV export. Some rows
open specialised requisition or purchase-order documents. Other generic-list
rows open a reusable detail drawer showing all available fields and related
collections. Finance, report, audit and access-control table rows use the same
detail pattern, while procurement and inventory workbench rows retain their
specialised drawers.

The target reference-card presentation and contextual actions such as
`Generate PO` are not implemented as a universal table pattern.

Evidence:

- [`frontend/src/components/RecordDetailDrawer.tsx`](frontend/src/components/RecordDetailDrawer.tsx)
- [`frontend/src/screens/ListView.tsx`](frontend/src/screens/ListView.tsx)
- [`frontend/src/screens/FinanceWorkbench.tsx`](frontend/src/screens/FinanceWorkbench.tsx)
- [`frontend/src/screens/ReportView.tsx`](frontend/src/screens/ReportView.tsx)
- [`frontend/src/screens/AuditLog.tsx`](frontend/src/screens/AuditLog.tsx)
- [`frontend/src/screens/AccessManagement.tsx`](frontend/src/screens/AccessManagement.tsx)

### 7.3 Document detail

Status: `PARTIAL` · Evidence: `CODE`

- Requisition and purchase-order detail shows document metadata, lines and readiness requirements.
- Requisitions show approval route and actionable approve/return/reject controls when permitted.
- Procurement workbench drawers provide controlled document review, printing, attachments, communications and history where data and permission are available.
- Inventory drawers provide printable document and line views.
- Generic records and non-document table rows open a readable field/collection drawer.
- There is no shared tabbed document page consistently exposing Overview, Items, Workflow, History, Attachments, Comments and Audit for every document type.

Evidence:

- [`frontend/src/screens/DetailView.tsx`](frontend/src/screens/DetailView.tsx)
- [`frontend/src/screens/ProcurementWorkbench.tsx`](frontend/src/screens/ProcurementWorkbench.tsx)
- [`frontend/src/screens/InventoryWorkbench.tsx`](frontend/src/screens/InventoryWorkbench.tsx)

### 7.4 Notifications

Status: `PARTIAL` · Evidence: `CODE`, `TEST SOURCE`

The header fetches notifications, displays unread counts and supports marking one
or all notifications read. Selecting a notification currently marks it read but
does not use notification metadata to navigate to the related document.

The existence of example events in the target design does not prove that every
event source is emitted by the backend.

Evidence:

- [`frontend/src/components/Header.tsx`](frontend/src/components/Header.tsx)
- [`hotel_erp_backend/apps/notifications/urls.py`](hotel_erp_backend/apps/notifications/urls.py)
- [`hotel_erp_backend/tests/test_notifications.py`](hotel_erp_backend/tests/test_notifications.py)

### 7.5 Global search

Status: `PROPOSED` · Evidence: `CODE`

The header displays a search input, but it has no value state, event handler,
search endpoint call or results screen. List, audit and access-management screens
have their own local searches.

Evidence:

- [`frontend/src/components/Header.tsx`](frontend/src/components/Header.tsx)
- [`frontend/src/screens/ListView.tsx`](frontend/src/screens/ListView.tsx)

### 7.6 Status colours

Status: `PARTIAL` · Evidence: `CODE`

The theme defines semantic good, warning and bad colours. `chipStyleFor` maps a
small set of display labels to those colours. It does not map every lowercase or
underscore-separated backend status and does not implement the full target
colour standard exactly.

Evidence: [`frontend/src/lib/theme.ts`](frontend/src/lib/theme.ts)

### 7.7 Loading, empty, validation and confirmation states

Status: `PARTIAL` · Evidence: `CODE`

- Workbenches, reports and notifications display textual loading states.
- Skeleton loading components were not found.
- Lists, workbenches, dashboards and reports provide empty-state text; creation calls-to-action are not yet consistent everywhere.
- A reusable destructive confirmation dialog exists for deletions.
- Some screens provide readiness checklists and disabled actions, while most detailed business validation is returned by the backend through workflow alerts rather than shown inline per field.

Evidence:

- [`frontend/src/components/ConfirmDialog.tsx`](frontend/src/components/ConfirmDialog.tsx)
- [`frontend/src/components/WorkflowAlert.tsx`](frontend/src/components/WorkflowAlert.tsx)
- [`frontend/src/screens/DetailView.tsx`](frontend/src/screens/DetailView.tsx)
- [`frontend/src/screens/ReportView.tsx`](frontend/src/screens/ReportView.tsx)

### 7.8 Reports

Status: `PARTIAL` · Evidence: `CODE`

The frontend connects selected operational reports to backend endpoints for
stock summary/valuation, low stock, expiry, consumption, procurement summary and
stock card. Other catalogue reports are built from data already loaded in the
frontend session. Reports support relevant filters, pagination and CSV, Excel
and print-to-PDF exports.

Evidence:

- [`frontend/src/screens/Reports.tsx`](frontend/src/screens/Reports.tsx)
- [`frontend/src/screens/ReportView.tsx`](frontend/src/screens/ReportView.tsx)
- [`frontend/src/lib/reports.ts`](frontend/src/lib/reports.ts)
- [`hotel_erp_backend/apps/reports/urls.py`](hotel_erp_backend/apps/reports/urls.py)

### 7.9 Responsive behaviour

Status: `PARTIAL` · Evidence: `CODE`, `BUILD`

Responsive rules collapse workbench columns, convert the sidebar into a
horizontal navigation area, adapt generic tables to cards, resize form drawers
and make workflow paths horizontally scrollable. The complete mobile workflows
have not been live-tested for every role and document action.

Evidence: [`frontend/src/index.css`](frontend/src/index.css)

## 8. Current API Surface Relevant to the Target Design

The backend exposes authenticated REST resources for:

- Organisation, branches, departments and employees.
- Users, roles and permissions.
- Items, categories, units, stores, balances, batches and ledger.
- Store requisitions, issues, transfers, adjustments, counts, returns and consumption.
- Purchase requisitions, approvals, quotations, purchase orders, receipts, inspections, supplier returns, attachments and communications.
- Suppliers and supplier pricing.
- Supplier invoices, supplier payments, expenses, cashflow and banking.
- Notifications, audit logs and operational reports.

Evidence:

- [`hotel_erp_backend/apps/inventory/urls.py`](hotel_erp_backend/apps/inventory/urls.py)
- [`hotel_erp_backend/apps/procurement/urls.py`](hotel_erp_backend/apps/procurement/urls.py)
- [`hotel_erp_backend/apps/finance/urls.py`](hotel_erp_backend/apps/finance/urls.py)
- [`hotel_erp_backend/apps/reports/urls.py`](hotel_erp_backend/apps/reports/urls.py)
- [`hotel_erp_backend/apps/accounts/urls.py`](hotel_erp_backend/apps/accounts/urls.py)

## 9. Known Current Limitations

These limitations prevent the corresponding target claims from being marked
verified:

1. Production deployment of the current working-tree frontend changes is not verified.
2. Complete role-by-role live UAT has not been recorded.
3. Header global search is visual only.
4. Notification selection does not deep-link to the related record.
5. Launchpad Recent and My Tasks sections do not exist.
6. Finance launchpad classification conflicts with Finance being available inside Operations.
7. The target's universal tabbed document page is not implemented.
8. Skeleton loading is not implemented.
9. Budget availability and warning behaviour has no verified budget source or enforcement flow.
10. Status-colour mapping is incomplete for actual backend statuses.
11. Several target dashboard metrics are not backed by the datasets currently loaded into those dashboards.
12. Backend workflow concerns identified during prior inspection still require resolution and live verification, including adjustment action routing, inspection enforcement on direct receipt posting, legacy transfer application and supplier delivery-note uniqueness.
13. Branch selection in the frontend must not be treated as proof of backend tenant isolation.
14. Real supplier email delivery remains dependent on production email configuration and has not been verified here.

See [UI/UX Gap Register](UI_UX_GAP_REGISTER.md) for disposition and priority.

## 10. Verification Record for This Documentation Update

| Check | Result |
|---|---|
| Frontend TypeScript validation | Passed: `npx tsc --noEmit --incremental false -p tsconfig.json`. |
| Frontend production bundle | Passed: `npx vite build`. |
| Repository source inspection | Completed for routes, access rules, major screens, API routers, status models and role setup. |
| Backend test execution during this documentation audit | Passed: full `pytest -q` suite after UoM controls; targeted inventory/procurement/finance run passed 25 tests. |
| Deployed production browser test | Not run. |
| Production database verification | Not performed. |

This record must be updated when live UAT is completed; code inspection alone is
not sufficient to promote a capability to `VERIFIED`.
