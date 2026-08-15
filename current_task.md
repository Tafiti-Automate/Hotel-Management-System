# Current Task — Client Procurement & Receiving Workflow Realignment

## Objective
Realign the existing Hotel Management System to the exact procurement and receiving workflow confirmed with the client. The system must be role-driven, controlled, simple, and must not expose unrelated ERP functions to operational users.

## Non-negotiable scope rule
Do not add screens, reports, approval stages, inventory operations, finance modules, supplier-return workflows, inspection workflows, or configuration tools unless they are explicitly required below. Each operational role should see only the data and actions needed for its job.

## Confirmed roles
1. Department User / Requester
2. Cost Controller
3. Store Keeper
4. Procurement Manager
5. Financial Manager
6. General Manager / Director
7. Receiving Clerk
8. System Administrator — technical administration only

## 1. Cost Controller
The Cost Controller owns supplier and article master data.

### Supplier registration
Must create and maintain vetted suppliers using information obtained from supplier quotations:
- Supplier name
- Email
- Contact / phone
- TIN number
- Address
- Contact person
- Active/inactive state
- Items/articles supplied
- Quoted price per item
- Quoted unit of measure
- Quotation reference
- Quotation validity/effective date where available
- Quotation attachment/evidence

A supplier quotation used during supplier registration becomes the source of the supplier-item price catalogue. Do not introduce a separate uncontrolled price source.

### Article registration
Must create and maintain:
- Article/item name
- Base/smallest unit of measure
- Other valid purchase/request units
- Unit conversion factor to the smallest/base unit

`TOT` is treated as the client's smallest unit where that unit applies. The system must use explicit conversions and must never guess conversions.

### Visibility
Cost Controller should see only:
- Dashboard relevant to master-data work
- Suppliers
- Supplier-item quotations/prices
- Articles/items
- Units of measure
- Unit conversions

No procurement approval, LPO approval, GRN, finance, stock issue, HR, audit, or unrelated ERP screens.

## 2. Department User / Requester
A department raises a requisition for what it needs.

### Requisition fields
- Requisition number — numeric business reference
- Department
- Requested article/item
- Quantity requested
- Unit of measure
- Request/reason where needed

### Restrictions
Department users must NOT see or enter:
- Supplier
- Supplier quotation
- Unit price
- Line value
- Total value
- Commercial comparison

The department request is demand only.

## 3. Store Keeper
There is no Store Manager role. Store Keeper performs the store role.

### Store Keeper process
The Store Keeper receives the department request and creates/forwards the store procurement requisition based on it.

Required information:
- Source department request
- Article/item
- Quantity
- Unit
- Destination store

### Multi-store requirement
The system must support multiple stores.
- Every requisition must have a destination store.
- A Store Keeper may be assigned to one or more stores.
- A Store Keeper must only see requests/records for stores assigned to them, except System Administrator.

### Restrictions
Store Keeper must NOT see or select:
- Supplier
- Supplier quotations
- Supplier price
- Unit price
- LPO value
- Commercial evaluation

The Store Keeper should not have general inventory administration tools unless the client later asks for them.

## 4. Procurement Manager
The Procurement Manager receives the requisition from Stores and performs the commercial decision.

### Required actions
For each requisition line, Procurement Manager can:
- Review requested item and quantity
- Reduce quantity, never increase above the submitted quantity
- Review registered suppliers capable of supplying the item
- Review supplier catalogue quotation/price
- Contact supplier outside the system to confirm the current price
- Update the current supplier-item price with a traceable history
- Allocate/select the preferred supplier for the requisition/LPO
- Edit the procurement price before submission for financial approval
- Choose/confirm destination store
- Generate the draft LPO

Do not require online supplier calling or supplier portal functionality.

### Price control
Price updates must:
- retain supplier
- retain item
- retain unit
- retain old price in history
- retain new price
- retain change date/user
- allow quotation reference/evidence

## 5. LPO approval workflow
The LPO must follow this exact sequence:

`Procurement Manager -> Financial Manager -> General Manager/Director -> Procurement Manager`

