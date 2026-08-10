# Hotel Operations ERP UI/UX Gap Register

> **Document classification: CONTROLLED GAP REGISTER**
>
> Audit date: 2026-08-01
>
> Evidence environment: repository working tree; deployed production verification is outstanding.

Companion documents:

- [Current UI/UX Behaviour](CURRENT_UI_UX_BEHAVIOR.md)
- [Target UI/UX Design Specification](Hotel_Operations_ERP_UI_UX_Design_Specification.md)

## 1. How to Use This Register

This register prevents a target design from being reported as current system
behaviour. Each target capability has an implementation status, an evidence
level, a specific gap or design decision, and a priority.

Status definitions:

| Status | Promotion rule |
|---|---|
| `VERIFIED` | Screen, route, API, database result, permission and deployed live behaviour are recorded. |
| `IMPLEMENTED–UNVERIFIED` | Code exists and relevant builds pass, but deployed role-based UAT is incomplete. |
| `PARTIAL` | Only part of the target exists or some paths are disconnected. |
| `PROPOSED` | No implementation supporting the target was found. |
| `BLOCKED` | A backend capability or business decision must exist first. |
| `NOT SUPPORTED` | Product decision excludes the target behaviour. |

Evidence levels:

- `CODE` — inspected in source.
- `BUILD` — TypeScript/build check passed.
- `TEST SOURCE` — automated coverage exists, but this audit does not claim execution.
- `LIVE` — exercised in the deployed system with the correct role and database result.

Priorities:

- **Critical** — incorrect implementation could bypass a control or misstate system behaviour.
- **High** — materially affects completion of an operational workflow.
- **Medium** — meaningful usability or consistency improvement.
- **Low** — polish that does not block correct processing.

## 2. Traceability Matrix

