# Hotel Management System — Verified Process and Role Documentation

**Evidence baseline:** current working tree based on branch `back$front`, commit `c0f6d70e4fb76b5023453fe14fddb9a9059a71f5` (31 July 2026), including the verified report integration implemented on 1 August 2026.  
**Verification date:** 1 August 2026.  
**Rule:** A capability is described as operational only when verified in a checked-in screen, API, permission, model/service, test, or observed response. Anything else is marked **Information not available — requires confirmation.**

## Evidence and interpretation

Evidence reviewed:

- React navigation, screens, forms, route guards, state, report builder, and API client in `frontend/src/`.
- Django models, serializers, viewsets, permissions, URLs, signals, settings, and migrations in `hotel_erp_backend/`.
- Provisioned roles in `apps/accounts/management/commands/setup_hotel_roles.py`.
- Verification: frontend production build passed, Django check passed, and all 60 collected backend tests passed.
- Read-only production checks: configured frontend and backend health endpoint returned HTTP 200.
- The user-supplied production screenshot.

“Screen” means a React operator screen. “API-only” means Django exposes it but React does not. A test proves its tested case, not every permission or alternative path.

---

## 1. System overview

### 1.1 Implemented scope

This hotel operations ERP implements:

- authentication, hotel/branch setup, departments, employees, accounts, roles, and permissions;
- article categories, units/conversions, stores, suppliers/prices, balances, batches, and ledgers;
- purchase requisitions, configurable approval, quotations, POs, receiving, inspection, and supplier returns;
- department requests, reservations, issues, acknowledgements, returns, transfers, adjustments, counts, consumption, and reorder generation;
- supplier invoice matching/payment, expenses, payment methods, bank accounts, and transactions;
- dashboards, live backend reports, session-data registers, notifications, and selected audit events;
- sales/customer records through Django API/admin only.

The Launchpad exposes **Hotel Operations** and **Human Resources**. It labels Finance & Accounting, Front Office, Restaurant & POS, and Maintenance as planned, although supplier finance exists inside Operations. No React Front Office, reservation, guest-stay, POS, restaurant, maintenance, or customer/sales screen was found.

### 1.2 Components and actors

| Component/actor | Verified responsibility |
|---|---|
| React/Vite | Token login, permission-filtered navigation/actions, workbenches, API mapping, branch display filtering, dashboards, exports. |
| Django REST API | Authentication, model permissions, workflow validation, atomic posting, filtering/search, pagination. |
| PostgreSQL/Neon | Production persistence; production requires `DATABASE_URL`. |
| Email backend | Sends/resends LPOs and records communication outcomes. |
| Supplier | External record/email recipient; no supplier login. Staff records acknowledgement. |
| Customer | External record/ledger participant; no customer login or React screen. |
| Vercel | Deployment; backend build runs migrations, role setup, and Django check. |

### 1.3 Actual React screens

| Area | Screens | Boundary |
|---|---|---|
| Session | Login, Launchpad, App Shell | Token restoration; five-minute inactivity logout. |
| Overview | Dashboard, Stores Dashboard, Workflow Hub | Browser-loaded metrics. |
| Procurement | Requisition/detail, Approvals, Procurement Workbench, PO/GRN lists | Request, quote, LPO, receipt, inspect, return. |
| Inventory | Catalogue/balance/ledger/batch lists, Inventory Workbench | Requests, issues, transfers, adjustments, counts, returns, reorder, batches, consumption. |
| Finance | Finance Workbench | Invoice/payment, expense, banking, methods; cash-flow/daily-summary lack direct tabs. |
| HR/security | HR Dashboard, Employees, Departments, Access Management | Access APIs additionally require staff. |
| Control | Hotel Profile, Reports, Audit Log | Reports use operational-report permissions; AuditLog still has a staff-role mismatch. |
| Sales/customers | None | API/admin-only. |

### 1.4 API/access conventions

- Base API `/api/v1/`; page size 25; React follows up to 20 pages.
- React uses Token auth; session/basic are also configured.
- GET requires `view_*`; create `add_*`; update/custom action `change_*`; delete `delete_*`.
- Hotel/branch/department are authenticated-read and staff-write.
- User/role/permission and AuditLog APIs require staff beyond model permission.
- Most operational APIs lack branch row scoping. Frontend branch selection filters already-loaded data; it is not tenancy security.
- Frontend hiding is usability only; backend controls are authoritative.

---

## 2. All system roles

### 2.1 Provisioned human roles

| Role | Purpose | Verified default access |
|---|---|---|
| System Administrator | Full administration/override | All permissions and frontend bypass; provisioned account is staff. |
| General Manager | Oversight/high-level control | View all; change approvals, PR/PO, transfer, adjustment, count; no general create/delete. |
| Procurement Manager | Run sourcing/ordering | Supplier/broad procurement CRUD, supplier price/reorder CRUD, approval change, reference views. |
| Finance Controller | Validate/pay liability | Full finance CRUD, PR approval/change, procurement/supplier/inventory/customer/sales views. |
| Stores Manager | Own stock controls | Broad inventory CRUD, GRN/GRN-item/supplier-return change, procurement/reference views. |
| Store Keeper | Execute store work | CRUD requests, issues, department returns, counts/lines; catalogue/balance/batch/ledger views. |
| Department Requester | Request store stock | CRUD own-visible requests/lines and limited references; direct article route hidden. |
| Department Head | Authorize department demand | Request CRUD, department/branch visibility, department and assigned PR approval. |
| Receiving Officer | Receive/inspect/return | CRUD GRN/inspection/attachment/supplier-return; PO/supplier/inventory views. |
| Auditor | Read-only oversight | All `view_*`; AuditLog still needs staff. Operational reports are available through inventory/procurement view permissions. |

