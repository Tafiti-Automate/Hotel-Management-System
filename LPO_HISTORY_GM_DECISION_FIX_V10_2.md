# Tafiti Hotel V10.2 — LPO History, Download and GM Decision History

## Changes

- Procurement LPO detail workspace is wider and cleaner when a record is open.
- After **Email LPO to Supplier**, Procurement is automatically taken to the same LPO under **History**.
- Sent/partially received/received LPOs retain a controlled **Download ORIGINAL/COPY LPO** action.
- Emailing the supplier does not consume the controlled ORIGINAL print. If Procurement emailed first, the next controlled download is still ORIGINAL; subsequent downloads are COPY.
- Procurement History shows clean business date/time formatting instead of raw ISO timestamps.
- General Manager decisions now have a dedicated backend `purchase-orders/decision-history` queue.
- GM **History** no longer depends on a browser-side filter of the general LPO list.
- After the GM approves or rejects an LPO, the UI immediately opens that LPO in **History**.
- GM History records the final decision, decision maker, decision date and rejection reason where applicable.
- The GM pending/decision flow remains role-based and branch-scoped.

## Validation

- `npm run build` passed (`tsc -b && vite build`, 69 modules transformed).
- Backend Python compilation passed.
- `vercel_build.sh` shell syntax validation passed.
- Regression test source extended to verify Finance -> GM -> GM decision-history visibility.

## Database

No new migration is required for V10.2.