| ID | Target capability | Status | Evidence | Current evidence | Gap, decision or required work | Priority |
|---|---|---|---|---|---|---|
| UX-001 | Header, module navigation, context menu and main workspace | `PARTIAL` | `CODE`, `BUILD` | [`AppShell.tsx`](frontend/src/screens/AppShell.tsx), [`Header.tsx`](frontend/src/components/Header.tsx), [`Sidebar.tsx`](frontend/src/components/Sidebar.tsx) | Header, sidebar and workspace exist. The target's additional horizontal module bar does not. Decide whether to reject it; current recommendation is to avoid three competing navigation layers. | Medium |
| UX-002 | Application launchpad for all business areas | `PARTIAL` | `CODE` | [`Launchpad.tsx`](frontend/src/screens/Launchpad.tsx), [`access.ts`](frontend/src/lib/access.ts) | Only Operations and HR are active launchpad modules. Finance is shown as planned although finance screens exist inside Operations. Keep direct role landing for single-module users; reconcile Finance classification. | Medium |
| UX-003 | Launchpad Recent, My Tasks and alert counts | `PROPOSED` | `CODE` | [`Launchpad.tsx`](frontend/src/screens/Launchpad.tsx) | No recent-document or task aggregation is rendered. Define task-query sources, role filtering and deep links before building the cards. | Medium |
| UX-004 | Procurement Manager dashboard metrics and quick actions | `PARTIAL` | `CODE` | [`Dashboard.tsx`](frontend/src/screens/Dashboard.tsx) | Open requisitions, value, LPOs, suppliers, charts and a queue exist. Quotation counts, supplier-response state and dashboard quick-create actions are missing. Connect to quotation/communication data before adding those metrics. | High |
| UX-005 | Stores dashboard metrics, alerts and quick actions | `PARTIAL` | `CODE` | [`StoresDashboard.tsx`](frontend/src/screens/StoresDashboard.tsx) | Inventory value, pending requests/issues, low stock, expiry and tool links exist. Today's receipts, transfer count and return count are not separate verified metrics. | Medium |
| UX-006 | Finance dashboard based on invoices, matching and payments | `PARTIAL` | `CODE` | [`Dashboard.tsx`](frontend/src/screens/Dashboard.tsx), [`FinanceWorkbench.tsx`](frontend/src/screens/FinanceWorkbench.tsx) | Finance dashboard uses mainly requisitions and LPO commitments. Load supplier-invoice/payment datasets and calculate match exceptions, due payments, supplier balance and today's posted payments. | High |
| UX-007 | Inventory navigation divided into Operations, Stock, Control and Reports | `PARTIAL` | `CODE`, `BUILD` | [`Sidebar.tsx`](frontend/src/components/Sidebar.tsx) | Current sidebar separates workflow starts from records and hides unauthorised routes. Decide whether the target tree is clearer than the implemented task-first grouping; do not implement a second duplicate hierarchy. | Medium |
| UX-008 | Procurement workbench covering requisitions, quotations, LPOs, receipts, inspections and returns | `IMPLEMENTED–UNVERIFIED` | `CODE`, `BUILD`, `TEST SOURCE` | [`ProcurementWorkbench.tsx`](frontend/src/screens/ProcurementWorkbench.tsx), [procurement API routes](hotel_erp_backend/apps/procurement/urls.py) | Complete deployed role-based UAT is required. Confirm every stage starts only from an eligible predecessor and records the expected status/history. | Critical |
| UX-009 | Procurement filters for branch, department, supplier, date and status | `PARTIAL` | `CODE` | [`ListView.tsx`](frontend/src/screens/ListView.tsx), [`ProcurementWorkbench.tsx`](frontend/src/screens/ProcurementWorkbench.tsx) | Generic lists support local search/status filtering; the workbench has no complete cross-stage filter bar. Specify server/client filtering and branch-authorisation semantics. | Medium |
| UX-010 | One end-to-end Need-to-Payment workflow visualisation | `PARTIAL` | `CODE`, `BUILD` | [`WorkflowPath.tsx`](frontend/src/components/WorkflowPath.tsx), the three workbenches | The frontend now shows separate Department Supply, Procurement and Invoice-to-Payment paths. Keep these separate; replace the single master chain with linked process maps so optional and independent flows are not presented as mandatory. | High |
| UX-011 | Four-step purchase-requisition wizard with review and approval route | `PARTIAL` | `CODE`, `BUILD` | [`FormDrawer.tsx`](frontend/src/components/FormDrawer.tsx), [`ProcurementWorkbench.tsx`](frontend/src/screens/ProcurementWorkbench.tsx) | Request details and line entry exist across the drawer/workbench, but no four-step review screen exactly matches the target. Design an explicit review/approval-route preview only after the backend can calculate it before submission. | High |
| UX-012 | Smart tables with filters, saved views, exports, row details and actions | `PARTIAL` | `CODE`, `BUILD` | [`ListView.tsx`](frontend/src/screens/ListView.tsx), [`RecordDetailDrawer.tsx`](frontend/src/components/RecordDetailDrawer.tsx) | Search, status filter, sort, pagination, columns, saved view, selection, CSV and universal row inspection exist. Reference cards and consistent contextual workflow actions do not. Define actions per document status and permission. | Medium |
| UX-013 | `Generate PO` directly from a requisition table | `PROPOSED` | `CODE` | [`ProcurementWorkbench.tsx`](frontend/src/screens/ProcurementWorkbench.tsx), [procurement models](hotel_erp_backend/apps/procurement/models.py) | A generic action would bypass sourcing controls. If retained, show it only when the requisition is fully approved and the required quotation award is complete; the API must enforce the same guard. | Critical |
| UX-014 | Universal tabbed document page: Overview, Items, Workflow, History, Attachments, Comments, Audit | `PARTIAL` | `CODE` | [`DetailView.tsx`](frontend/src/screens/DetailView.tsx), procurement/inventory drawers | Requisition detail and specialised drawers expose subsets. Build a shared document shell only after defining which APIs and permissions supply each tab for every document type. | Medium |
| UX-015 | Related-document panel and activity feed | `PARTIAL` | `CODE` | Procurement history, attachments and communications in [`ProcurementWorkbench.tsx`](frontend/src/screens/ProcurementWorkbench.tsx) | Procurement has supporting evidence, but there is no universal relation graph or activity feed. Define document relationships and audit-event presentation per entity. | Medium |
| UX-016 | Notification centre with operational events | `PARTIAL` | `CODE`, `TEST SOURCE` | [`Header.tsx`](frontend/src/components/Header.tsx), [notification API](hotel_erp_backend/apps/notifications/urls.py) | Fetch, unread count and mark-read exist. Add entity/record metadata, permission-safe deep links and an event-source inventory. Verify each target event independently. | High |
| UX-017 | Supplier acknowledged LPO notification | `PROPOSED` | `CODE` | Purchase orders have email fields; no verified supplier-portal acknowledgement journey was found. | Define acknowledgement source: supplier portal, signed email link or manual procurement record. Do not emit the event until the source is auditable. | Medium |
| UX-018 | Global cross-module search | `PROPOSED` | `CODE` | Header search input in [`Header.tsx`](frontend/src/components/Header.tsx) has no handler. | Design a permission- and branch-filtered search API, result schema, keyboard interaction, result screen and deep links. | High |
| UX-019 | Exact status-colour standard | `PARTIAL` | `CODE` | [`theme.ts`](frontend/src/lib/theme.ts) | Semantic colours exist, but mapping is label-based and incomplete for actual lowercase/underscore statuses. Create one canonical mapping for every backend status and test accessible contrast. | High |
| UX-020 | Global quick-create for PR, store request, supplier, invoice and transfer | `PARTIAL` | `CODE`, `BUILD` | Generic create drawers and direct start actions exist on relevant lists/workbenches. | Add a permission-aware quick-create menu only for operations that have a safe continuation path. Never show unavailable actions. | Medium |
| UX-021 | Hierarchical breadcrumbs | `PARTIAL` | `CODE` | Header shows module/workspace and one current crumb. | Add document hierarchy and clickable parents without duplicating sidebar navigation. Preserve the originating list/workbench when returning from detail. | Low |
| UX-022 | Actionable empty states | `PARTIAL` | `CODE` | Empty text exists across lists, dashboards, reports and workbenches. | Standardise empty-state reason, required predecessor and permitted next action. Do not offer creation when role/status prevents it. | Medium |
| UX-023 | Skeleton loading | `PROPOSED` | `CODE` | Current screens use loading text; no shared skeleton component found. | Add only after workflow correctness and accessibility. Respect reduced-motion settings. | Low |
| UX-024 | Destructive confirmation dialog | `IMPLEMENTED–UNVERIFIED` | `CODE` | [`ConfirmDialog.tsx`](frontend/src/components/ConfirmDialog.tsx) and delete flow in `AppContext`. | Verify entity-specific labels, role permission, recoverability wording and production error behaviour. Some workflow cancellations use controlled actions rather than delete. | Medium |
| UX-025 | Inline quantity/supplier readiness validation | `PARTIAL` | `CODE`, `TEST SOURCE` | Requisition detail readiness checks, disabled actions and backend workflow errors exist. | Add field-level availability/supplier indicators only from authoritative APIs. Preserve backend enforcement; frontend checks are advisory. | High |
| UX-026 | Budget warning and budget-limit validation | `BLOCKED` | `CODE` | No verified budget allocation source or enforcement workflow was found. | Define budget ownership, period, encumbrance rules, override roles and authoritative API before designing warnings. | Critical |
| UX-027 | Responsive requisition cards and mobile approval actions | `PARTIAL` | `CODE`, `BUILD` | [`index.css`](frontend/src/index.css) includes table-card, drawer, workbench and workflow-path adaptations. | Run role-based mobile UAT for long forms, line editing, approvals, attachments, notifications, tables and errors at supported breakpoints. | High |
| UX-028 | Reports for valuation, movement, consumption and low stock | `PARTIAL` | `CODE` | [`Reports.tsx`](frontend/src/screens/Reports.tsx), [`ReportView.tsx`](frontend/src/screens/ReportView.tsx), [report API routes](hotel_erp_backend/apps/reports/urls.py) | Selected reports use live endpoints while others use session data. Make data provenance explicit and complete role/branch permission verification for every report. | High |
| UX-029 | Negative-stock alert | `PROPOSED` | `CODE`, `TEST SOURCE` | Inventory posting is intended to block negative stock. | Decide whether this means an integrity-anomaly report or a projected-shortage alert. Do not imply negative stock is a normal operational state if the backend invariant forbids it. | Medium |
| UX-030 | Role/action matrix in the target specification | `PARTIAL` | `CODE` | Backend role definitions exist in [`setup_hotel_roles.py`](hotel_erp_backend/apps/accounts/management/commands/setup_hotel_roles.py), but the target document does not map roles to each screen/action. | Add View/Create/Edit/Submit/Approve/Reject/Post/Cancel permissions and any department/branch ownership conditions to every screen specification. | Critical |
| UX-031 | API, database and acceptance-criteria traceability | `PARTIAL` | `CODE` | Current-behaviour document links major screens, routers and models; target screens do not yet contain per-action traceability. | For every target action, record request/response, status precondition, database outcome, audit event, error states and acceptance tests. | Critical |
| UX-032 | Production verification and release evidence | `PROPOSED` | `BUILD` | Local TypeScript and Vite builds pass; deployed role-based UAT was not performed in this audit. | Create a release evidence record for each role and workflow, including production branch/commit, deployment ID, API environment and database outcome. | Critical |
| UX-033 | Article-specific purchase/base/issue unit conversion | `IMPLEMENTED–UNVERIFIED` | `CODE`, `BUILD`, `TEST` | Article conversion register, API validation, transaction conversion previews, base-quantity posting and normalized valuation are implemented. Targeted and full backend suites pass. | Deploy and live-test creation of a base Article, carton conversion, supplier price, quotation, LPO, partial receipt, stock balance and invoice match. Audit any transactions created before this control was deployed. | Critical |