Custom groups can be created. Account management assigns at most one group through this API path.

### 2.2 Other actors

| Actor | Verified interaction |
|---|---|
| Assigned PR approver | Active fixed employee, requesting Department Head, or exactly one branch role holder; never requester. |
| Supplier representative | Receives LPO externally; staff records acknowledgement/return response. |
| Department receiver | Receives issue; staff records Employee or typed name. |
| Customer | Attached to sales/payments/ledger; no authenticated action. |
| Automated services | Generate references/routes, validate, reserve/post stock, create ledgers/batches/consumption, synchronize, notify, audit, email. |

---

## 3. Role responsibilities

**System Administrator:** maintains property, workforce, accounts, roles, masters, and transactions; can execute workflows through full permissions, but notifications remain employee-targeted.

**General Manager:** reviews all records; changes assigned control documents; may create PR on behalf of others; decides only when an approval rule resolves that employee.

**Procurement Manager:** maintains suppliers, pricing/reorder, PR/quote/PO/inspection/return/communication/attachments; submits, awards, issues/resends, and records supplier acknowledgement. Default role views but does not add/change GRNs.

**Finance Controller:** decides assigned PR stages; manages invoice match/approval/payment, expenses, banking, cash-flow/daily summary, and methods; reads source evidence. Supplier-payment posting does not automatically post bank/cash-flow.

**Stores Manager:** maintains inventory; decides request quantities, reserves/rejects, confirms shortage/resumes; executes permitted transfers, adjustments, counts, issues, returns, and receipt controls.

**Store Keeper:** creates/picks/posts issues, records acknowledgements, receives department returns, performs counts. No default transfer/adjustment permission.

**Department Requester:** creates own forced-identity draft request, edits Draft/Rejected lines, submits, sees own records, corrects/resubmits.

**Department Head:** sees same department/branch requests, approves/rejects department stage; own request bypasses separate queue; decides assigned PR steps.

**Receiving Officer:** creates GRNs/lines/destinations, inspection decisions/posting, supplier return/posting/acknowledgement.

**Auditor:** intended read-only across system, but AuditLog requires separate staff status.

### 3.1 Enforced separation/limitations

- PR requester cannot approve own request through matrix resolution.
- Approval stages are sequential.
- Department and Stores approvals have named-role endpoint checks.
- Supplier acknowledgement is staff-recorded, not supplier-authenticated.
- Transfer/count can be self-approved when an actor holds change permission.
- Adjustment submit/approve/reject routing is broken; section 16.

---

## 4. All major processes

| Process | Trigger | Records | Normal end |
|---|---|---|---|
| Authentication | Credentials | User, Token | Session; logout revokes tokens. |
| Setup | Staff configures organization | Hotel, Branch, Department, Employee, User, Group | Active scoped account. |
| PR/approval | Demand/shortage/reorder | PR/Items, Matrix, Workflow, History, Notification | Approved/fulfilled/closed or returned/rejected/cancelled. |
| Sourcing | Offers captured | Quotation/Items | Complete winner. |
| LPO | Approved remaining demand | PO/Items, Communication | Issued/emailed/acknowledged. |
| Receipt/inspection | Supplier delivery | GRN/Items, Inspection/Items | Accepted stock/direct consumption. |
| Supplier return | Goods returned | Return/Items, Ledger | Posted/acknowledged. |
| Department request | Store demand | Store Request/Items | Issued/acknowledged, rejected, or cancelled. |
| Shortage bridge | Insufficient stock | Store Request linked PR | Replenishment then resumed request. |
| Issue | Approved/reserved pick | Issue/Items, Balance, Batch, Ledger, Consumption | Applied once; partial/issued. |
| Store return | Unused stock | Return/Items, Balance, Ledger | Applied once. |
| Transfer | Inter-store movement | Transfer/Items, Balances, Ledgers | Completed. |
| Adjustment | Quantity correction | Adjustment/Items, Balance, Ledger | Intended applied; current API flow broken. |
| Count | Physical check | Count/Items, Balance, Ledger | Variance applied once. |
| Reorder | Stock ≤ minimum | Rule, draft PR/item | Draft hotel PR. |
| Invoice/payment | Supplier invoice | Invoice/Payment | Matched, approved, partial/paid. |
| Expense/banking | Finance entry | Expense, Bank records, Method | Standalone stored record. |
| Sale (API/admin) | Complete sale | Sale/Items, stock/ledger/cash/customer | Paid/partial and posted once. |
| Reporting/control | Open output | Loaded rows, reports, AuditLog | Display/export/review. |

---
+
## 5. Detailed step-by-step workflows

### 5.1 Authentication and workforce setup

