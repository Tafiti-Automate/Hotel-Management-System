# Store Keeper Client Flow V8

This revision removes the unconfirmed stock-issue workflow from the Store Keeper experience.

## Store Keeper scope

The Store Keeper now only:
1. Opens HOD-approved Department Requisitions.
2. Selects the destination store.
3. Reviews the requester quantity and HOD-approved quantity.
4. Confirms or reduces the quantity forwarded to Procurement.
5. Adds an optional line note.
6. Forwards the requisition to Procurement.
7. Can review previously processed requisitions in history.

The Store Keeper no longer sees **Ready to issue**, **Pick and issue**, **Issue vouchers**, **Pick lists**, **Dispatch**, or **Department receipt acknowledgement**. Those steps were not part of the client-confirmed workflow.

The Store Keeper fixed role no longer receives StockIssue/StockIssueItem CRUD permissions when `setup_hotel_roles` synchronizes the standard roles.
