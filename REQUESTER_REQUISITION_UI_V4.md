# Requester Requisition UI V4

This update is limited to the client's confirmed Department Requester workflow.

## Implemented

- Replaced the permanent right-side "New request / Draft request" panel for Requesters.
- `New requisition` now creates a draft immediately and opens a full-width requisition editor.
- Draft and rejected requisitions reopen in the same editor for correction/resubmission.
- Requisition header shows client-facing reference, department, requester, required date and item count.
- Purpose/reason and required date are edited as requisition-level information.
- Requested items are displayed as individual rows with:
  - Article
  - Quantity
  - UOM
  - Item note
  - Edit / Remove actions
- `Add another item` provides a dedicated item-entry area.
- UOM is derived from the selected Article/base-unit configuration rather than typed freely.
- Draft actions are clear: Delete Draft, Save Draft, Submit for HOD Approval.
- Request list now shows item count plus a short article preview instead of a long concatenated item/quantity string.
- Requester progress was corrected to:
  - Created
  - HOD Approval
  - Store Keeper
  - Procurement
  - Issue
  - Completed
- `Awaiting Procurement` no longer displays `Store Keeper Action` as the active progress stage.
- Requester terminology changed from `My Store Requests` to `My Requisitions` / `Department Requisition`.
- No supplier, price, quotation, finance or procurement-commercial data was added to the Requester UI.

## Scope deliberately excluded

No new supplier, finance, procurement, approval, inventory or reporting business rules were added in this update. The change is focused only on making multi-item Department Requisitions professional and easy to use.

## Validation

- Parsed all 42 frontend TypeScript/TSX source files with the TypeScript parser: no syntax errors.
- Backend code was not changed in this UI-only revision.
