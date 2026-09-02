# Partial Delivery Receiving Flow

The Receiving & GRN screen now keeps historical receipt quantities out of the main receiving table.

## Receiving rule

- `LPO Qty Due` is the current outstanding quantity on the LPO line.
- `Receive Now` defaults to that quantity.
- When `Receive Now == LPO Qty Due`, the GRN is generated normally with no additional prompt.
- When any `Receive Now < LPO Qty Due`, a Partial Delivery dialog appears before GRN creation.
- The Receiving Clerk must enter a short-delivery reason and confirm the partial delivery.
- The balance remains open for a later supplier delivery.
- Quantities greater than the LPO balance are blocked.

The backend validates the short delivery independently of the browser and records the reason on the GRN/inspection activity trail.
