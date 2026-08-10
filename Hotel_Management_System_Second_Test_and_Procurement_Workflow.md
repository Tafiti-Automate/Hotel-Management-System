# Hotel Management System — Second Live Test & Procurement Workflow

## Purpose

This document captures the conversation and working notes from the second live test of the Hotel Management System, especially the **Stores & Consumption → Department Requisition → Stores → Procurement** workflow.

The testing approach is to enter realistic example data into the actual system, proceed step by step, and identify anything that does not behave as expected.

---

# 1. John — Requester Test

The user was logged in as **John** and initially had the Stores & Consumption screen showing:

- Department supply & stores
- Manage requests, approvals, stock issues and consumption
- Role-based tasks:
  1. Requester — New request
  2. Department Head — Department approval
  3. Stores Manager — Stock review
  4. Stores Manager — Shortages
  5. Stores team — Pick and issue

The Store Requests section showed:

> No store requests are waiting here.

The New Request form contained:

### Step 1 — Choose a saved draft request
- Saved draft request
- No drafts available

### Step 2 — Add every requested article
- Article
- Unit
- Requested quantity
- Add item to this request

### Step 3 — Review and submit
- Submit request with 0 items
- Cancel an unfinished request

---

# 2. Article Configuration

The article selected for testing was:

**Heavy Duty Cleaning Detergent**

The unit dropdown showed:

- Use article base unit
- kg
- liter
- tonnes
- other units

The article was checked as Administrator.

### Article configuration

- Article: Heavy Duty Cleaning Detergent
- SKU: CLE-0001
- Selected unit: liter
- Used for: Issue unit
- Base equivalent: 1 L = 1 L
- Selling price: 0
- Status: Active
- Conversion Factor: 1
- Base Unit: liter

Therefore the test was changed from bottles to liters.

### Test decision

The test continued with:

> Heavy Duty Cleaning Detergent — 20 liters

rather than 20 bottles, because the article was configured with liter as its base/issue unit.

---

# 3. Store Configuration Problem

When opening the Add Store Request form, the system initially showed:

- Department: HouseKeeping
- From your account
- Store: No active store configured for your branch
- Active issuing store: Required
- Required date
- Purpose

The Add Item action was inactive.

This was identified as a configuration issue.

---

## Store location configuration

The user configured:

### Main Store

- Branch: Main Branch - Sunrise Hotel
- Name: Main Store
- Address: Kampala
- Is active: True
- Is default: True
- Created: Aug. 1, 2026
- Updated: Aug. 2, 2026
- Created by: admin (E001)
- Jazzmin version: 3.0.4

The Store Locations list showed:

| Name | Branch | Is default | Is active |
|---|---|---:|---:|
| Main Store | Main Branch - Sunrise Hotel | True | True |

There was one store location.

The user later confirmed that the store-resolution issue was resolved.

---

# 4. John Employee Configuration

The employee record checked for John was:

**john Robertal**

- Active
- Employee ID: EMP-000010
- Department: HouseKeeping
- Job title: House keeper
- Contact: 0705297820
- Joined: 2026-08-02
- Status: Active
- ID: 4de70e39-ee97-4bff-b3be-e9c0de80cfe9
- User ID: 10
- First Name: john
- Last Name: Robertal
- Email: robertal@gmail.com
- Branch: Main Branch
- Branch ID: 615ee839-b840-437b-b85d-f765a3adac49
- Gender: Male
- Address: kampala

---

# 5. Updated Store Requisition Architecture

The user later provided improvements made to the newly uploaded ZIP:

- One shared Store Requisition document is now presented differently for:
  - Requester
  - Department Head
  - Stores Manager
  - Store Keeper
- Removed tutorial-style numbered workflow sections.
- Removed role explanation banners from operational forms.
- Added a professional item matrix showing:
  - Article
  - Requested quantity
  - Available quantity
  - Approved quantity
  - Issued quantity
- Stores review now makes stock availability immediately visible.
- Added consistent status labels such as:
  - Pending Department Approval
  - Pending Stores Review
  - Awaiting Procurement
  - Partially Issued
  - Completed
- Added an activity timeline to Store Requisition details:
  - Created
  - Department approved
  - Stock approved
  - Issued
