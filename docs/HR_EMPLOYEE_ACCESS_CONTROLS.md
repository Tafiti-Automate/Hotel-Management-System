# HR Employee Access Boundaries

Status: 23 November 2026 — security-hardening phase. This document describes
enforced application controls, not a certification of full Kalibu HR parity.

## Roles and responsibilities

- **HR Manager** may register and edit personnel records only in the assigned
  hotel. Where properties have no parent Hotel, scope is the assigned property.
- **System Administrator** alone assigns or changes account roles, resets an
  existing employee's password, and changes an existing employee's account
  identifiers (username and employee code).
- HR registration creates an **unassigned role**. HR sets a temporary password
  for onboarding; IT must assign an appropriate operational role before the
  employee gains that role's permissions.
- HR cannot activate/deactivate its own linked account or a protected
  HR/Finance/General Management/Administrator account. IT handles those changes.
- All other operational roles with employee read permissions see only employees
  belonging to their hotel, not the entire installation.

## Backend enforcement

- `EmployeeViewSet.get_queryset` enforces hotel/property boundaries before
  list, retrieve, update, and delete.
- `perform_create` and `perform_update` verify HR/IT ownership and
  original/destination properties server-side.
- `EmployeeSerializer.validate` rejects HR role escalation, credential resets,
  changed account identifiers, and protected-account activation changes.
- Employee deletion remains **soft deactivation**; protected accounts require IT.
- Direct trusted serializer calls without an API request remain supported for
  existing Django migration/seed operations.

## Frontend

The HR employee form defaults to the assigned property and limits its property
picker to that hotel. Employee IDs are generated automatically; password reset
and account ID fields are not shown during HR employee editing. The server is
the source of authorization, regardless of what the browser submits.

## Validation and remaining work

Backend regression tests are in
`hotel_erp_backend/tests/test_employee_access_boundaries.py`.
Frontend form assertions are in
`frontend/src/features/shared/hrEmployeeAccessSecurity.test.mjs`.

Production HR sign-in, data isolation, role handoff, payroll approvals, and
legal statutory handling require separate acceptance tests. These changes do
**not** enable salary disbursements or bank reconciliation.
