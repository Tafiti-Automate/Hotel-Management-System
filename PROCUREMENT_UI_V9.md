# Procurement Manager / Officer UI V9

## Scope
This revision simplifies only the Procurement Manager / Procurement Officer workspace. It does not add new procurement stages or business rules.

## Client-facing queues
The Procurement workspace now uses six direct queues:

1. Supplier Allocation
2. Prepare LPO
3. Awaiting Finance
4. Awaiting GM
5. Approved to Send
6. History

The previous large Requester/Procurement workflow path is hidden for Procurement users.

## Supplier allocation
- The left list shows Store Requisitions that still need supplier allocation.
- Clicking Review opens that requisition directly; there is no duplicate requisition dropdown.
- All requisition lines appear in the right workspace with allocated / needs supplier state.
- Clicking an article shows active supplier quotations for that article.
- Procurement selects a supplier, confirms quantity and current unit price, and enters a reason only when the quotation price is changed.
- Once all items are allocated, Continue to LPO preparation moves directly to the next queue.

## LPO preparation
- Ready Store Requisitions and existing draft LPOs are shown directly in the left list.
- Clicking a ready Store Requisition shows the allocated items and supplier grouping and offers Create LPO(s).
- Clicking a draft LPO shows the actual LPO summary and Send to Financial Manager.
- Normal draft LPOs no longer repeat supplier/price editing already completed during supplier allocation.
- A correction editor appears only for an exceptional historical quantity-overage draft.

## Approval monitoring
- Awaiting Finance and Awaiting GM are separate queues.
- Procurement sees the LPO and its approval timeline in read-only form while another role has the decision.
- Finance and GM approval controls remain available only to their respective roles.

## Approved LPO
- Approved to Send shows only finally approved LPOs.
- The selected LPO shows its items, total and approval timeline.
- Procurement can download the controlled ORIGINAL/COPY and email the LPO to the registered supplier.
- Emailing remains the action that issues the LPO and starts lead-time tracking.

## History
- Issued, partially received, fully received, rejected and cancelled LPOs remain available in History.
- The previous large archive warning panel has been removed.
- Selecting a historical LPO shows a concise read-only summary including supplier email, sent date, expected delivery and status.

## Validation
Production frontend validation executed successfully:

```bash
npm run build
```

Result:
- TypeScript build passed.
- Vite production build passed.
- 69 modules transformed.
- Only the existing non-blocking Vite bundle-size warning remains.
