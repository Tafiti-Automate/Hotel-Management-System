# Procurement Manager Save Fix

This update intentionally preserves the existing procurement workflow and business logic.

## What changed

- Procurement quantity review remains a separate required action.
- Supplier allocation remains a separate action.
- LPO preparation and all existing approval stages remain unchanged.
- The Procurement Manager screen is visually cleaner:
  - quantity review actions are compact rather than full-width;
  - supplier action is labelled `Save supplier allocation` instead of `Save item`;
  - exceptional requisition rejection is placed under `Other actions`;
  - the existing sequence is labelled 1, 2, 3 for clarity.
- HTTP 500 errors are no longer labelled as a workflow requirement failure in the UI.
- Procurement allocation now validates malformed/non-finite quantity values and invalid decimal conversion values before saving, returning a normal validation response instead of allowing those inputs to become server errors.

## Validation completed

- Frontend TypeScript build: passed.
- Vite production build: passed.
- Focused procurement tests: 3 passed, including supplier pack/base-UOM allocation and the purchasing -> finance -> general manager approval route.
- Regression assertion added: invalid supplier allocation quantity returns HTTP 400 rather than HTTP 500.

## Apply

Extract this ZIP over the existing `Hotel-Management-System` project directory. Only the listed source/test files are replaced; the rest of the project remains untouched.
