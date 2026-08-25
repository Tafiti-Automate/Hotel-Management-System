# HOD Approval 500 Fix V9.2

## Problem
The Department Head approval endpoint continued returning HTTP 500 in production even after the first hardening pass.

## V9.2 changes
- HOD line decisions use direct queryset updates and do not invoke StoreRequisitionItem.save().
- The requisition status/approver decision also uses a conditional direct queryset update instead of StoreRequisition.save(), avoiding document post-save signal failures from rolling back the approval.
- Requester quantity remains unchanged; HOD approved quantity remains a separate field.
- Audit logging and Store Keeper notifications are best-effort side effects after the business transaction.
- The approval endpoint returns a minimal success payload instead of reserializing the entire requisition.
- Unexpected production failures are logged with requisition, user and request ID and returned as JSON containing the exception class and request reference.

## Verification
- Direct HOD approval transaction test: PASS.
- Direct DRF StoreRequisitionViewSet.department_approve action test with reduced quantity: PASS (HTTP 200).
- Backend Python compileall: PASS.

No new database migration is required for V9.2.
