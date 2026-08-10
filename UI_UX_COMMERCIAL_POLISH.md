# Commercial ERP UI/UX Polish

## Completed in this revision

- Replaced the five-minute inactivity logout with an eight-hour idle session.
- Removed the visible inactivity sign-out message; expired sessions return silently to login.
- Simplified Store Requisition wording and removed workflow-training paragraphs.
- Replaced verbose action labels with concise ERP actions such as Approve, Reject and Confirm receipt.
- Simplified Procurement, Finance and Inventory panel descriptions.
- Replaced AI-like workflow explanations with short status and task labels.
- Preserved role permissions and backend workflow rules.
- Confirmed the frontend production build completes successfully.

## Recommended next controlled phase

- Standardise all list filters and empty states.
- Replace remaining long helper notes with tooltips where genuinely needed.
- Add route-level code splitting to reduce the current main JavaScript bundle.
- Run role-by-role acceptance testing with production-like accounts and data.