Credentials → validate active username/employee code + password → create/reuse token → return role, branch, staff flags, permissions → React stores token and calls `/auth/me/` → permitted data loads. Missing input returns 400; invalid/inactive returns 401. Five-minute browser inactivity clears local session across tabs. Logout clears browser state then best-effort deletes all server tokens.

Staff creates branch/department then Employee. First/last name and temporary password are required. The system creates linked User, generates `EMP-00001` code/username if absent, and hashes password. Role is assigned separately. Employee update synchronizes account details/active state; Employee deletion soft-deactivates both records.

### 5.2 Purchase requisition and approval

1. Authorized actor creates department or hotel-purchase PR. Ordinary identity is replaced by signed-in Employee; superuser/System Administrator/Procurement Manager/General Manager may act on behalf.
2. System generates `PR-{BRANCH|HOTEL}-{YEAR}-{00001}` and derives branch, hotel, currency.
3. Authorized editor adds positive quantity/cost lines while Draft/Rejected/Returned.
4. Submit requires lines, positive values, department/requester when applicable, matching rules, and exactly one independent active approver per stage.
5. System creates/resets steps, history, timestamp, and first-approver notification.
6. Assigned employee/superuser approves, rejects, or returns current stage. Reject/return require comments.
7. Approval advances/notifications continue. Final approval sets Approved and defaults unset approved quantities to requested.
8. Reject → Rejected; return → Returned; requester notified. Correct/resubmit resets all steps.
9. Issued PO quantities cause Partially Ordered/Ordered; posted accepted GRNs cause Partially Received/Fulfilled. Only Fulfilled can Close.

### 5.3 Quotation and LPO

Procurement creates one quotation per supplier/PR, enters PR-linked lines, prices, delivery, terms, tax, transport, discount, score/notes. Totals recalculate. Award requires reason, non-expiry, every PR line priced, and minimum quote count when estimate meets configured threshold (defaults: 1,000,000 and 3). Winner replaces earlier selections.

From Approved/Partially Ordered PR, Procurement generates PO for remaining approved quantity. Supplier resolves from explicit/preferred/single winner; prices from winner/lowest applicable quote or Supplier Item Price. Missing supplier/price/quantity blocks. Draft PO lines may be edited. Issue validates source/email/lines/non-overordering, sets Issued, synchronizes PR, emails supplier, records communication. Resend records outcome. Staff enters supplier representative acknowledgement; supplier has no login.

### 5.4 Receipt, inspection, posting, supplier return

Receiving creates GRN only for Issued/Partially Received PO. Duplicate supplier delivery note is blocked. Lines must belong to PO, not exceed remaining order, and target a store or direct department. One inspection records accepted/rejected amounts; their sum cannot exceed received. Whole-GRN posting requires Accepted/Partially Accepted inspection and positive accepted quantity.

Atomic posting:

- store target → increase Balance, create Batch and IN Ledger;
- direct department → create Department Consumption, no store Balance/Batch/Ledger;
- mark line/GRN applied and synchronize PO/PR.

Supplier return is linked to GRN supplier/articles. Apply checks store stock, subtracts Balance, writes OUT Ledger, and sets Posted/dispatched. Staff later records supplier acknowledgement, credit-note number, and replacement expected date. No replacement-received action was found.

### 5.5 Department request, shortage, issue

1. Requester creates Draft; normal identity/store are forced from Employee/default or first branch store.
2. Adds positive lines and submits.
3. Department Head submitter goes directly Submitted with recorded approval; other user → Pending Department Approval.
4. Head approves → Submitted or rejects → Rejected; rejected is editable/resubmittable.
5. Stores Manager enters line approved quantities. Approve atomically checks/reserves available stock and sets Approved/Partially Approved; absent positive explicit decisions default to full requested.
6. If short, Stores Manager creates exactly one linked department PR (initial cost zero) and sets Awaiting Procurement.
7. Resume after receipts requires full requested quantity of every line, then status returns Submitted.
8. Store staff creates issue/picks. Apply checks outstanding/stock, consumes tracked batches FEFO, reduces Balance/reservation, writes OUT Ledger and Consumption, and sets request Partially Issued/Issued.
9. After posting, authorized staff records Employee or typed receiver name.

### 5.6 Inventory controls

- **Transfer:** Pending/add lines → Approve records actor/time but remains Pending → Dispatch requires approval/stock, subtracts source/OUT Ledger, sets In Transit → Receive adds destination/IN Ledger, sets Completed. Compatibility `apply` bypasses approval and completes both legs.
- **Adjustment intended:** Draft/add lines → Submit Pending → Approve → Apply balance/ledger, or Reject → Cancelled. Submit/Approve/Reject endpoints are misregistered, so workbench cannot reliably complete it.
- **Count:** Draft → Populate balances/In Progress → physical quantities → Submit → Approve → Apply replaces balances/writes variance once. Non-applied may cancel.
- **Department return:** header/lines → Apply once → Balance increase/IN Ledger. No original issue link.
- **Reorder:** active and stock at/below minimum with no defined open PR → draft hotel PR. Missing supplier price creates zero estimate, blocking PR submission until corrected.

### 5.7 Supplier invoice/payment

