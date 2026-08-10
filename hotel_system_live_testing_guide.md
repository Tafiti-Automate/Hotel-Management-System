# Hotel System — Beginner's Guide, Live Testing Walkthrough, and Procurement Process

## 1. Purpose of this document

This document captures the conversation and practical guidance about understanding and testing the hotel operations system described in the provided `.md` documentation.

The goal is to understand the system from zero, then test it with realistic data from beginning to end.

The main operational chain is:

**Department Need → Request/PR → Approval → Procurement → Quotation → Award → LPO/PO → Supplier Delivery → GRN → Inspection → Stock → Department Issue/Consumption → Supplier Invoice → Matching → Payment**

---

# 2. What the system does

The system is a hotel operations/ERP foundation covering areas such as:

- Procurement
- Inventory and Stores
- Department requests
- Receiving
- Supplier returns
- Finance/payment processes
- HR/security
- Reporting
- Audit/history
- Notifications

The strongest connected area is the procurement-to-inventory operational flow.

---

# 3. Main roles

The documented roles include:

| Role | Main responsibility |
|---|---|
| System Administrator | Controls system configuration and users |
| General Manager | Overall management/approval |
| Procurement Manager | Procurement and supplier purchasing |
| Finance Controller | Supplier invoices and payments |
| Stores Manager | Stock/store control |
| Store Keeper | Physical stock issues and returns |
| Department Requester | Requests items for a department |
| Department Head | Approves departmental requests |
| Receiving Officer | Receives and inspects deliveries |
| Auditor | Oversight and review |

Permissions determine what each role can see and do.

---

# 4. Important distinction: Store Request vs Purchase Requisition

This is one of the most important things to understand.

## Store Request

A department employee asks Stores for something.

Example:

> Housekeeping employee John needs 20 bottles of detergent.

Flow:

**John → Department Head → Stores → Issue**

If Stores does not have enough stock:

**John → Department Head → Stores → Shortage → Linked Purchase Requisition → Procurement**

## Purchase Requisition (PR)

A PR is the procurement document used when the hotel needs to purchase something.

Flow:

**Need → PR → Approval → Quotations → Award → PO/LPO → Supplier → GRN → Inspection → Stock/Consumption → Invoice → Payment**

---

# 5. Important role example: employee vs department head

The system supports the normal departmental workflow where an ordinary employee creates the request and submits it to the Department Head.

Example:

- John = Housekeeping employee/requester
- Mary = Housekeeping Department Head

Normal flow:

**John creates request → John submits → Mary approves → Stores**

If the requester is themselves a Department Head, the documented workflow allows a department-approval bypass:

**Mary creates request → Submit → Stores**

This is different from an ordinary employee request.

---

# 6. Full procurement lifecycle

The overall procurement process is:

1. Need identified
2. Purchase Requisition created
3. PR items added
4. PR submitted
5. Approval route determined
6. Approver reviews
7. Approve / Return / Reject
8. Approved PR
9. Supplier quotations collected
10. Quotations compared
11. Supplier awarded
12. Purchase Order/LPO generated
13. LPO reviewed
14. LPO issued
15. Supplier receives order
16. Supplier delivers
17. GRN created
18. Delivery inspected
19. Accepted/rejected quantities determined
20. Accepted goods posted
21. Stock/batch/ledger updated
22. Supplier invoice entered
23. Invoice matched
24. Invoice approved
25. Supplier paid

---

# 7. Live end-to-end test scenario

## Test hotel

**Sunrise Hotel**

## Branch

**Main Branch**

## Department

**Housekeeping**

## Test employees

| Employee | Role |
|---|---|
| John Admin | System Administrator |
| Mary Manager | Department Head |
| Peter Procurement | Procurement Manager |
| Sarah Stores | Stores Manager |
| David Keeper | Store Keeper |
| Grace Receiving | Receiving Officer |
| Robert Finance | Finance Controller |

## Supplier

**CleanPro Supplies Ltd**

For the sourcing test, additional suppliers can be:

- BrightClean Uganda Ltd
- HotelCare Supplies Ltd

## Item

**Heavy Duty Cleaning Detergent**

- Category: Cleaning Supplies
- Unit: Bottle
- Test unit price: 10,000 UGX

## Store

**Main Store**

---

# 8. Test 1 — Department employee creates a request

We want to specifically test whether an ordinary employee can create a request and send it to their Department Head.

## Step 1

Log in as:

**John — Housekeeping employee/requester**

## Step 2

Go to:

**Inventory → Store Requests**