No other operational approval stages should be inserted.

### Financial Manager
Financial Manager receives the prepared LPO and can:
- View LPO and its lines
- Approve
- Reject with mandatory reason
- Reduce line quantity

Financial Manager may reduce quantity but cannot increase it above Procurement's submitted quantity. Procurement's original quantity must remain in the audit trail.

If Finance rejects, the LPO returns to Procurement for correction/revision. It is not approved onward.

### General Manager / Director
Receives the LPO only after Finance approval and can:
- View LPO
- Approve
- Reject with mandatory reason

General Manager cannot change supplier, price, or quantities unless the client explicitly adds that requirement later.

If General Manager rejects:
- LPO status becomes rejected
- rejection reason is stored
- process stops until Procurement creates/resubmits a revision
- it must not proceed to supplier issue

If General Manager approves:
- LPO becomes fully approved
- it returns to Procurement Manager for printing/sending

## 6. Controlled LPO printing
Only a fully approved LPO can be controlled-printed.

Rules:
- First successful controlled print = `ORIGINAL`
- The generated document must visibly display `ORIGINAL`
- Every later print = `COPY`
- Later documents must visibly display `COPY`
- Original status is server controlled, not browser/local-storage controlled
- Print number, classification, user, and timestamp must be auditable

The existing server-side PurchaseOrderPrintRecord design should be preserved.

## 7. Email LPO to supplier and lead days
After final approval, Procurement Manager can:
- Print controlled LPO
- Send/email LPO to the selected supplier using the supplier's registered email

Lead-time counting starts only when the approved LPO is successfully issued/sent to the supplier.

Track at minimum:
- sent_at
- sent_by
- sent_to_email
- email status
- expected delivery date / lead days

Resending must not reset the original lead-time start unless explicitly treated as a revised LPO.

## 8. Receiving Clerk
Receiving Clerk logs in and sees only LPOs that are ready for receipt:
- issued/sent LPOs
- partially received LPOs with outstanding quantities

Receiving Clerk should not see unrelated procurement, approvals, supplier price editing, finance, stock controls, or system configuration.

### Receiving process
Receiving Clerk selects the issued LPO and confirms supplier delivery against it.

GRN header:
- GRN number — numeric business reference
- LPO number
- Received date
- Supplier invoice number brought with goods
- Delivery note number where available
- Receiving Clerk

GRN line:
- LPO item
- LPO ordered/approved quantity shown read-only
- Previously received quantity
- Outstanding quantity
- Quantity received now — editable
- Unit
- Destination store — inherited/read-only

### Partial delivery rule
Never edit or overwrite the LPO quantity when receiving.

Example:
- LPO quantity = 100
- First delivery = 60
- GRN records 60
- LPO remains 100
- Outstanding = 40
- LPO becomes partially received
- Second delivery can record up to 40

Backend must reject cumulative receipt above the approved LPO quantity.

The existing GoodsReceiptItem `quantity_received` design and over-receipt validation must be preserved.

### Price restriction
Receiving Clerk confirms physical delivery. The clerk should not edit price. Any unit cost stored on the GRN must be inherited from the approved LPO and kept read-only in the receiving UI.

## 9. Numbering
Client-facing business document numbers must be numeric:
- Requisition number
- PO/LPO number
- GRN number

Use server-side concurrency-safe sequences. Do not expose UUIDs as the business document reference.

## 10. Frontend role experience
Each role must land on a focused dashboard/work queue.

### Department User
- My requisitions
- New requisition
- Requisition status

### Cost Controller
- Suppliers
- Supplier quotations/prices
- Articles
- UOMs
- Unit conversions

### Store Keeper
- Department requests requiring store action
- Create/forward store procurement requisition
- Store destination
- Status tracking

### Procurement Manager
- Incoming store requisitions
- Supplier/price selection
- Draft LPOs
- Rejected LPO revisions
- Fully approved LPOs ready to print/email
- Issued LPO status

### Financial Manager
- LPOs awaiting Finance decision only
- Approve / reject / reduce quantity