Finance creates invoice linked to supplier/PO. Match sums posted accepted GRN quantity × cost and compares subtotal within 0.01; positive match → Matched, otherwise Exception. Matched → Approved. Draft payment includes amount/date/method/reference/optional bank. Post requires Approved/Partially Paid invoice and amount ≤ outstanding; payment → Posted, invoice → Partially Paid/Paid. No automatic Bank Transaction, CashFlow, Expense, notification, or supplier communication is created.

### 5.8 Sale completion (API/admin only)

Complete requires store, lines, sufficient stock, and not cancelled/already posted. Atomic service reduces Balance, writes Sale Ledger, creates CashFlow for amount paid, and for a customer creates invoice/payment Customer Ledger entries and updates balance. Sale → Paid/Partially Paid. Separate Customer Payment/Allocation CRUD does not automatically update these states.

### 5.9 Reporting, notification, audit

React calls all six operational backend report endpoints for weighted stock valuation, low stock, stock card, expiry, consumption, and procurement status. Requests carry selected branch and supported store/category/item/date filters. Detailed PR, PO, GRN, and supplier registers remain explicitly marked session-data reports. All reports retain print/PDF, XML spreadsheet, and CSV exports. PR approval creates recipient-only notifications with mark-one/all-read. Audit signals cover StockLedger, decisions, and create/update/delete of selected procurement/inventory documents, not every model or full before/after fields.

---

## 6. End-to-end process flows

### 6.1 Procure-to-pay

`Demand → PR/lines → matrix resolution → sequential decision`

- Return/Reject → correction/resubmission or end.
- Approve → quotations → award → LPO → email/acknowledgement → GRN → inspection → accepted posting → invoice → three-way match → approve → payment(s) → Paid.
- PR completion proceeds through ordered/received/fulfilled, then optional Closed.

### 6.2 Department demand-to-consumption

`Store request → Department Head stage (or Head bypass) → Stores review`

- Stock available → decide/reserve → pick/issue → acknowledge → Consumption.
- Shortage → linked PR → normal procurement/receipt → full availability check → resume Stores review → reserve/issue.

### 6.3 Direct department delivery

`Approved PR → issued PO → direct-department GRN target → accepted inspection → post → Department Consumption`; no store ledger/balance/batch.

### 6.4 Stock control

Transfer: Pending → approval marker → In Transit → Completed.  
Count: Draft → In Progress → Submitted → Approved → Applied.  
Adjustment intended: Draft → Pending → Approved → Applied, but action routing interrupts it.  
Return: unapplied → applied once.

---

## 7. Decision points and business rules

| Decision | Rule | Success | Failure/alternative |
|---|---|---|---|
| PR identity override | Only privileged roles retain another requester | On-behalf identity | Ordinary identity forced; Employee required |
| PR submission | Editable, valid lines/value/identity and unique route | Submitted + steps | 400 blockers |
| Approval decision | Assigned/superuser; sequence valid | Advance/end | 403/400 |
| Quote award | Validity, reason, all lines, count threshold | Winner selected | Blocked |
| PO generation | Approved source, supplier, employee, remaining priced qty | Draft PO | Blocked |
| PO issue | Draft, valid source/email/lines | Email + Issued | Readiness/email error |
| GRN line/post | PO/remaining/destination and accepted inspection | Atomic posting | Blocked/rolled back |
| Head bypass | Submitter is Head of request department | Submitted | Pending Head approval |
| Stores approval | Submitted, valid decisions, sufficient available | Reserve + Approved/Partial | Atomic error |
| Resume shortage | Full requested qty for all lines | Submitted | Remains Awaiting Procurement |
| Issue post | Approved request, lines, stock/outstanding | Applied once | Blocked |
| Transfer dispatch | Pending, lines, approval, stock | In Transit | Blocked; `apply` bypass exists |
| Adjustment apply | Approved/no negative balance | Applied | Blocked; middle endpoints broken |
| Count apply | Approved/lines/not applied | Applied | Blocked |
| Reorder | Active, low, no open PR | Draft PR | Blocked |
| Invoice match | Positive accepted value, variance ≤ 0.01 | Matched | Exception |
| Payment | Draft, payable invoice, amount ≤ balance | Posted | Blocked |
| Authorization | Frontend and backend conditions | Allowed | Hidden/redirect or 401/403 |

---

## 8. Role-to-role interactions

| Initiator → receiver | Information | Receiver action | System result |
|---|---|---|---|
| Requester → Department Head | Store request/lines/purpose | Approve/reject | Submitted or Rejected |
| Department Head → Stores Manager | Authorized demand | Reserve/reject/shortage | Approved/Partial/Rejected/Awaiting Procurement |
| Stores Manager → Procurement | Linked shortage PR | Price/submit/source | Procurement begins without duplicate request |
| PR requester → assigned approver | PR evidence/value/stage | Approve/reject/return | History/audit/status/notification |
| Procurement → Supplier | LPO email | External acknowledge/deliver | Staff records response; GRN follows |
| Supplier/driver → Receiving | Goods/delivery note | GRN/inspection | Receipt evidence |
| Receiving → Finance | PO/posted accepted receipt | Match invoice | Matched/Exception |
| Finance → external bank/supplier | Payment instruction/reference | External settlement | ERP stores payment/invoice state only |
| Store Keeper → department receiver | Goods/issue | Receive | Staff records acknowledgement |
| Department → Store Keeper | Unused goods/reason | Return/post | Balance/Ledger increase |
| Operations → Auditor/admin | Stored audit events | Review/export | Audit visibility if staff check passes |

