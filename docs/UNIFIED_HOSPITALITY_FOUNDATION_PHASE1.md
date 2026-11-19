# Unified Hospitality Foundation — Phase 1, increment 1

This increment introduces **schema and permission templates only**; it does not
yet expose reservation posting, guest check-in/out, POS settlement, or room
charge endpoints. Existing Materials Control behavior remains unchanged.

## Reused existing master records

- `organization.Hotel` — hotel group/profile
- `departments.Branch` — property isolation boundary
- `customers.Customer` — guest/customer identity (no duplicate guest table)
- `inventory.StoreLocation` — restaurant/bar outlet
- `materials_control.OutletAssignment` — staff-to-outlet assignments
- `employees.Employee` — staff identity, linked to user roles

## New app: hospitality

- `RoomType`: property-specific accommodation classification
- `Room`: physical room, housekeeping status and property-specific uniqueness
- `Reservation`: guest, property, stay dates, room and lifecycle
- `POSCheck`: outlet check and optional linked reservation for future room-charge settlement

Model-level cross-property checks catch invalid assignments, and unit tests
cover those boundaries. Reservation overlap checks performed by `full_clean`
are **not** concurrency-safe alone. The subsequent booking service must lock
room inventory and recheck availability in one database transaction.

## New role templates

Receptionist, Reservations Agent, Front Office Manager, Housekeeper,
Housekeeping Supervisor, Bartender, Waiter, Cashier, Bar Supervisor and
F&B Manager. These roles initially receive only model permissions for
foundation records. API-level object filtering, cashier/shift authorization,
supervisor overrides and posting permissions must be completed before
operational endpoints are opened.

## Required next increments

1. Secured property-filtered reservation APIs with atomic allocation, state transitions, and privacy controls
2. POS order lines, menu/price snapshots, kitchen routing and open-tab lifecycle
3. Controlled settlement, room-charge folios and one-time sales/stock ledger postings
4. Reception and POS screens, then end-to-end automated role and accounting tests

This commit is not a claim of Oracle Simphony/OPERA parity or production readiness.
