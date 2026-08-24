# Client Procurement Workflow — Implemented Specification

## Source of truth

The operational workflow is fixed as:

1. Cost Controller maintains Articles, UOMs/conversions, Suppliers and supplier-item quoted prices.
2. Requester creates a Department Request using Article + Quantity + Reason/Note only.
3. Department Head approves or rejects the Department Request.
4. Store Keeper receives only HOD-approved requests, selects the destination store, confirms/reduces each carried-forward quantity, and creates the linked Store Requisition for Procurement.
5. Procurement Manager receives the Store Requisition, selects a vetted supplier quotation from the Cost Controller catalogue, confirms/updates the current supplier price, may reduce quantity, and prepares the LPO.
6. Financial Manager approves/rejects and may reduce LPO quantity.
7. General Manager/Director performs final approve/reject. Rejection stops the LPO.
8. Approved LPO returns to Procurement. First print is ORIGINAL; later prints are COPY. Supplier email issue starts lead-day counting.
9. Receiving Clerk receives against issued LPOs, records supplier invoice and quantity received now, and generates GRN. Partial receipt never changes the approved LPO quantity.

## Fixed operational roles

- Requester
- Department Head
- Cost Controller
- Store Keeper
- Procurement Manager
- Financial Manager
- General Manager
- Receiving Clerk
- System Administrator

Operational role permissions are predefined. The role API is read-only and the UI no longer asks administrators to build these workflow roles manually.

## Department Request controls

- Only a user assigned the Requester role can create a Department Request.
- Department and requester are derived from the signed-in employee.
- Department does not select a store.
- Department does not see supplier, quotation, unit price or commercial total.
- Drafts can be edited only by their Requester.
- Submission moves the request to Pending Department Approval.

## Department Head controls

- Can see only requests from their own department/branch.
- Cannot approve their own request.
- Approve moves the request to Store Keeper action.
- Reject requires the request to return/stop with a reason.

## Store Keeper controls

- Does not create the Department Request.
- Sees HOD-approved requests for the branch covered by their active store assignments.
- Selects one of their assigned destination stores.
- Article and Department requested quantity are inherited/read-only.
- Confirms a carried-forward quantity for every line. Quantity cannot exceed Department quantity.
- A zero quantity requires a comment.
- Supplier and price data are not available.
- The hand-off creates a separate linked PurchaseRequisition used as the Store Requisition document.
- Store Requisition lines use the Store Keeper-confirmed quantities, not an automatically calculated stock shortage.
- The original Department Request quantities remain unchanged for audit.

## Procurement controls

- Procurement workbench accepts both new `store_requisition` source documents and legacy `store_shortage` documents for backwards compatibility.
- New Store Keeper hand-offs use `store_requisition`.
- Procurement selects from active supplier-item prices registered by Cost Controller.
- Procurement can confirm/update current supplier price and reduce quantity, never increase beyond Store Keeper quantity.

## Approval, print, issue and receiving controls

Existing backend controls retained:

- Finance approval precedes General Manager approval.
- Finance quantity reduction is stored separately.
- General Manager is final approval.
- First LPO print is ORIGINAL; subsequent prints are COPY.
- Lead time begins from supplier issue/email timestamp.
- Receiving uses separate received quantities and protects LPO ordered quantities.
- Partial receipts remain open for the outstanding balance.

## Deployment commands

After deploying this version, run:

```bash
python manage.py migrate
python manage.py setup_hotel_roles
```

`setup_hotel_roles` creates/updates the predefined roles and removes legacy direct Store Requisition permissions that previously made every employee a de-facto requester.

Then assign the **Requester** role only to employees authorized to originate Department requests.

## Minimum UAT

1. Assign Requester, Department Head, Store Keeper, Cost Controller, Procurement Manager, Financial Manager, General Manager and Receiving Clerk test accounts.
2. Cost Controller registers supplier, Article, UOM/conversion and supplier quotation price.
3. Requester creates 100 units and submits.
4. HOD approves.
5. Store Keeper sees it without a preselected destination store, selects an assigned store and carries 90 forward.
6. Procurement receives 90, selects supplier/current price and creates LPO for 80.
7. Finance reduces to 70 and approves.
8. General Manager approves.
9. Procurement prints once: ORIGINAL; prints again: COPY.
10. Procurement emails supplier; lead-day clock starts from that issue event.
11. Receiving Clerk receives 50. LPO remains 70, outstanding becomes 20.
12. Receive remaining 20; cumulative receipt must never exceed 70.
