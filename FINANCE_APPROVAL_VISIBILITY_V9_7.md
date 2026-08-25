# Finance Approval Visibility V9.7

## Problem
After Procurement submitted an LPO for Finance approval, the Financial Manager page could still show **Awaiting Finance: 0** even though the LPO existed and had been submitted.

The frontend was reconstructing the Finance queue by reading serialized workflow step text from the general LPO dataset. That inference was unnecessarily fragile after the approval route was changed to role queues in V9.6.

## Fix
- The procurement workspace API now returns an explicit `approvalQueueOrders` collection for the logged-in approval role.
- Financial Manager receives only LPOs with:
  - `status = pending_approval`
  - a pending approval workflow step
  - `approver_role = Financial Manager`
  - the existing branch visibility rules.
- General Manager uses the same mechanism for its final-approval queue.
- The frontend uses this server-provided queue for the Awaiting Finance / Awaiting Final Approval count and list.
- Procurement Manager still sees the general workflow status queues as before.

## Workflow
Procurement submits LPO -> Financial Manager queue -> Finance approves/reduces/rejects -> General Manager queue -> final approval/rejection.

No database migration is required for V9.7.
