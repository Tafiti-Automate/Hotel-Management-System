# Quantity Approval and Item Rejection Controls

## Quantity control by workflow stage

The system preserves the original requested quantity and records downstream quantity decisions separately.

- Department Head: may keep or reduce each requested item quantity. Zero rejects that item.
- Store Keeper: may keep or reduce the HOD-approved quantity. Zero rejects that item.
- Procurement Officer / Procurement Manager: may keep or reduce the Store Keeper quantity on the procurement requisition, and may keep or reduce the Procurement quantity at Level 1 LPO review.
- Financial Manager: may keep or reduce the Level 1-approved LPO quantity.
- General Manager: may keep or reduce the Finance-approved LPO quantity during final approval.

No downstream role can increase an item above the quantity approved by the previous stage.

## Price control

Prices remain controlled by the Cost Controller. Procurement, Stores, Finance and General Management can view the applicable price but cannot change it through the requisition or LPO workflow. Supplier allocation uses the Cost Controller-approved supplier quotation/price record.

## Item-level rejection

For multi-item requisitions/LPOs, an authorized reviewer can reject one line without rejecting the whole document. A rejection reason is required and the line quantity becomes zero for the downstream workflow. Earlier-stage rejected lines cannot be restored by a later stage.

The whole requisition/LPO can still be rejected using the dedicated **Reject entire requisition/LPO** action. The system prevents using item-level rejection to remove the final remaining line; in that case the reviewer must use the whole-document rejection action.

## Auditability

Original quantities remain on the source records. Stage-specific approved quantities and rejection reasons are stored separately, and workflow/audit history records the decision and actor.

## GRN layout

The Goods Received Note title area spans the full A4 landscape document width so the property heading and **Goods Received Note** title are centered over the document. Supplier and delivery metadata remain below the centered title.