- Request details now show the full document lifecycle instead of only basic fields.
- Store Keeper actions are grouped into concise sections:
  - Issue Voucher
  - Pick List
  - Dispatch
  - Handover
- Improved mobile handling for requisition item summaries.

These changes were considered much closer to a professional ERP-style workflow.

---

# 6. Recommended Departmental Requisition Workflow

The target process discussed was:

```text
EMPLOYEE
Create Store Request
        ↓
DRAFT
        ↓ Submit
PENDING HOD APPROVAL
        ↓
HOD Approves / Amends / Rejects
        ↓
PENDING STORES REVIEW
        ↓
Stores checks availability
        ↓
Full stock?                 Shortage?
    ↓                         ↓
Issue                    Procurement
                              ↓
                         Goods received
                              ↓
                         Stock updated
                              ↓
                         Stores resumes
                              ↓
                         Issue
                              ↓
                         Completion
```

Important quantity fields:

| Field | Meaning |
|---|---|
| Requested quantity | What the employee originally requested |
| Available quantity | What Stores currently has available |
| Approved quantity | What the approval process authorizes |
| Issued quantity | What was physically issued |

The original requested quantity should remain preserved even if the approved quantity is amended.

Example:

> Requested = 20 L  
> Approved = 15 L  
> Issued = 15 L

---

# 7. Mary — Department Head Test

The user logged in as:

**Mary Nalule — Department Head**

The Department Head workspace showed:

- Property: Main Branch
- Hotel operations
- Dashboard
- Store requests
- My approval queue
- Inventory records
- Units of measure
- Stores records
- Store requests

The Store Request Approvals screen showed:

> Review requests from your department.

### Pending approvals

There were 2 records.

#### SR-2026-00008

- Department: HouseKeeping
- Purpose: another test request
- Item: Heavy Duty Cleaning Detergent
- Requested: 15.00
- Approved: 0.00
- Issued: 0.00
- Status: Pending Department Approval

#### SR-2026-00004

- Purpose: out of detergent
- Heavy Duty Cleaning Detergent × 20.00
- Status: Pending Department Approval

This demonstrated that submitted requests were reaching Mary's approval queue.

The basic workflow was:

> John → Submit → Mary Approval Queue

---

## Mary approval test

The intended test was to use:

> SR-2026-00008

with:

> Heavy Duty Cleaning Detergent  
> Requested = 15

Approval comment:

> Approved for Housekeeping operations.

The expected result was:

- Request leaves Pending Department Approval
- Approved quantity becomes 15
- Requested quantity remains 15
- Issued quantity remains 0
- Request moves to the Stores stage
- Mary's approval appears in activity/history

Expected audit values:

> Requested = 15  
> Approved = 15  
> Issued = 0

---

# 8. Isaac — Stores Manager Test

The user logged in as:

**Isaac watumwa — Stores**

The Stores & Inventory workspace showed:

### Navigation

- Dashboard
- Store requests
- Procurement
- Procurement records
- Purchase orders
- Goods receipts
- Inventory records
- Article catalogue
- Categories
- Units of measure
- Unit conversions
- Stock balances
- Stock ledger
- Batches & expiry
- Stores records
- Store requests
- Stock issues
- Store returns
- Partners & control
- Suppliers
- Supplier catalogue
- Reports

### Stores Queue

> Review availability, shortages and fulfilment.

It showed:

- Stock review (1)
- Shortages (0)
- Ready to issue (1)

### Request awaiting stock review

**SR-2026-00001**

- Purpose: Department stock request
- Article: Heavy Duty Cleaning Detergent
- Quantity: 40.00
- Status: Pending Stores Review

The stock review form contained:

- Item to review
- Quantity Stores can approve
- Decision comment
- Save this item decision

The test was to select Heavy Duty Cleaning Detergent and inspect available stock before entering the Stores-approved quantity.

---

# 9. Store Issue Test

The user completed the issue process.

The Pick and Issue screen showed:

> Process approved stock issues.

It showed:

- Ready to issue (0)
- Issue vouchers: 2 records

### Issue vouchers

#### SI-2026-00002
- Main Store
- Posted
- john

#### SI-2026-00001
- Main Store
- Posted
- Not acknowledged

The Pick and Issue interface contained:

