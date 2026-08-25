# LPO role-queue approval fix V9.6

## Problem
Submitting a draft LPO to Finance failed when more than one active employee held the `Financial Manager` role in the same branch. The old implementation required exactly one named employee and blocked Procurement when duplicates existed.

## Client-aligned fix
The LPO approval route is now assigned to fixed workflow roles rather than one hard-coded person:

1. Financial Manager Review
2. General Manager Final Approval

Any active employee holding the required role in the LPO branch may take the pending decision. The first valid decision completes that stage; subsequent attempts are rejected because the stage is no longer pending. The actual employee/user who approved or rejected remains recorded in the audit trail and on the LPO approval history.

## Controls retained
- Procurement cannot choose the approver.
- Finance and General Manager remain separate workflow stages.
- Branch isolation is enforced when a branch is assigned to the LPO.
- At least one active role holder must exist for each required role before submission.
- Existing historical approval rows assigned to named employees remain valid.
- No supplier, quantity, price, print, or receiving rules were changed.

## Database change
Migration `approvals.0006_purchaseorderapprovalworkflow_role_queue`:
- makes the legacy named `approver` nullable;
- adds nullable `approver_role`;
- preserves existing approval records.

New LPO approval workflows use `approver_role`; old workflows can continue using `approver`.