### General Manager
- LPOs awaiting final approval only
- Approve / reject

### Receiving Clerk
- Ready LPOs
- Partially received LPOs
- Create/edit draft GRN
- View completed GRNs

Avoid generic workflow hubs containing controls irrelevant to the signed-in role.

## 11. Data-flow requirements
Use predecessor-driven forms:
- Department requisition creates demand
- Store Keeper selects the department request rather than retyping it
- Procurement selects the store requisition rather than retyping it
- LPO is generated from approved procurement data rather than retyping it
- GRN selects an issued LPO rather than retyping supplier/items

Whenever a parent document is selected, prefill and lock fields that should not be changed by the current role.

## 12. Existing functionality to retain
The current code already contains several correct controls. Do not remove them:
- Numeric procurement document sequence
- First LPO controlled print ORIGINAL, later prints COPY
- LPO Finance reduction recorded separately from Procurement quantity
- Final approval route validation requiring Finance then General Manager
- Email issue timestamp / supplier send tracking
- GRN quantity stored independently from LPO quantity
- Cumulative over-receipt protection
- Supplier-item price history
- UOM conversion model

## 13. Functionality to remove/hide from operational roles
Unless separately requested by the client, hide/remove from role menus and normal workflows:
- HR
- Sales
- Customer management
- Generic Finance workbench
- Bank accounts and bank transactions
- Expenses and cash flow
- Stock counts
- Stock adjustments
- Stock transfers
- Supplier returns
- Goods inspection workflow
- Reorder rules/queue
- Batches/expiry administration
- Consumption analytics
- Generic reports
- Audit log
- System settings

System Administrator may retain technical access.

## 14. Validation / acceptance scenario
Test the system with this exact scenario:

1. Cost Controller registers Supplier A with email, phone, TIN, address and quotation attachment.
2. Cost Controller registers Item X with base unit/TOT and a valid conversion for a larger unit.
3. Cost Controller records Supplier A price for Item X.
4. Department requests Item X, quantity 100. Department never sees price or supplier.
5. Store Keeper receives the department request, confirms quantity 100 and destination Store 1. Store Keeper never sees price or supplier.
6. Procurement Manager receives the store requisition, reduces quantity to 90, chooses Supplier A, updates the current price and creates LPO.
7. Financial Manager receives LPO, reduces quantity from 90 to 80, records reason, and approves.
8. General Manager receives the Finance-approved LPO and approves.
9. Procurement Manager controlled-prints the LPO. It shows ORIGINAL.
10. Procurement Manager prints again. It shows COPY.
11. Procurement Manager emails the approved LPO to Supplier A. Lead time starts from this issue/send timestamp.
12. Receiving Clerk sees the issued LPO and creates GRN with supplier invoice number.
13. Supplier delivers 50 of 80. Clerk enters 50. LPO remains 80; outstanding becomes 30; status becomes partially received.
14. A second GRN receives 30. Cumulative received becomes 80; outstanding becomes 0; LPO becomes fully received.
15. Attempt to receive any quantity above the remaining 30 on step 14 must be blocked.

## Definition of done
- Role menus expose only the confirmed functions.
- API permissions enforce the same restrictions server-side.
- Department and Store Keeper cannot access supplier/price information.
- Procurement Manager controls supplier and price selection.
- Financial Manager is first LPO approver and can only reduce quantity.
- General Manager is final LPO approver.
- Rejected LPO never proceeds to supplier issue.
- First controlled print is ORIGINAL; all later prints are COPY.
- Lead days start from first successful supplier issue/send.
- Receiving Clerk sees only issued/partially received LPOs and can record partial quantities without changing LPO quantities.
- Requisition, LPO/PO, and GRN business numbers are numeric.
- Multi-store routing is retained and store-specific access is enforced.
- Frontend forms follow the business flow and avoid duplicate re-entry.
- Frontend and backend tests/build pass.