## 3. Backend-Control Gaps Affecting UI Claims

These are not merely visual defects. The UI must not present these paths as
verified until the backend behaviour and tests are resolved:

| ID | Control concern | Current disposition | Required evidence |
|---|---|---|---|
| CTRL-001 | Stock-adjustment submit/approve/reject action routing | Inspect and correct the registered viewset/action ownership. | Endpoint tests proving draft → pending → approved/rejected under correct roles. |
| CTRL-002 | Direct GRN-line posting without an inspection | Require accepted inspection evidence when the business process requires inspection. | Tests showing uninspected quantity cannot post and accepted quantity is capped. |
| CTRL-003 | Legacy transfer apply path | Remove or guard any path that bypasses approval/dispatch/receipt. | Tests proving pending → approved/dispatch → in transit → receipt/completed. |
| CTRL-004 | Duplicate supplier delivery-note enforcement | Add serializer/database-safe validation rather than relying only on model `clean()`. | API test proving duplicate supplier delivery note is rejected. |
| CTRL-005 | Branch selector versus backend tenant isolation | Treat frontend scoping as presentation only until backend querysets are verified. | Cross-branch API tests for every sensitive resource and report. |
| CTRL-006 | Supplier email/acknowledgement | Treat delivery and acknowledgement as conditional on production email/portal configuration. | Delivery logs and auditable acknowledgement source in the deployed environment. |

