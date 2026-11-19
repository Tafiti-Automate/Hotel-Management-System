# Phase 1E — controlled check-in and POS draft adjustments

Reception and Front Office Manager can check in a currently valid reservation
when the room is active, vacant, clean/inspected and has no other occupant.
A property-level transaction lock guards the reservation and room status update;
the performing employee and timestamp are retained.

Reception and Front Office Manager can cancel reserved bookings; checked-in
bookings cannot be silently cancelled.

A Bar Supervisor assigned to the outlet can void a draft order line with a
required reason. The original order quantity and price remain, with the
supervisor, void time and reason for audit. Repeated voids fail closed.

CHECKOUT IS NOT ENABLED because guest folios, payments, taxes and outstanding
balances are not integrated. POS settlement, room charges, stock depletion,
cashier shift reconciliation and final financial posting also remain disabled.

Next: folio ledger, controlled room-charge authorization, cashier settlement
and exactly-once inventory posting before check-out is enabled.