---

## 9. Automated system actions

| Trigger | Automatic action | Output |
|---|---|---|
| Employee create | Code/username and linked hashed-password User | Employee/User |
| Login | Validate and return/reuse token/permissions | Token |
| Document create | Generate readable PR/PO/GRN/SR/issue/return/count number | Reference |
| PR save/submit | Derive property data, resolve matrix, create/reset steps | PR/Workflow/History/Notification |
| Approval | State/timestamp/history/audit; notify next/requester | Updated workflow |
| Quote edit | Recalculate total | Quote total |
| PO issue/resend | Email and communication outcome | PO/Communication |
| Inspection item | Recalculate inspection status | Inspection |
| GRN post | Balance/batch/ledger or direct consumption; sync PO/PR | Inventory/fulfilment |
| Store approval/cancel | Reserve/release outstanding stock | Balance reservation |
| Issue | FEFO batch, balance/reservation, ledger, consumption | Posted issue |
| Transfer | Two movement legs | Balances/Ledgers |
| Count/adjust/return | Apply balance once and ledger | Inventory |
| Sale | Stock/ledger/cash/customer posting | Sales/finance records |
| Selected save/delete | Signal audit entry | AuditLog |
| Branch selected | Client display filtering | No server record |
| Five-minute idle | Clear browser session across tabs | Local session state |

---

## 10. Data and document flows

| Origin | Data/document | Destination/use |
|---|---|---|
| Admin | Hotel, branch, department, Employee, role | Scope, identity, approvals, forms |
| Stores/Procurement | Category, UOM, item, conversions, supplier price, reorder | PR/PO/GRN/issues/transfers/reporting |
| Requester | PR identity/reason/date/lines | Workflow, quotation, PO |
| Procurement | Offers/evaluation/LPO | Award, supplier email, receipt, finance |
| Supplier/Receiving | Delivery note, quantity, expiry, acceptance | GRN/Inspection → stock/consumption |
| Authorized uploader | PDF, DOC/DOCX, PNG/JPEG/WebP ≤4 MB | Private authenticated procurement attachment |
| Department | Store request/quantities | Reservation/issue or linked PR |
| Store Keeper | Pick/receiver | Balance/Batch/Ledger/Consumption |
| Finance | Invoice/payment/expense/bank details | Finance records/statuses |
| Sales API | Sale/items/payment/customer | Stock, CashFlow, Customer Ledger |
| Browser | Loaded rows | Dashboards/reports/export; exports not server-stored |

### 10.1 API resource map

- Accounts: auth login/me/logout, users, roles, permissions.
- Organization/HR: hotels, branches, departments, employees, designations.
- Procurement: requisitions/history/items, quotations/items, POs/items, GRNs/items, inspections/items, supplier returns/items, attachments, communications.
- Approvals: workflows, approval matrix, approve/reject/return.
- Inventory: catalogue, stores, balances, supplier prices, reorder, ledger, batches, transfers, adjustments, requests, issues, consumption, returns, counts and lines.
- Finance: methods, cashflows, daily summaries, bank accounts/transactions, expense categories/expenses, supplier invoices/payments.
- Sales/customer: customers/ledger/payments/allocations, sales/items, Complete.
- Control: notifications, six backend reports, audit logs.

No archive job, legal retention period, disposal workflow, immutable versioning, or backup policy was found. **Information not available — requires confirmation.**

---
+
## 11. Status transitions

### 11.1 Purchase requisition

| Current | Actor/trigger | Next |
|---|---|---|
| Draft | Submit after readiness | Submitted |
| Submitted/intermediate | Assigned approver approves | HOD/Procurement/Finance/Director Approved or final Approved |
| Submitted/intermediate | Return | Returned |
| Submitted/intermediate | Reject | Rejected |
| Returned/Rejected | Correct + resubmit | Submitted; decisions reset |
| Eligible pre-completion state | Cancel | Cancelled |
| Approved | Issued PO covers some/all | Partially Ordered/Ordered |
| Ordered/partial | Posted accepted receipt covers some/all | Partially Received/Fulfilled |
| Fulfilled | Close | Closed |

Intermediate labels are based on stage/request type; they are not fully configurable stage-to-status mappings.

### 11.2 Other statuses

- Approval: Pending → Approved/Rejected/Returned/Skipped. No React Skip control found.
- PO: Draft → Issued → Partially Received → Received. Cancelled exists but no cancel action found.
- Inspection: Pending → Accepted/Partially Accepted/Rejected; incomplete decisions may remain Pending.
- Supplier Return: Draft → Posted by Apply. Approved/Cancelled choices have no transition action.
- Store Request: Draft → Pending Department Approval → Submitted → Approved/Partially Approved → Partially Issued → Issued. Alternatives: Rejected→resubmit; Submitted→Awaiting Procurement→Submitted; eligible states→Cancelled.
- Transfer: Pending → In Transit → Completed. Cancelled exists without action; approval is metadata while Pending.
- Adjustment intended: Draft → Pending → Approved → Applied; reject → Cancelled. API defect breaks middle actions.
- Count: Draft → In Progress → Submitted → Approved → Applied; non-applied → Cancelled.
- Store Return/Issue: unapplied → applied boolean, not enum.
- Supplier Invoice: Draft → Matched/Exception → Approved → Partially Paid → Paid. Cancelled lacks explicit action.
- Supplier Payment: Draft → Posted. Cancelled lacks explicit action.
- Sale: Draft/Pending → Partially Paid/Paid; Cancelled exists, but only Complete is a custom action.

