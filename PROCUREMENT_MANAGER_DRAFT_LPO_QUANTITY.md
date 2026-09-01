# Procurement Manager Draft LPO Quantity Control

The Procurement Manager / Procurement Officer can revise the quantity of every draft LPO line before the LPO is sent to Level 1 approval.

- Quantity is editable directly in the LPO Preparation table.
- Unit price remains read-only and continues to come from the Cost Controller's supplier quotation catalogue.
- The displayed LPO total recalculates from the draft quantities.
- Clicking **Send for Level 1 Approval** saves all draft quantities transactionally and then starts the approval workflow.
- A draft quantity must be greater than zero and cannot exceed the remaining approved quantity on the source requisition.
- The backend revalidates every line and locks the LPO/lines during the quantity update to protect against concurrent changes.
- Existing audit signals record the line changes.