- Issue voucher
- Approved department request
- Issued by
- Create issue voucher
- Pick list
- Draft issue voucher
- Approved item to pick
- Pick quantity
- Add item to pick list
- Dispatch
- Post issue
- Handover
- Posted issue voucher
- Receiving employee
- None
- Receiver name

The user then wanted to move to the procurement process.

---

# 10. Procurement Process — Main Test Objective

The next goal was to test the procurement process end-to-end.

The key scenario was:

> Housekeeping needs detergent → Stores does not have enough → shortage → Purchase Requisition → PR approval → quotations → supplier award → LPO/PO → supplier delivery → GRN → inspection → stock → original request resumes → issue → invoice → payment

The important principle was:

> Do not manually create an unrelated PR before testing whether the Store Request process itself generates/links the procurement request.

The intended flow is:

> Store Request → Shortage → Linked Purchase Requisition

---

# 11. Deliberate Shortage Test

The proposed article was:

**Heavy Duty Cleaning Detergent**

Example:

> Requested = 100 L  
> Available = 20 L  
> Shortage = 80 L

The system should not issue 100 L when only 20 L are available.

The test was designed to determine whether the system identifies the shortage and creates/links a procurement request for the missing amount.

---

# 12. Procurement Test — Step 1: John Creates Request

Log in as:

> John Robertal — Department Requester

Go to:

> Stores & Consumption → Store Requests

Click:

> New Request

Create:

- Article: Heavy Duty Cleaning Detergent
- Quantity: 100 L
- Purpose: Housekeeping requires detergent for daily hotel operations and room cleaning.

Submit.

Expected:

> Pending Department Approval

---

# 13. Procurement Test — Step 2: Mary Approves

Log in as:

> Mary Nalule — Department Head

Open the pending request.

Expected item matrix:

| Article | Requested | Approved | Issued |
|---|---:|---:|---:|
| Heavy Duty Cleaning Detergent | 100 | 0 | 0 |

Approve:

> 100 L

Then the request should move toward Stores review.

---

# 14. Procurement Test — Step 3: Stores Creates/Identifies Shortage

Log in as:

> Isaac — Stores

Open the request.

Check actual available stock.

Expected example:

> Requested = 100 L  
> Available = 20 L  
> Shortage = 80 L

The Store Request process should then be tested for:

> Awaiting Procurement

and a linked procurement request.

Do not manually create the PR before testing whether the Store Request process generates the shortage/linked PR.

---

# 15. Purchase Requisition

Once the shortage creates the PR, the procurement process is:

> Purchase Requisition → Approval → Quotations → Award → PO/LPO → Supplier → GRN → Inspection → Stock → Invoice → Payment

The PR was expected to move through:

> Draft → Submitted → Approval → Approved

with alternatives for:

> Return / Reject

---

# 16. Procurement Approval

The procurement approval test should verify that an authorized approver can:

- Approve
- Return
- Reject

Return and Reject should require an appropriate comment according to the implemented workflow.

The test should first use approval, and later deliberately test return/rejection.

---

# 17. Quotations

After PR approval, supplier quotations would be entered.

Example suppliers proposed for testing:

1. CleanPro Supplies Ltd
2. BrightClean Uganda Ltd
3. HotelCare Supplies Ltd

The quotation process should cover:

- One quotation per supplier/PR
- Quotation lines
- Prices
- Delivery terms
- Other commercial terms
- Evaluation
- Award

These should only be entered after PR approval.

---

# 18. Supplier Award

The quotation comparison should test:

- Award reason
- Non-expired quotations
- Every PR line priced
- Minimum quotation count where configured

A documented configuration referenced a possible threshold of:

> 1,000,000 UGX

and:

> 3 quotations

The test was intended to exercise that rule if enabled.

---

# 19. LPO / Purchase Order

After supplier award:

> Procurement → Generate PO/LPO

Expected sequence:

> Draft PO → Review → Issue

The PO should be checked for:

- Supplier
- Lines
- Quantities
- Prices
- No over-ordering
- Issue status
- PR synchronization
- Supplier communication

---

# 20. Supplier Delivery / GRN

After the PO is issued, the receiving side should create:

> GRN — Goods Received Note

The receiving process should test:

- Issued/partially received PO
- Supplier delivery note
- Duplicate delivery-note prevention
- Received quantity not exceeding PO quantity

---

# 21. Inspection

A deliberate partial acceptance test was proposed.