## 4. Recommended Delivery Order

### Phase 1 — Control correctness

1. Resolve CTRL-001 through CTRL-005.
2. Document exact status machines for department requests, purchase requisitions, LPOs, GRNs/inspections, invoices, payments, transfers, adjustments and counts.
3. Complete the role/action matrix.
4. Add API and database acceptance criteria to target actions.

### Phase 2 — Complete operational journeys

1. Run deployed UAT for Department Requester, Department Head, Stores Manager, Store Keeper, Procurement Manager, Receiving Officer and Finance Controller.
2. Correct any status/action mismatch found during UAT.
3. Connect Finance dashboard metrics to finance datasets.
4. Complete notification deep links and event coverage.
5. Verify all live reports by role and branch.

### Phase 3 — Findability and document consistency

1. Implement permission-safe global search.
2. Standardise document pages and related-document navigation.
3. Complete workbench/list filtering.
4. Standardise status colours and empty states.
5. Add permission-aware quick create.

### Phase 4 — Polish

1. Complete mobile UAT and refinements.
2. Add skeleton loading where it materially improves perceived wait time.
3. Consider launchpad Recent/Favourites only after task aggregation and deep links are reliable.

## 5. Status Promotion Checklist

Before changing any row to `VERIFIED`, attach or record:

- [ ] Frontend route and screen.
- [ ] User role and required permission.
- [ ] Eligible starting record/status.
- [ ] API endpoint/action and request payload.
- [ ] Expected response and database status/result.
- [ ] Audit/history/notification result, when required.
- [ ] Invalid-status test.
- [ ] Unauthorised-role test.
- [ ] Cross-branch isolation test, when applicable.
- [ ] Mobile result for user-facing workflows.
- [ ] Deployed branch, commit and deployment identifier.
- [ ] Test date and tester.

Until every mandatory item is satisfied, the capability remains
`IMPLEMENTED–UNVERIFIED` or `PARTIAL` rather than `VERIFIED`.

## 6. Decision Log

| Date | Decision | Reason |
|---|---|---|
| 2026-08-01 | Keep the original design document as the target-state file and add an explicit classification banner. | Preserves the design vision while preventing it from being used as current-state evidence. |
| 2026-08-01 | Split the master workflow into Department Supply, Procurement and Invoice-to-Payment journeys. | The processes have different actors, documents, statuses and optional branches. |
| 2026-08-01 | Do not treat repository implementation as production verification. | Build success cannot prove deployed API, permission and database behaviour. |
| 2026-08-01 | Recommend task-first sidebar navigation and avoid adding a duplicate top-level module bar without user testing. | Duplicate navigation paths contributed to the original flow confusion. |
