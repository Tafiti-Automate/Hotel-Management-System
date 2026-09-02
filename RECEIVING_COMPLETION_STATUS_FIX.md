# Receiving Completion Status Fix

## Behaviour

An LPO remains in **Ready LPOs** only while at least one approved LPO line has a physical delivery balance outstanding.

- First short delivery: LPO becomes `partially_received`.
- Supplier delivers the remaining balance: LPO becomes `received` immediately after the GRN is recorded.
- The LPO then leaves the Receiving Clerk **Ready LPOs** list.
- GRN inventory posting remains a separate stage and does not reopen the supplier-delivery queue.

The Receiving workspace also recalculates issued/partial LPO statuses from non-cancelled GRNs when it loads, which repairs older stale LPO statuses automatically.
