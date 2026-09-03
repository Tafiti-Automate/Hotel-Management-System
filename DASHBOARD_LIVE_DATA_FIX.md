# Dashboard Live Data Fix

This patch corrects dashboard counts without changing workflow or business logic.

## Corrected
- Preserves raw LPO workflow status alongside display status.
- Preserves LPO approval stages for Finance and General Manager dashboards.
- Correctly identifies Procurement supplier allocations and LPOs ready for preparation.
- Adds the Procurement Officer to the correct procurement dashboard rather than the generic fallback.
- Correctly counts issued and partially received LPOs for Receiving.
- Keeps historical GRNs visible after the related LPO drops out of the Receiving Clerk's open-LPO queryset.
- Derives fully received supplier deliveries from GRN history without double-counting multiple GRNs for one LPO.
- Uses serialized GRN branch information instead of depending on an open purchase-order record.

No backend workflow, database model, permission, approval sequence, LPO logic, or GRN posting logic is changed.