## Step 3

Click:

**New Request**

## Step 4

Enter:

- Item: Heavy Duty Cleaning Detergent
- Quantity: 20
- Purpose: Housekeeping daily operations

## Step 5

Save.

## Step 6

Click:

**Submit**

### Expected result

Because John is not the Department Head, the request should go to:

**Pending Department Approval**

## Step 7

Log out as John.

## Step 8

Log in as:

**Mary — Housekeeping Department Head**

## Step 9

Open the pending request.

Review:

- Requester
- Department
- Item
- Quantity
- Purpose

## Step 10

Click:

**Approve**

### Expected result

The request moves toward Stores.

---

# 9. Test 2 — Stores checks stock

Log in as:

**Sarah — Stores Manager**

Open the approved request.

The system checks whether the requested quantity is available.

## If stock is available

Example:

- Requested: 20
- Available: 95

The process can continue toward:

**Reserve → Issue**

## If stock is not available

Example:

- Requested: 20
- Available: 5

The shortage should lead to a linked Purchase Requisition for the missing quantity, and the request can enter an awaiting-procurement state.

---

# 10. Live procurement test

For a full procurement test, create a PR for:

**100 bottles of Heavy Duty Cleaning Detergent**

Estimated cost:

**100 × 10,000 = 1,000,000 UGX**

---

# 11. Step-by-step PR test

## Step 1 — Login

Log in as an authorized procurement/requesting user.

## Step 2 — Open Procurement

Go to:

**Launchpad → Hotel Operations → Procurement**

Then open the requisition/procurement area.

## Step 3 — Create PR

Click:

**New / Create Requisition**

Enter:

- Request type: Department Purchase
- Department: Housekeeping
- Reason: Housekeeping requires cleaning detergent for daily hotel operations.

## Step 4 — Add item

Click:

**Add Item**

Select:

**Heavy Duty Cleaning Detergent**

Enter:

- Quantity: 100
- Estimated unit cost: 10,000 UGX

Expected total:

**1,000,000 UGX**

## Step 5 — Save

Click:

**Save**

The system should generate a PR reference.

Example:

`PR-BRANCH-2026-00001`

Record the actual PR number.

## Step 6 — Submit

Click:

**Submit**

The system should validate:

- Items exist
- Quantities are valid
- Requester/department information is valid
- An approval route exists
- An appropriate approver can be resolved

Expected status:

**Submitted / Pending Approval**

---

# 12. Approve the PR

Log in as the employee resolved as the approver.

Open the PR.

Review:

- Item
- Quantity
- Estimated value
- Requester
- Department
- Reason

Click:

**Approve**

Expected result:

- Approval decision recorded
- Time recorded
- Workflow updated
- Next stage notified if applicable
- Eventually PR becomes **Approved**

---

# 13. Test rejection

Create another test PR.

Submit it.

As the approver:

Click:

**Reject**

Enter a reason, for example:

> Quantity is not justified; please revise the requirement.

Expected:

**Rejected**

The requester should be notified.

---

# 14. Test return

Create another PR.

Submit it.

As approver:

Click:

**Return**

Enter:

> Please provide a clearer operational justification.

Expected:

**Returned**

Requester corrects the PR and resubmits.

Expected:

**Approval process starts again.**

---

# 15. Create supplier quotations

After the main PR is approved, log in as:

**Peter — Procurement Manager**

Open the approved PR.

Create three quotations.

## Quotation 1

Supplier:

**CleanPro Supplies Ltd**

- Quantity: 100
- Unit price: 10,000 UGX
- Total: 1,000,000 UGX
- Delivery: 3 days

## Quotation 2

Supplier:

**BrightClean Uganda Ltd**

- Quantity: 100
- Unit price: 9,500 UGX
- Total: 950,000 UGX
- Delivery: 5 days

## Quotation 3

Supplier:

**HotelCare Supplies Ltd**

- Quantity: 100
- Unit price: 9,800 UGX
- Total: 980,000 UGX
- Delivery: 2 days

---

# 16. Compare quotations

| Supplier | Total | Delivery |
|---|---:|---|
| CleanPro | 1,000,000 | 3 days |
| BrightClean | 950,000 | 5 days |
| HotelCare | 980,000 | 2 days |

For this test, choose:

**HotelCare Supplies Ltd**

Reason:

> HotelCare provides the shortest delivery time while remaining competitively priced and meeting the operational requirement.

Click:

**Award**

The system should validate the quotation and award requirements.

---

# 17. Generate the Purchase Order/LPO