---

## 12. Exceptions and alternative flows

| Exception | Verified response | Recovery |
|---|---|---|
| Invalid/inactive login | 401; missing credentials 400 | Correct/reactivate |
| Invalid session | React clears state and returns Login | Sign in |
| Individual resource 403 | Loader keeps other resources; selects may be empty | Correct permission/staff flag |
| No Employee profile | Identity-bound request blocked | Create/link Employee |
| Missing/ambiguous matrix | Submission blockers | Correct rules/unique approver |
| Self/out-of-sequence approval | Rejected with 400/403 | Independent/current approver acts |
| Returned PR | Returned + instructions/notification | Correct/resubmit |
| Rejected PR | Rejected + reason/notification | Correct/resubmit or cancel |
| Expired/incomplete/too few quotes | Award blocked | Complete valid competition |
| Missing supplier price | PO generation blocked | Add quote/price |
| LPO email failure | Error outcome recorded/reported | Correct backend/address; resend |
| Duplicate delivery note | GRN rejected | Verify existing/correct note |
| Over-receipt | GRN line rejected | Use remaining quantity |
| All goods rejected | GRN accepted posting blocked | Supplier-return/manual resolution |
| Store shortage | Reservation fails or manager creates linked PR | Replenish/resume |
| Insufficient issue/transfer/return stock | Atomic validation error | Replenish/correct |
| Duplicate post | Applied/state guard blocks | Inspect existing ledger |
| Adjustment buttons | Intended URLs not found | Code fix; do not bypass status |
| Invoice mismatch | Exception + variance notes | Correct/rematch |
| Payment > balance | Post blocked | Reduce/verify prior payment |
| Protected delete | Conflict response | Deactivate/remove dependency |
| Backend unavailable | React clears data, marks offline | Restore/refresh |
| Browser closes mid-request | Outcome may already persist; no idempotency key | Refresh before retry |
| Timeout/escalation/SLA | No scheduler found | **Information not available — requires confirmation.** |

---

## 13. Process/role matrix

Legend: **I** initiate/create, **E** execute/edit, **A** decide, **V** view, **—** no default grant. Custom roles may change this.

| Process | Sys Admin | GM | Procurement | Finance | Stores Mgr | Keeper | Requester | Dept Head | Receiving | Auditor |
|---|---|---|---|---|---|---|---|---|---|---|
| Property/HR/access | I/E/A/V | V | V refs | — | V refs | V refs | V refs | V refs | — | V |
| Catalogue/supplier | I/E/V | V | I/E/V | V | I/E/V | V | limited | limited | V | V |
| PR/approval | I/E/A/V | I/E/A/V | I/E/A/V | A/E/V | receipt V | — | — | assigned A/V | source V | V |
| Quote/LPO | I/E/V | V/E PO | I/E/V | V | PO V | — | — | — | PO V | V |
| GRN/inspection | I/E/V | V | inspection E/GRN V | V | GRN E/V | — | — | — | I/E/V | V |
| Supplier return | I/E/V | V | I/E/V | V | E/V | — | — | — | I/E/V | V |
| Department request | I/E/A/V | V | — | — | I/E/A/V | I/E/V | I/E/V own | I/E/A/V dept | — | V |
| Issue/return | I/E/V | V | — | — | I/E/V | I/E/V | own request | dept request | — | V |
| Transfer | I/E/A/V | E/V | — | — | I/E/A/V | — | — | — | — | V |
| Adjustment/count | I/E/A/V | E/V | — | — | I/E/A/V* | Count I/E/A | — | — | — | V |
| Finance | I/E/A/V | V | — | I/E/A/V | — | — | — | — | — | V |
| Sales/customer | I/E/V | V | — | V | — | — | — | — | — | V |
| Reports | I/V | V | V | V | V | V | — | — | V | V |
| Audit | staff admin | staff required | staff required | staff required | staff required | staff required | staff required | staff required | staff required | staff required |

`*` Adjustment workbench actions are currently defective.

---

## 14. Detailed process tables

### 14.1 PR to approval

| Step | Actor | Action | System response | Input | Output/decision | Next |
|---:|---|---|---|---|---|---|
| 1 | Requester/privileged buyer | Create PR | Number and property derivation | Type/reason/date/identity | Draft | Add lines |
| 2 | Editor | Add/edit lines | Validate editable state/positive values | Item/qty/cost | Items/total | Submit |
| 3 | Actor | Submit | Readiness + matrix resolution | Draft PR | Blockers or Submitted/steps | Fix or approve |
| 4 | System | Notify | Recipient-only notice | First step | Notification | Review |
| 5 | Assigned approver | Decide | Identity/sequence check | Evidence/comment | Approve/Reject/Return | Advance/correct/end |
| 6 | System | Advance | State/history/audit/notification | Decision | Next step or Approved | Approver/sourcing |
| 7 | Requester | Correct if returned/rejected | Editable again | Instructions | Corrected PR | Resubmit |
| 8 | System | Reset on resubmit | Clears decisions/timestamps | Corrected PR | Pending route | Repeat |

