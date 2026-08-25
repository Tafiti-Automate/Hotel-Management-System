# General Manager Handoff & UI Fix V9.9

## Client workflow preserved

Procurement → Financial Manager → General Manager → Procurement (print/send approved LPO).

No additional approval stage or unrelated ERP workflow was added.

## Finance → General Manager handoff fix

- Added an authoritative `purchase-orders/approval-inbox/` endpoint.
- The approval inbox is based on the **first unfinished LPO approval stage**.
- Finance sees an LPO only while the Financial Manager stage is current.
- General Manager sees it only after Finance approves and the General Manager stage becomes current.
- Existing branch visibility and active-role controls remain enforced.
- The frontend reads the authoritative inbox directly rather than reconstructing the current stage from labels.

## Existing pending LPO repair

Migration `approvals.0007_backfill_pending_lpo_role_queues` converts only unfinished stages on LPOs that are still pending approval:

- Stage 1 pending → Financial Manager role queue
- Stage 2 pending → General Manager role queue

Completed Finance/GM decisions are not changed. This repairs LPOs created before the role-queue implementation, including cases where Finance approved but the pending GM stage was still assigned to an old named employee.

## General Manager UI

The GM page is reduced to the client's actual responsibility:

- `Pending`
- `History`

The previous KPI-heavy four-card layout is removed for the General Manager.

When no LPO is selected, the pending/history list uses the full page width. Selecting **Review** opens the final decision panel and shows:

- LPO number
- supplier
- source requisition
- Finance decision / Finance decision-maker
- LPO total
- item quantities after Finance review
- unit price and total
- approval timeline
- Approve
- Reject (reason requested only when rejecting)

The GM cannot edit supplier, price, or quantities.

Approved/rejected GM decisions remain available under History.

## Validation

- Backend Python compilation: PASS
- Migration syntax: PASS
- Static assertions for current-stage queue/backfill/UI: PASS
- Frontend TS/TSX syntax transpilation: 41 files, 0 diagnostics
- Full local `npm run build`: not completed because the isolated workspace could not finish dependency installation; the partial `node_modules` was removed before packaging.

## Deployment

Normal deployment must run migrations. In particular:

`approvals.0007_backfill_pending_lpo_role_queues`

After deployment, test:

1. Procurement submits a fresh LPO.
2. Finance sees it in Pending.
3. GM does not see it yet.
4. Finance approves it.
5. Finance queue removes it.
6. GM Pending immediately shows it.
7. GM approves/rejects.
8. Approved LPO returns to Procurement for controlled print/send.
