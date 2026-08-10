# Hotel ERP — Three-Hour Presentation Readiness

> **Purpose:** a safe presentation path based on the current application, not on the deleted
> Pearl of Africa demo dataset.
>
> **Checked:** 2026-08-01, Africa/Kampala.

## 1. Current go/no-go position

| Check | Result | Meaning |
|---|---|---|
| Production frontend | `PASS` — HTTP 200 | The public Vercel page is reachable. |
| Production backend health | `PASS` — `status: ok` | The API service is running; this does not prove business data or workflows. |
| Local frontend type-check | `PASS` | The current working tree compiles. |
| Local production build | `PASS` | Vite generated a deployable frontend build. |
| Click a table row to inspect its record | `READY LOCALLY, NOT DEPLOYED` | The local build includes a reusable detail drawer; the production site still serves an older asset bundle. |
| Production database content | `EMPTY/REBUILDING` | The old demo dataset was deliberately removed; only verified newly entered records may be shown. |
| End-to-end production role UAT | `NOT COMPLETE` | Do not describe every workflow as production-verified. |

The application is healthy enough to prepare a presentation, but it is not currently safe to use
the old record-by-record script. The local frontend must be committed, pushed to `back$front`, and
successfully deployed before the new table-row detail behaviour will appear in production.

## 2. First 30 minutes — confirm the presentation environment

- Sign in to the production URL with the preserved superuser.
- Hard-refresh with `Ctrl + Shift + R`.
- Confirm the intended hotel/branch exists and is selected.
- Confirm an active store, department, employee/requester, category, unit, article and supplier
  exist before attempting a transaction.
- Open the browser developer console once and confirm there are no failed API requests.
- Open one record list and confirm whether it contains newly entered data. Do not expect the old
  Pearl of Africa records or role accounts.
- After deployment, click the body of a table row. It should open a detail panel; its checkbox and
  edit/delete controls should continue to perform only their own actions.

If the required master records are absent, use the next period to create a small set of genuine
presentation records through the UI. Do not restore the deleted demo fixture merely to satisfy the
old guide.

## 3. Minimum data needed for a coherent live demonstration

Prepare and verify only enough linked data to tell one consistent story:

1. One hotel branch and one requesting department.
2. One employee/requester and the preserved administrator account.
3. One active/default store associated with the branch.
4. One category, one unit of measure and two articles.
5. One active supplier and, where needed, its article catalogue entries.
6. One department material request with two item lines.
7. Optionally, one purchase requisition at a safe status for viewing.

Do not try to build and post every procurement, receiving, inventory and finance document during
the live presentation. Status-changing actions such as approve, issue, receive, post, apply and pay
alter production data and should be rehearsed in advance.

## 4. Recommended 10–12 minute presentation path

### 1. Scope and access — 1 minute

Sign in and explain that the system is role- and permission-aware. Show **Hotel Operations** and
**Human Resources** only as active workspaces. Describe Front Office and Restaurant/POS as planned,
not delivered React screens.

### 2. People and master records — 2 minutes

Open **Employees**, **Departments**, **Article catalogue** and **Suppliers**. Use only records that
are visibly present. After the frontend deployment, click a row to show the complete returned
record in the detail panel. Explain that reference data is reused by requests, sourcing, stores and
finance.

### 3. Department supply journey — 3 minutes

Open **Department supply & stores**. Use the process path at the top to explain:

`Prepare request → Department approval → Stores availability decision → Procurement shortage (when needed) → Pick and issue`

Each card shows the number of records at that stage and opens only the controls assigned to that
role. Open the prepared request and show its item lines. Emphasise where the requester adds the
articles and quantities before submission. If a request must be created live, save the request
details, add the two lines, review them, and stop before a status-changing action unless that action
was already rehearsed.

### 4. Procurement and receiving — 2 minutes

Open **Procurement to receiving** and explain the displayed path:

`Request lines → Sourcing → LPO → Receive → Inspect → Supplier return`

Show an existing requisition or purchase-order record if one has been prepared. Do not claim that
every stage was live-verified merely because its screen and backend endpoint exist.

### 5. Finance, reports and audit — 2 minutes

Open **Supplier invoices & payment** and explain invoice registration, three-way matching,
approval and payment as a controlled sequence. Then open **Reports** and **Audit log**. Distinguish
live API-backed reports from screens that still rely on loaded session data; audit history shows
recorded actions, not proof that every proposed workflow is complete.

### 6. Close — 1 minute

Return to the dashboard and summarise the verified product direction: role-aware demand,
procurement, stores, finance, reporting and audit in connected workspaces, with remaining gaps
tracked separately instead of presented as delivered functionality.

## 5. Claims to avoid in the presentation

- Do not say the old Pearl of Africa records or role accounts are present after the database wipe.
- Do not call global search functional; the current header search is not connected.
- Do not claim Front Office, reservations, check-in, Restaurant/POS or Maintenance have dedicated
  React workflows.
- Do not claim budgets are enforced; an authoritative budget model/workflow has not been verified.
- Do not say every report, permission or cross-branch rule has passed production UAT.
- Do not state that the row-detail drawer is live until the production asset changes after a
  successful deployment and the interaction is checked in the browser.

## 6. Fallback if transaction data is still empty

Do not improvise a fake completed workflow. Present the product structure, the role-aware
navigation, the workflow maps and the verified master-data forms. Create one draft department
request with item lines to demonstrate data entry, then use the current-state and gap documents to
show precisely what is implemented, partially implemented and proposed.

The evidence documents for questions are:

- [`CURRENT_UI_UX_BEHAVIOR.md`](CURRENT_UI_UX_BEHAVIOR.md) — evidence-backed current state.
- [`UI_UX_GAP_REGISTER.md`](UI_UX_GAP_REGISTER.md) — missing, partial and unverified behaviour.
- [`Hotel_Operations_ERP_UI_UX_Design_Specification.md`](Hotel_Operations_ERP_UI_UX_Design_Specification.md) — target product design, not proof of delivery.
