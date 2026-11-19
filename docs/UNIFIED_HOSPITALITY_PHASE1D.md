# Phase 1D — property guests and draft POS ordering

- Guest registration creates a Customer with a property link; list/search endpoints expose only guests registered in the employee's assigned property.
- New reservations require the Customer to have an explicit property registration. This is an intentional fail-closed migration: older reservations remain readable, but booking against historical unlinked customers must be preceded by an authorized linking/migration process.
- POS menu reads published, priced, non-sub-recipe recipes only for assigned outlets.
- POS line addition requires an active outlet assignment and add_posorderline permission, locks the check, snapshots the recipe price and name, and uses a unique client request reference for idempotent retries.
- No payment, stock deduction, room charge, kitchen dispatch or check settlement is invoked by draft lines.
- No global customer-directory access is introduced through hospitality routes.
- Existing Materials Control APIs and roles remain unchanged outside narrowly scoped hospitality access.

## Next

Handle guest identity verification/deduplication, legacy customer property onboarding, check-in/out, order void approvals, and double-entry-controlled posting before production usage. The newly created draft POS orders are not sales and must not be reported as revenue.