### 14.2 Approved PR to issued LPO

| Step | Actor | Action | System response | Input | Output | Next |
|---:|---|---|---|---|---|---|
| 1 | Procurement | Create offers | One quote/supplier/PR | Supplier/PR | Quote headers | Lines |
| 2 | Procurement | Add terms/lines | Link PR lines/recalculate total | Price/qty/delivery | Comparable offers | Award |
| 3 | Procurement | Award | Completeness/expiry/count checks | Quote/reason | Winner or error | PO |
| 4 | Procurement | Generate PO | Resolve supplier/price/remaining | PR/employee/store | Draft PO/items | Review |
| 5 | Procurement | Issue | Readiness + email | Draft PO/email | Issued/communication | Deliver |
| 6 | Procurement | Resend/acknowledge | Record outcome/representative | Issued PO | Send/ack metadata | Delivery |

### 14.3 Delivery to inventory/consumption

| Step | Actor | Action | System response | Input | Output | Next |
|---:|---|---|---|---|---|---|
| 1 | Receiving | Create GRN | PO/delivery-note validation | PO/receiver/date/note | GRN | Lines |
| 2 | Receiving | Add lines | Source/remaining/destination check | PO line/qty/cost/expiry/target | GRN Items | Inspect |
| 3 | Inspector | Open inspection | One inspection | GRN/employee | Pending inspection | Decisions |
| 4 | Inspector | Accept/reject | Total validation/status calculation | Receipt line/qty/reason | Accepted/Partial/Rejected | Post/resolve |
| 5 | Authorized actor | Post GRN | Atomic destination posting | Accepted evidence | Stock or Consumption | Sync |
| 6 | System | Sync | Compare ordered/posted accepted | Posted lines | PO/PR partial/full | Finance/close |

### 14.4 Department demand to issue

| Step | Actor | Action | System response | Input | Output | Next |
|---:|---|---|---|---|---|---|
| 1 | Requester | Create/lines | Force identity/store; number | Purpose/date/item/qty | Draft | Submit |
| 2 | Requester/Head | Submit | Line check + Head bypass | Draft | Pending Head or Submitted | Review |
| 3 | Head | Approve/reject | Role/department/state check | Request/comment | Submitted/Rejected | Stores/correct |
| 4 | Stores Manager | Decide quantities | Saves decisions in Submitted | Stock/request | Approved qty | Reserve/shortage |
| 5A | Stores Manager | Approve | Check/reserve | Decisions | Approved/Partial | Issue |
| 5B | Stores Manager | Shortage | Create one linked PR | Lines/reason | Awaiting Procurement | Procure |
| 6B | Stores Manager | Resume | Require full line availability | Balances | Submitted | Re-decide |
| 7 | Keeper | Voucher/picks | Outstanding/source check | Approved request | Issue draft | Post |
| 8 | Keeper | Apply | Stock/batch/reservation/ledger/consumption | Pick qty | Applied/partial/issued | Acknowledge |
| 9 | Staff | Acknowledge | Require applied and receiver | Employee/name | Receiver stored | Complete |

### 14.5 Invoice to payment

| Step | Actor | Action | System response | Input | Output | Next |
|---:|---|---|---|---|---|---|
| 1 | Finance | Create invoice | Store supplier/PO/amount/dates | Invoice | Draft | Match |
| 2 | Finance | Match | Sum accepted posted value/variance | PO/GRN/invoice | Matched/Exception | Approve/correct |
| 3 | Finance | Approve | Require Matched | Invoice | Approved | Payment |
| 4 | Finance | Create payment | Store settlement details | Amount/method/ref | Draft payment | Post |
| 5 | Finance | Post | State/balance checks | Draft payment | Posted + invoice partial/paid | Repeat/end |

### 14.6 Inventory controls

| Process step | Actor | System response | Exception | End |
|---|---|---|---|---|
| Transfer create/add | Stores/admin | Pending/base-converted lines | Same stores blocked | Pending |
| Approve | Authorized changer | Approver/time | No line/employee blocked | Pending+marker |
| Dispatch | Authorized changer | Source OUT | Approval/stock required | In Transit |
| Receive | Authorized changer | Destination IN | Must be In Transit | Completed |
| Count populate/edit | Keeper/Manager | Copy system/save physical | Empty cannot submit | In Progress |
| Count submit/approve/apply | Authorized changer | Apply variance once | Wrong state/reapply blocked | Applied |
| Return create/add/apply | Keeper/Manager | Add stock/IN Ledger | Empty/reapply blocked | Applied |
| Adjustment create/add | Stores/admin | Draft signed changes | — | Draft |
| Adjustment middle actions | Intended changer | Intended transitions | **Endpoint defect** | Unreliable |
| Adjustment apply | Authorized changer | Balance/Ledger | Requires Approved/nonnegative | Applied |

---

## 15. Overall system flow