## Frontend implementation update — 15 Aug 2026
Implemented the predecessor-driven frontend realignment requested by the client:
- Department request UI remains demand-only; requester identity/store routing are assigned without exposing supplier or price fields.
- Store Keeper dashboard/workbench is narrowed to department requests and procurement hand-off; unrelated stock operations are removed from the normal role flow.
- Store Keeper views explicitly avoid supplier, quotation, price and commercial information.
- Procurement incoming requisition screen is read-only against the Store Keeper predecessor; article/quantity/destination are inherited instead of retyped.
- Procurement supplier selection starts from Cost Controller supplier-item catalogue entries and prefills registered quotation price, unit and lead days.
- Procurement quantity is constrained in the UI so it cannot exceed the inherited requisition quantity.
- Finance and General Manager LPO screens hide Procurement editing/issue controls and expose only their applicable approval action.
- Procurement-only LPO issue/email controls appear only after final approval.
- Receiving selects an issued/partially received LPO and sees approved quantity, previously received quantity and outstanding quantity as read-only values.
- Receiving enters only quantity received now; UI blocks receiving above the outstanding quantity and does not edit the LPO quantity.
- TypeScript validation passes and the Vite production build completes successfully.

## Store Keeper create-request correction

- Store Keeper must **not** create a requisition.
- Department is the only operational role that originates the Department request.
- Store Keeper can only open submitted Department requests, review/carry forward allowed quantities, select/confirm the store context where applicable, and forward the existing predecessor document to Procurement.
- The generic `storeRequisitions` CRUD/list route is blocked for Store Keeper.
- No `New request` button is rendered for Store Keeper, even as a defensive fallback.
- Store Keeper workflow text must use **Forward to Procurement**, never **Create Procurement requisition**.

## 2026-08-15 role landing and Store Keeper queue correction

- [x] Submitted Department requisitions are visible to Store Keepers assigned within the same branch before destination-store confirmation.
- [x] Store Keeper confirms one of their assigned destination stores before changing carried-forward quantities.
- [x] General Manager cannot access `workflow-stores` or the generic Store Requisition CRUD route, even if an inventory view permission is accidentally inherited.
- [x] Financial Manager, Procurement Manager, Receiving Clerk and Cost Controller are also blocked from the Department/Store Keeper queue.
- [x] Role-specific login landing routes added: Requester -> own Department requisitions; Store Keeper -> Store Keeper queue; Procurement -> procurement workbench; Finance -> LPO approvals; General Manager -> final LPO approvals; Receiving -> receiving/GRN; Cost Controller -> master-data dashboard.
- [x] General Manager dashboard narrowed to final LPO approval information instead of store/inventory operational queues.
- [x] Misleading Store Keeper empty-state wording that suggested creating a new request removed.

### Required Store Keeper permissions for this flow

`inventory.view_storerequisition`, `inventory.change_storerequisition`, `inventory.view_storerequisitionitem`, `inventory.change_storerequisitionitem`, `inventory.view_item`, `inventory.view_unitofmeasure`, `inventory.view_storelocation`, `inventory.view_storekeeperassignment`.

The Store Keeper must not receive `inventory.add_storerequisition` or `inventory.add_storerequisitionitem`.

## 2026-08-15 role landing and Store Keeper queue correction
- [x] Submitted Department requisitions are visible to Store Keepers assigned within the same branch before destination-store confirmation.
- [x] Store Keeper confirms one of their assigned destination stores before changing carried-forward quantities.
- [x] General Manager cannot access `workflow-stores` or the generic Store Requisition CRUD route, even if an inventory view permission is accidentally inherited.
- [x] Financial Manager, Procurement Manager, Receiving Clerk and Cost Controller are also blocked from the Department/Store Keeper queue.
- [x] Role-specific login landing routes added: Requester -> own Department requisitions; Store Keeper -> Store Keeper queue; Procurement -> procurement workbench; Finance -> LPO approvals; General Manager -> final LPO approvals; Receiving -> receiving/GRN; Cost Controller -> master-data dashboard.
- [x] General Manager dashboard narrowed to final LPO approval information instead of store/inventory operational queues.
- [x] Misleading Store Keeper empty-state wording that suggested creating a new request removed.
