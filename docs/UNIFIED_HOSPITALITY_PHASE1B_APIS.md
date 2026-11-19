# Phase 1B — Property-scoped PMS & POS endpoints

Increment 1B adds the first operational APIs after the shared hospitality
data structures. Existing Materials Control role readiness remains fixed at
its original ten canonical roles; hospitality roles are provisioned
separately.

## Endpoints

- `GET /api/v1/hospitality-room-types/`
- `GET /api/v1/hospitality-rooms/`
- `GET /api/v1/hospitality-reservations/`
- `POST /api/v1/hospitality-reservations/`
- `PATCH /api/v1/hospitality-reservations/{id}/` (reserved records only)
- `GET /api/v1/hospitality-reservations/availability/?arrival=YYYY-MM-DD&departure=YYYY-MM-DD`
- `GET /api/v1/hospitality-pos-checks/`
- `POST /api/v1/hospitality-pos-checks/` (open check without room charge)

All endpoints require model permissions AND an active employee property
assignment. POS checks additionally require an active employee-to-outlet
assignment. No auto-escalation for administrators.

Reservations lock the parent Branch row inside a transaction before checking
room overlaps. Reservation API cannot change status, guest or property,
and can only modify previously reserved bookings. The room availability
endpoint excludes overlapping active reservations and out-of-order rooms.

**Not yet supported:** arrival/check-in, room moves, guest folio posting,
POS order lines, POS settlement, cashier shift operations, integration to
sales/stock, housekeeping transitions and secure guest registration.
No payment or stock posting endpoints are exposed in Phase 1B.

## CI repair

The ten Materials Control role audit checks must remain unchanged; hospitality
roles are separate. The Phase 1 foundation POS fixture now creates its required
Employee.department.
