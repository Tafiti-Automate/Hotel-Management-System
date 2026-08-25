# Store Keeper + HOD Requisition UI V7

## Scope
This revision is intentionally limited to the confirmed Department Requisition workflow.

## Department Requisition reference
- New Department Requisitions use `R-00001`, `R-00002`, ... style references.
- Existing StoreRequisition references are normalized to the same `R-xxxxx` display format by a data-only migration.
- The schema migration and data migration are separate to avoid PostgreSQL pending-trigger migration conflicts.

## Requester
- Request list no longer shows the progress bar.
- Columns are Requisition, Date, Items and Status.
- Requisition IDs display the new `R-xxxxx` reference.

## Department Head
- Pending requests remain in a focused approval inbox.
- A History tab keeps approved and rejected requisitions visible after the decision.
- HOD can edit/reduce each item quantity before approval.
- Requester quantity is immutable.
- HOD quantity is saved separately as `hod_approved_quantity`.
- HOD cannot approve quantities above the requester quantity.
- At least one line must have a positive HOD-approved quantity; otherwise the request should be rejected.
- Rejection reason remains mandatory.

Quantity chain:

`Requester quantity -> HOD approved quantity -> Store Keeper forwarded quantity`

## Store Keeper
- Removed the split right-hand hand-off panel for the Store Keeper role.
- Queue now shows Requisition, Requester, Department, Date, Items and Review.
- Selecting a request opens one full review page.
- Destination store is selected once on the request.
- All item quantities are handled together in one table.
- Columns: Article, Requested, HOD Approved, Forward to Procurement, UOM, Note.
- Store Keeper cannot forward more than the HOD-approved quantity.
- A note is required only when the Store Keeper forwards zero from a positive HOD-approved quantity.
- One `Forward to Procurement` button performs the hand-off after all lines are valid.
- Processed requests remain visible under the Processed tab.
- When procurement goods later return to the store, the same queue provides `Prepare for department issue` instead of allowing a second procurement hand-off.

## Validation completed
- Python source compilation: PASS.
- Frontend production build (`tsc -b && vite build`): PASS.
- Vite produced only its existing bundle-size warning; there are no TypeScript build errors.
- Backend test cases were added for HOD quantity preservation/limits and the `R-xxxxx` reference format. A Django runtime was not installed in the execution environment, so those tests should run in CI/deployment.
