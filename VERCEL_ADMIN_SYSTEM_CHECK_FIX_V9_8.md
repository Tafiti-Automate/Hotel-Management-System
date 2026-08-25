# Vercel Django Admin System Check Fix V9.8

## Deployment failure

Vercel stopped during `vercel_build.sh` with Django admin check `admin.E108` because `ApprovalWorkflowAdmin.list_display` referenced `approver_role`, but `ApprovalWorkflow` has no such model field.

## Root cause

The role-queue refactor added `approver_role` to `PurchaseOrderApprovalWorkflow` for LPO Finance/General Manager routing. The same field was accidentally placed in the admin list for the older `ApprovalWorkflow`, which still routes requisition approval through its `approver` employee field.

## Fix

Removed only `approver_role` from `ApprovalWorkflowAdmin.list_display`.

The `PurchaseOrderApprovalWorkflowAdmin` continues to display and use `approver_role`, because that field exists on the LPO approval model and is required by the role-queue workflow.

## Database

No migration is required.

## Validation

- All backend Python files compile successfully with `python -m compileall`.
- `ApprovalWorkflowAdmin` fields were checked against the current `ApprovalWorkflow` model.
- `PurchaseOrderApprovalWorkflowAdmin` retains its valid role-queue fields.
- Full local `manage.py check` could not be run in this workspace because external package installation is unavailable, but this directly resolves the exact `admin.E108` reported by Vercel.
