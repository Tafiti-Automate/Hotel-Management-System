# Controlled Front Office room movements and housekeeping transitions

The Front Office Manager can now submit property-scoped room changes through:

- `POST /api/v1/hospitality-rooms/{id}/change-condition/`
  - `condition`: `dirty`, `clean`, `inspected`, `out_of_order`, `return_to_service`
  - `reason`: 8–250 characters; audited
- `POST /api/v1/hospitality-reservations/{id}/move-room/`
  - `target_room`: destination Room UUID; `reason`: 8–250 characters; audited

Both operations serialize on the property row, validate Django model permissions,
and record the original and resulting state with the acting user in the immutable
AuditLog chain, within the same transaction.

Housekeeping staff may clean/soil with room-change permission; inspection is
restricted to Housekeeping Supervisors or Front Office Managers. Out-of-order
changes require Front Office Manager authorization and cannot displace guests
or active reservations. The return-to-service transition resets cleaning to dirty.

Moves require an active reservation and an active, vacant, compatible room
of sufficient guest capacity. Checked-in guests move only to clean/inspected
rooms. The source room becomes vacant/dirty and the destination occupied in
a single transaction. The folio remains linked to the reservation and no
charges, refunds, stock adjustments or checkout operations are posted.

Checkout, folio financial journal, payment settlements, POS depletion and
night-audit posting **remain disabled**. No financial completion is implied.