```text
Administrator setup
  Hotel → Branch → Department → Employee/User → Role/Permissions

Demand
  Department store request → Head review → Stores review
    ├─ available → reserve → issue → acknowledge → consumption
    └─ shortage → linked PR ───────────────────────────────┐
  Direct hotel/department purchase → PR                    │
                                                           ▼
Procurement
  PR → matrix → sequential approval
    ├─ return/reject → correction/resubmission or end
    └─ approve → quotes → award → PO → supplier email/ack
                                         ↓
Receiving
  Delivery → GRN → inspection
    ├─ rejected → return/manual resolution
    └─ accepted → store balance/batch/ledger
                or direct department consumption
                                         ↓
Finance
  Invoice → three-way match
    ├─ exception → correct/rematch
    └─ matched → approve → payment(s) → paid

Oversight: dashboards + PR notifications + selected audit + reports
```

---

## 16. Gaps, assumptions, and information requiring confirmation

### 16.1 Verified implementation/control gaps

1. **Screenshot/source mismatch.** Screenshot says “Type / Property branch / Department / Requester”. Current branch renders “Request type / Department / Requested by / Preferred supplier”; “Property branch” is absent from tracked frontend and Git search. At verification, public frontend served `/assets/index-B1kA-he4.js`, the same filename produced by current local build, and backend health was 200. Screenshot therefore came from an older browser/deployment, different Vercel project/domain, or different source tree; screenshot alone cannot distinguish.
2. **Blank selectors with partial access/data.** Choices depend on branches/departments/employees APIs. Loader tolerates individual 403/empty resources, so drawer can show empty selects while other data works. Confirm with affected authenticated session.
3. **Branch selection is client display scoping**, not backend row security.
4. **PR serializer status protection appears ineffective:** intended `read_only_fields` is indented after a return inside `get_approval_steps`, so workflow fields may be generically writable by change-permitted users.
5. **Adjustment actions misplaced:** Submit/Approve/Reject are on `StockCountItemViewSet`, not `StockAdjustmentViewSet`; intended URLs fail and count-item actions can call nonexistent methods.
6. **Transfer `apply` bypasses approval** and completes dispatch/receipt.
7. **Transfer serializer permits generic workflow-field writes** because status/approval fields are not fully read-only.
8. **GRN-item direct post can bypass inspection;** whole-GRN post correctly enforces it.
9. **Repeated Partially Approved store approval can reserve again** without clear prior-reservation subtraction.
10. **Auditor conflict:** group has `view_auditlog`, API requires staff.
11. **Access Management conflict:** route can display by model permissions, APIs require staff.
12. **Detailed register reports are session-data views by design.** PR, PO, GRN, and supplier registers use records already loaded into the browser; their cards are labelled `SESSION` so they are not confused with the live aggregate APIs.
13. **Finance match is partial:** `quantity_variance` is not computed; serializer does not validate invoice supplier equals PO supplier or received PO state.
14. **Supplier payment is not bank/ledger integration.**
15. **Customer Payment/Allocation CRUD is disconnected** from balances/sale/ledger/cash flow.
16. **Issue batch allocation does not explicitly fail when tracked batches are insufficient** although Balance decreases.
17. **Enum states without actions:** PO Cancelled, Supplier Return Approved/Cancelled, Transfer Cancelled, invoice/payment Cancelled, and parts of Sale cancellation.
18. **Audit attribution incomplete:** document update actor may remain original creator; IP unused; snapshot lacks field diff.
19. **No notifications found** for stores, receipt, transfer, count, adjustment, invoice, or payment hand-offs.

### 16.2 Information not available — requires confirmation

- Formal SOP/business owner and prohibited combinations of requester/approver/receiver.
- Exact Vercel project, production alias, Root/Build/Output settings, and commit metadata for the screenshot URL.
- Authenticated API responses/browser console for the affected blank-selector user.
- Production Approval Matrix rows and environment overrides for quotation threshold/count.
- Email provider, delivery/bounce/retry guarantees, and supplier-facing document layout.
- Legal sufficiency of staff-entered supplier acknowledgement.
- External payment authorization, bank confirmation/reconciliation, tax, chart of accounts, and close.
- Invoice-exception owner/evidence/sign-off.
- Independent inspection/quarantine/rejected-goods SOP.
- Direct consumption costing and returns against prior issues.
- Negative-adjustment/shrinkage/count-variance approval thresholds.
- Reservation expiry/release schedule.
- Reversal flows after PO/GRN/issue/payment/sale posting.
- Customer credit, allocation, refund, and write-off processes.
- Retention, archive, backup/restore, DR, audit immutability, privacy.
- SLA, escalation, delegation, absence handling, notification channels.
- Strict branch tenancy requirement.
- Front Office, reservations, POS, Maintenance, budgets, and full accounting workflows.

### 16.3 No hidden assumptions used

- Supplier/customer are external affected parties, not authenticated roles.
- API models are not presented as React workflows without a calling screen.
- A status choice is not considered reachable without a method/action.
- A frontend guard is not treated as backend security.
- Build/health success does not prove affected-user permission or production database content.

---

## Verification result

- Frontend production build: **passed**.
- Django system check: **passed**.
- Backend tests: **60 collected, 60 passed**.
- Configured public frontend: **HTTP 200**.
- Configured backend health: **HTTP 200**.
- Exact affected-user form/data behavior: **Information not available — requires confirmation with the authenticated session and exact browser URL.**
