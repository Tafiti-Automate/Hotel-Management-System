# HOD Approval PostgreSQL Fix V9.3

## Exact cause
The HOD approval locked requisition items with `select_for_update().select_related("item", "unit")`. The `unit` foreign key is nullable, so PostgreSQL uses an outer join. PostgreSQL rejects `FOR UPDATE` on the nullable side of an outer join and Django raises `NotSupportedError`. SQLite does not reproduce this, which is why local tests passed.

## Changes
- HOD approval now locks only requisition-item rows: `select_for_update().order_by("pk")`.
- Supplier quotation allocation was hardened because supplier-price UOM is also nullable.
- Finance LPO quantity review was hardened because purchase-order-item UOM is nullable.
- The generic error dialog now says `Action could not be completed` instead of `Inventory operation blocked`.

No migration is required.
