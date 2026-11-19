# Approved LPO: printed supplier copy and internal receiving handoff

An LPO that completes all required approvals may be downloaded as a controlled
ORIGINAL/COPY document and handed to a supplier in person. Supplier email is
**not required**. The approved workbench uses a single download-and-release
action: after a successful controlled PDF download, Procurement calls the new
`POST /api/v1/purchase-orders/{id}/release-for-receiving/` action.

The server checks that the LPO is approved, the source requisition approved,
quantities committed correctly, validity not expired, and that at least one
controlled PDF print/download was recorded. The actor must be authorized
Procurement staff from the LPO branch. This transition is transactional,
audited and non-repeatable.

On release, status becomes `issued`, a Receiving Clerk notification is
generated, and the order automatically becomes visible in that property's
Receiving queue. Existing blind receiving protections (quantity and price
concealment before first saved/locked count) remain intact. Receiving GRN
entry and inventory posting are still distinct operations.

Existing legacy email-specific `/issue/` is retained for compatibility with
previous records/tests, but it is no longer offered as the primary approved
LPO UI action. No background emailing occurs in the new release workflow.
