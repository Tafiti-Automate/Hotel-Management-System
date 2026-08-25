# HOD Approval 500 Fix V9.1

## Problem
The Department Head approval UI could reach the correct requisition and quantity decision, but the API returned HTTP 500 during approval.

## Fix
- HOD approval now writes only the HOD decision fields (`hod_approved_quantity`, reset Store Keeper quantity/comment) instead of calling the full `StoreRequisitionItem.save()` path.
- This prevents unrelated article/UOM base conversion logic from breaking a valid HOD decision.
- The requester's original quantity remains unchanged.
- Store Keeper notification delivery is now non-blocking. If notification creation fails, the already-valid HOD approval still succeeds and the failure is logged server-side.
- The approval view refreshes the requisition from the database before serializing the response.
- Added a regression test proving a notification failure cannot turn HOD approval into HTTP 500.

## Business control preserved
Requester quantity -> HOD approved quantity -> Store Keeper forwarded quantity remain separate values.