Example:

> Ordered = 80 L  
> Received = 80 L  
> Accepted = 75 L  
> Rejected = 5 L

The purpose is to verify that received quantity is not automatically treated as accepted quantity.

The system should preserve the distinction between received, accepted and rejected quantities.

---

# 22. Stock Posting

After accepted goods are posted through receiving:

- Increase stock balance
- Create stock batch where applicable
- Create IN stock ledger entry
- Synchronize PO/PR fulfilment state

This should make the newly procured quantity available for the original departmental request.

---

# 23. Resume the Original Department Request

Original request:

> 100 L

Initial stock:

> 20 L

Procurement supplies:

> 80 L

Total available:

> 100 L

The workflow should then allow the Stores process to resume.

Intended sequence:

> Awaiting Procurement → Submitted / available for Stores review → Stock decision → Issue

This is a critical integration test because it proves Procurement is connected to the original Store Requisition rather than operating as an isolated purchasing module.

---

# 24. Supplier Invoice and Payment

After accepted goods are received:

> Finance → Supplier Invoice

Proposed finance lifecycle:

> Invoice Draft → Match → Matched/Exception → Approved → Payment Draft → Posted → Paid

The invoice matching should be based on the accepted/posted GRN value rather than merely the original quotation.

---

# 25. Complete Procurement Test Map

```text
JOHN
Create Store Request
100 L detergent
        ↓
MARY
Department Approval
        ↓
ISAAC — STORES
Stock Review
        ↓
Insufficient Stock
        ↓
SHORTAGE
        ↓
Linked Purchase Requisition
        ↓
PROCUREMENT
PR Approval
        ↓
Quotations
        ↓
Quotation Comparison
        ↓
Supplier Award
        ↓
Purchase Order / LPO
        ↓
Supplier
        ↓
Delivery
        ↓
GRN
        ↓
Inspection
        ↓
Accepted Goods
        ↓
Inventory Stock
        ↓
Original Store Request
Resume
        ↓
Store Issue
        ↓
Department Consumption
        ↓
SUPPLIER INVOICE
        ↓
Invoice Match
        ↓
Invoice Approval
        ↓
PAYMENT
        ↓
PAID
```

---

# 26. Current Testing Philosophy

The objective is to test the actual system by entering data and moving through the real application rather than relying only on a theoretical workflow.

The approach is:

1. Use realistic hotel example data.
2. Log in as the correct role.
3. Click through the system step by step.
4. Stop after important transitions.
5. Check status and quantities.
6. Identify anything that does not behave as expected.
7. Do not hide configuration or workflow problems.
8. Give special attention to the procurement process.

The most important procurement test is:

> Department request → shortage → linked PR → procurement approval → quotations → award → LPO/PO → delivery → GRN → inspection → stock → resume requisition → issue → invoice → payment.

---

# 27. Key Test Data

## Employee

**John Robertal**
- Employee ID: EMP-000010
- Department: HouseKeeping
- Job title: House keeper
- Branch: Main Branch
- User ID: 10
- Status: Active

## Department Head

**Mary Nalule**
- Role: Department Head
- Department: HouseKeeping

## Stores User

**Isaac watumwa**
- Role: Stores / Stores Manager

## Store

**Main Store**
- Branch: Main Branch - Sunrise Hotel
- Address: Kampala
- Active: Yes
- Default: Yes

## Article

**Heavy Duty Cleaning Detergent**
- SKU: CLE-0001
- Unit: liter
- Base Unit: liter
- Conversion Factor: 1
- Status: Active

## Example normal request

> Heavy Duty Cleaning Detergent — 15 L or 20 L

## Example procurement shortage request

> Heavy Duty Cleaning Detergent — 100 L

Example shortage:

> Available = 20 L  
> Shortage = 80 L

---

# 28. Main Goal

The overall objective is to verify that the Hotel Management System works as a real hotel operational system, particularly for:

- Departmental requisitions
- Department Head approval
- Stores review
- Stock allocation
- Shortages
- Procurement
- Purchase Requisitions
- Supplier quotations
- Supplier award
- Purchase Orders / LPOs
- Goods Receipt Notes
- Inspection
- Stock posting
- Store issue
- Consumption
- Supplier invoices
- Payment

The test should continue until the complete process is proven end-to-end.