From the approved PR/procurement workbench:

Click:

**Generate PO**

Expected:

**Draft Purchase Order/LPO**

Check:

- Supplier
- Item
- Quantity
- Unit price
- Total

Expected:

- Supplier: HotelCare Supplies Ltd
- Quantity: 100
- Unit price: 9,800 UGX
- Total: 980,000 UGX

---

# 18. Issue the LPO

Review the draft carefully.

Then:

**Click Issue**

The documented behavior says issuing should:

1. Validate the PO
2. Change it to Issued
3. Synchronize procurement status
4. Send supplier communication/email
5. Record communication outcome

Check the email/communication history.

If a real test email is configured, check the inbox.

---

# 19. Supplier delivery

Pretend three days have passed.

Supplier delivers:

**100 bottles**

Delivery note:

`DN-TEST-001`

---

# 20. Create GRN

Log in as:

**Grace — Receiving Officer**

Go to the receiving/GRN area.

Click:

**New GRN**

Select the issued PO.

Enter:

- Delivery note: DN-TEST-001
- Quantity received: 100
- Destination: Main Store

Save.

---

# 21. Test over-receiving

PO quantity:

**100**

Try to enter GRN quantity:

**110**

Expected:

**Blocked**

Correct it back to:

**100**

---

# 22. Test duplicate delivery note

Create a GRN using:

`DN-TEST-001`

Then try creating another GRN with the same delivery note.

Expected:

**Blocked**

---

# 23. Inspect delivery

Create/open the inspection.

Suppose:

- Received: 100
- Accepted: 95
- Rejected: 5

Enter:

**Accepted = 95**

**Rejected = 5**

---

# 24. Test invalid inspection quantities

Try:

- Accepted = 95
- Rejected = 10

Total = 105

Expected:

**Blocked**

Correct back to:

- Accepted = 95
- Rejected = 5

---

# 25. Post accepted goods

Post the accepted quantity.

Expected store posting:

- Stock balance increases by 95
- Batch is created
- IN stock ledger entry is created

Check Inventory.

Expected:

**Heavy Duty Cleaning Detergent = +95**

---

# 26. Supplier return test

The 5 rejected units were damaged.

Create a supplier return:

- Supplier: HotelCare Supplies Ltd
- Item: Heavy Duty Cleaning Detergent
- Quantity: 5
- Reason: Damaged on delivery

Apply/post the return.

Expected:

- Return becomes posted/dispatched
- Stock is not incorrectly increased
- OUT ledger entry is created where applicable

---

# 27. Department issue test

Housekeeping now requests:

**20 bottles**

Log in as the Department Requester.

Create Store Request:

- Item: Heavy Duty Cleaning Detergent
- Quantity: 20
- Purpose: Daily housekeeping operations

Submit.

Department Head approves.

Stores Manager approves.

---

# 28. Store issue

Log in as:

**David — Store Keeper**

Open the approved request.

Issue:

**20 bottles**

Apply/post the issue.

Expected system behavior:

- Stock decreases
- Reservation/outstanding quantity updates
- FEFO batch allocation is used
- OUT ledger is created
- Consumption information is created

If stock before issue was:

**95**

Expected stock afterward:

**75**

---

# 29. Record acknowledgement

Record the person who received the goods.

Check that the request/issue records the receiver.

---

# 30. Supplier invoice test

The accepted purchase quantity was:

**95 bottles**

Unit price:

**9,800 UGX**

Accepted value:

**95 × 9,800 = 931,000 UGX**

Log in as:

**Robert — Finance Controller**

Go to:

**Finance → Supplier Invoices**

Create invoice:

- Supplier: HotelCare Supplies Ltd
- PO: Test PO
- Invoice number: INV-TEST-001
- Amount: 931,000 UGX

---

# 31. Match invoice

Click:

**Match**

Expected:

**Matched**

The documented matching process compares invoice value with accepted posted GRN evidence and uses the documented tolerance.

---

# 32. Approve invoice

Click:

**Approve**

Expected:

**Approved**

---

# 33. Create payment

Click:

**New Payment**

Enter:

- Amount: 931,000 UGX
- Payment method: Bank Transfer
- Reference: PAY-TEST-001

Save.

Then:

**Post Payment**

Expected:

- Payment = Posted
- Invoice = Paid

---

# 34. Full test flow

The entire normal scenario is:

```text
Housekeeping Employee
        ↓
Store Request
        ↓
Department Head
        ↓
Approve
        ↓
Stores
        ↓
Check Stock
        ↓
Shortage if necessary
        ↓
Purchase Requisition
        ↓
Approval
        ↓
Approved
        ↓
Quotations
        ↓
Compare
        ↓
Award Supplier
        ↓
Purchase Order / LPO
        ↓
Issue LPO
        ↓
Supplier
        ↓
Delivery
        ↓
GRN
        ↓
Inspection
        ↓
Accepted / Rejected
        ↓
Stock
        ↓
Department Issue
        ↓
Consumption
        ↓
Supplier Invoice
        ↓
Matching
        ↓
Invoice Approval
        ↓
Payment
        ↓
Paid
```

---

# 35. Negative/control tests

Do not test only the successful path.

Test whether the system prevents bad actions.

Recommended tests:

1. Requester tries to approve their own request
2. User tries to receive more than PO quantity
3. Duplicate delivery note
4. Inspection accepted + rejected exceeds received
5. Issue more stock than available
6. Apply same supplier return twice
7. Pay more than invoice outstanding
8. Reject a PR
9. Return a PR
10. Resubmit a returned PR
11. Invoice amount deliberately differs from accepted receipt value
12. Attempt unauthorized workflow/status manipulation
13. Test transfer approval
14. Test stock adjustment workflow
15. Test branch isolation/security

---

# 36. Known implementation concerns to test carefully

The provided documentation identifies several areas that deserve extra testing:

- Stock Adjustment workflow actions are incorrectly registered.
- Transfer has an apply path that may bypass intended approval.
- Some workflow fields may be writable more generally than intended.
- A GRN-item posting path may bypass inspection.
- Repeated store approval may potentially reserve stock again.
- Some statuses exist without corresponding actions.
- Finance/payment integration is incomplete in some areas.
- Branch selection is frontend filtering rather than full backend tenancy security.

These should be treated as implementation findings to verify during testing, not as assumptions about what every screen will do.

---

# 37. Test log

Keep a test table while testing.

| Test | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Create Store Request | Request created | | |
| Submit Request | Pending Department Approval | | |
| Department Head Approval | Approved | | |
| Create PR | PR created | | |
| Submit PR | Submitted/Pending Approval | | |
| Approve PR | Approved | | |
| Create Quotation | Created | | |
| Award Supplier | Supplier awarded | | |
| Generate LPO | Draft created | | |
| Issue LPO | Issued/email recorded | | |
| Create GRN | GRN created | | |
| Over-receiving | Blocked | | |
| Duplicate delivery note | Blocked | | |
| Inspection | 95/5 | | |
| Invalid inspection | Blocked | | |
| Post GRN | Stock +95 | | |
| Supplier Return | 5 returned | | |
| Department Issue | Stock -20 | | |
| Invoice Match | Matched | | |
| Invoice Approval | Approved | | |
| Payment | Posted/Paid | | |

---

# 38. How to think about the system

Do not think of the system as just a collection of screens.

Think of it as a connected story:

**PR**

means:

> We need to buy something.

**Approval**

means:

> The organization authorizes the requirement.

**Quotation**

means:

> Suppliers tell us what they can provide and at what price.

**Award**

means:

> We choose the supplier.

**PO/LPO**

means:

> We officially order from the supplier.

**GRN**

means:

> The supplier delivered something.

**Inspection**

means:

> We decide what was acceptable.

**Stock**

means:

> Accepted goods are now recorded operationally.

**Invoice**

means:

> The supplier says we owe them.

**Matching**

means:

> We compare the invoice against what was accepted.

**Payment**

means:

> We settle the supplier.

---

# 39. The most important beginner flow to memorize

If you remember only one flow, remember:

**Employee needs item**

↓

**Department Request**

↓

**Department Head Approval**

↓

**Stores checks stock**

↓

**If stock exists: Issue**

↓

**If stock does not exist: Linked PR**

↓

**PR Approval**

↓

**Quotations**

↓

**Award**

↓

**LPO**

↓

**Supplier Delivery**

↓

**GRN**

↓

**Inspection**

↓

**Accepted Stock**

↓

**Department Issue**

↓

**Consumption**

↓

**Supplier Invoice**

↓

**Match**

↓

**Approve**

↓

**Pay**

---

# 40. Testing principle

For every test, record:

**What I expected → What actually happened → Evidence → Pass/Fail**

Do not only check whether a button works.

Check whether the whole chain is correct:

**User → Permission → Action → Status → Data → Workflow → Next role → Notification → Ledger/financial effect → Final outcome**

That is how you determine whether the system is actually working correctly end-to-end.
