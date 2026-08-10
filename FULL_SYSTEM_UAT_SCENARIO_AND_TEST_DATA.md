# Hotel ERP — Full End-to-End UAT Scenario and Test Data

## 1. Test objective

Use this pack to test the complete hotel materials cycle:

`Configuration → Supplier catalogue → Store request → Approval → Procurement → PO → Receipt/inspection → Store or workspace → Stock issue/return → Finance → Reports/audit`

Test date: **3 August 2026**  
Test hotel: **Lakeview Grand Hotel**  
Currency: **UGX**

Do not use real employee passwords, bank accounts, tax numbers, or supplier contacts. The values below are fictional UAT data.

## 2. How to record results

For every numbered test, record:

| Test | Result | Document/reference generated | Tester | Comment/defect |
|---|---|---|---|---|
| Example | Pass / Fail / Blocked | PR-…, PO-…, GRN-… | Name | Screenshot or explanation |

Keep every auto-generated reference. Later tests and report drill-downs depend on them.

## 3. Test users and responsibilities

Create or use equivalent role-based accounts. Use a local UAT password such as `UatTest@2026!` and change/delete it after testing.

| Employee ID | Name | Department | Job title / role | Main test responsibility |
|---|---|---|---|---|
| EMP-UAT-001 | Amina Nansubuga | Housekeeping | Department Requester | Create store request |
| EMP-UAT-002 | Grace Namusoke | Housekeeping | Department Head | Department approval |
| EMP-UAT-003 | Peter Okello | Stores | Stores Manager | Stock review and shortage routing |
| EMP-UAT-004 | Sarah Akello | Stores | Store Keeper | Receive, pick, issue and return stock |
| EMP-UAT-005 | Daniel Kato | Procurement | Procurement Manager | Catalogue, PR, quotation and PO |
| EMP-UAT-006 | Ruth Atwine | Finance | Finance Controller | Invoice match and payment |
| EMP-UAT-007 | Michael Ssemanda | Management | General Manager | High-value approval and reports |
| EMP-UAT-008 | Joan Nabirye | Human Resources | HR Administrator | Employee/access checks |

### Access-control checks

- Amina must not approve her own request.
- Sarah must not approve a supplier invoice.
- Daniel must not post a supplier payment unless his role explicitly has that permission.
- Ruth may access Finance but should not silently change stock quantities.
- Michael should see management reports across authorised departments/branches.
- Every successful or rejected controlled action should identify the employee in the audit trail.

## 4. Organisation master data

### Hotel and branch

| Field | Value |
|---|---|
| Hotel | Lakeview Grand Hotel |
| Branch | Kampala Main Branch |
| Address | Plot 18 Lake View Road, Kampala |
| Currency | UGX |

### Departments

| Department | Purpose |
|---|---|
| Housekeeping | Guest rooms, linen and cleaning operations |
| Food and Beverage | Kitchen, restaurant and banquet operations |
| Maintenance | Engineering and property maintenance |
| Stores | Central receipt, custody and issue of stock |
| Procurement | Sourcing and supplier management |
| Finance | Payables, expenses, banking and control |
| Management | Executive approval and oversight |
| Human Resources | Employees and access administration |

### Store and workspaces

| Type | Name | Branch | Configuration |
|---|---|---|---|
| Store | Main Store | Kampala Main Branch | Active; default issuing store |
| Store | Engineering Store | Kampala Main Branch | Active; not default |
| Workspace | Housekeeping Linen Room | Housekeeping | Direct-delivery destination |
| Workspace | Main Kitchen | Food and Beverage | Direct-delivery destination |

Expected control: a store destination affects inventory; a direct workspace destination records receipt/acceptance but must not increase Main Store stock.

## 5. Article master data

### Categories

| Category | Description |
|---|---|
| Cleaning Supplies | Chemicals and cleaning consumables |
| Guest Linen | Linen and guest-room textiles |
| Dry Food | Non-perishable kitchen food |
| Electrical | Electrical maintenance consumables |
| Fresh Food | Perishable kitchen ingredients |

### Units of measure

| Unit | Abbreviation |
|---|---|
| Piece | pc |
| Litre | L |
| Kilogram | kg |
| Drum | drum |
| Bag | bag |
| Carton | ctn |

### Articles

| SKU | Article | Category | Base unit | Notes |
|---|---|---|---|---|
| CLN-DET-001 | Heavy Duty Cleaning Detergent | Cleaning Supplies | Litre | Stock item |
| LIN-TWL-001 | Premium White Bath Towel | Guest Linen | Piece | Direct-to-workspace test |
| FNB-RCE-001 | Long Grain Rice | Dry Food | Kilogram | Supplier comparison test |
| ENG-BLB-001 | LED Bulb 12W | Electrical | Piece | Partial/rejected delivery test |
| FNB-FSH-001 | Fresh Tilapia Fillet | Fresh Food | Kilogram | Direct-to-kitchen test |

### Article unit conversions

| Article | Selected unit | Role | Conversion factor | Meaning |
|---|---|---|---:|---|
| Heavy Duty Cleaning Detergent | Drum | Purchase unit | 20 | 1 drum = 20 L |
| Long Grain Rice | Bag | Purchase unit | 25 | 1 bag = 25 kg |
| Premium White Bath Towel | Carton | Purchase unit | 10 | 1 carton = 10 pc |
| LED Bulb 12W | Carton | Purchase unit | 20 | 1 carton = 20 pc |
| Fresh Tilapia Fillet | Kilogram | Purchase unit | 1 | 1 kg = 1 kg |

Validation: enter an invalid zero or negative conversion factor and confirm the system blocks it. Then save the valid values.

## 6. Supplier master data

| Supplier | Contact | Phone | Email | TIN | Payment terms | Status |
|---|---|---|---|---|---|---|
| Nile Hospitality Supplies Ltd | Brian Mugisha | 0700 100 101 | orders@nilai-uat.test | UAT-TIN-1001 | 30 days | Active |
| Kampala Foods Wholesale Ltd | Lydia Nakato | 0700 100 102 | sales@kfw-uat.test | UAT-TIN-1002 | 14 days | Active |
| BrightSpark Electricals Ltd | Ivan Ouma | 0700 100 103 | supply@bright-uat.test | UAT-TIN-1003 | 30 days | Active |
| FreshCatch Uganda Ltd | Mercy Adoch | 0700 100 104 | dispatch@freshcatch-uat.test | UAT-TIN-1004 | 7 days | Active |

Try saving a supplier without mandatory information and confirm validation is understandable.

## 7. Supplier catalogue and price data

Enter these rows under **Supplier Catalogue**:

| Supplier | Article | Purchase unit | Supplier ref | Price UGX | Effective from | Minimum | Lead days | Preferred |
|---|---|---|---|---:|---|---:|---:|---|
| Nile Hospitality Supplies | Heavy Duty Cleaning Detergent | Drum | NHS-DET20 | 140,000 | 2026-08-01 | 2 | 3 | Yes |
| Nile Hospitality Supplies | Premium White Bath Towel | Carton | NHS-TWL10 | 180,000 | 2026-08-01 | 2 | 5 | Yes |
| Nile Hospitality Supplies | Long Grain Rice | Bag | NHS-RICE25 | 122,000 | 2026-08-01 | 4 | 4 | No |
| Kampala Foods Wholesale | Long Grain Rice | Bag | KFW-RICE25 | 115,000 | 2026-08-01 | 4 | 2 | Yes |
| BrightSpark Electricals | LED Bulb 12W | Carton | BSE-LED12-20 | 240,000 | 2026-08-01 | 1 | 2 | Yes |
| FreshCatch Uganda | Fresh Tilapia Fillet | Kilogram | FCU-TILAPIA | 18,500 | 2026-08-01 | 20 | 1 | Yes |

### Catalogue controls to test

1. Open Kampala Foods Wholesale and confirm its supplied goods are visible.
2. Search for `Long Grain Rice`; compare both suppliers.
3. Confirm Kampala Foods is the lowest at **UGX 4,600/kg** and Nile is **UGX 4,880/kg** after unit conversion.
4. Update Kampala Foods rice price from **115,000** to **119,000**, effective **2026-08-03**.
5. Confirm the old price remains in price history and the percentage movement is approximately **3.48%**.
6. Mark one nonessential catalogue row inactive and confirm it is not selected for a new PO; reactivate it afterward.
7. Export or prepare the same data as CSV and test catalogue import. Do not import duplicate rows into production data without knowing how update matching works.

Expected: quotations and POs use the price valid for the document date, not an overwritten historical value.

## 8. Scenario A — Store request, shortage, procurement and stock issue

Business story: Housekeeping needs detergent for room deep-cleaning. Main Store has insufficient quantity, so Stores routes the shortage to Procurement. The goods must go to **Main Store**, then be issued to Housekeeping.

### A1. Requester creates the store request

Log in as **Amina Nansubuga**.

| Field | Value |
|---|---|
| Department | Housekeeping |
| Store | Main Store |
| Required date | 2026-08-08 |
| Purpose | August guest-room deep-cleaning programme |
| Article | Heavy Duty Cleaning Detergent |
| Requested quantity | 60 L |

Save as draft first. Confirm it is editable and not yet in Grace's approval queue. Then submit it.

Expected:

- Status becomes **Pending Department Approval**.
- Requested quantity remains 60 L throughout the lifecycle.
- Amina cannot approve it herself.
- Grace receives a pending action/notification.

### A2. Department approval

Log in as **Grace Namusoke**. Open the request, enter comment:

`Approved for August room deep-cleaning; consumption to be monitored.`

Approve **50 L**, leaving the original request at **60 L**.

Expected: approval history shows requester, approver, date, original 60 L and approved 50 L.

### A3. Stores review and shortage

Log in as **Peter Okello**. Review available stock. If Main Store has zero or less than 50 L, approve the available quantity and route the shortage to procurement.

Expected:

- The system shows requested, approved, available and shortage quantities separately.
- A procurement requisition is created/linked for the unresolved quantity.
- Destination is **Store → Main Store** and is visible on the requisition.

### A4. Procurement requisition and PO

Log in as **Daniel Kato**. Use or complete the shortage requisition:

| Field | Value |
|---|---|
| Purchase type | Store shortage / normal procurement |
| Required by | 2026-08-08 |
| Business justification | Replenish detergent required for approved Housekeeping request |
| Currency | UGX |
| Article | Heavy Duty Cleaning Detergent |
| Quantity | 3 drums = 60 L |
| Destination type | Store |
| Destination store | Main Store |
| Supplier | Nile Hospitality Supplies |
| Expected price | UGX 140,000 per drum |
| Expected subtotal | UGX 420,000 |

Submit and complete the configured approval chain. Try self-approval with the requester/procurement user and verify maker-checker restrictions.

Create the PO. Expected PO subtotal: **UGX 420,000** before any configured taxes.

Expected controls:

- Supplier price fills automatically from the valid catalogue entry.
- Destination copies from requisition to PO and cannot silently change downstream.
- The PO shows supplier, article, purchase unit, quantity, price and destination.

### A5. Receipt and inspection into Main Store

Log in as **Sarah Akello** and receive the full PO.

| Field | Value |
|---|---|
| Delivery note | NHS-DN-0803-01 |
| Supplier invoice reference | NHS-INV-0803-01 |
| Received | 3 drums / 60 L |
| Accepted | 3 drums / 60 L |
| Rejected | 0 |
| Batch | DET-AUG26-01 |
| Expiry | 2027-08-31 |
| Destination | Main Store, inherited |

Expected:

- GRN and inspection references are generated.
- Main Store stock increases by 60 L.
- Stock ledger shows a receipt tied to the GRN.
- The PO becomes received (or the correct completed receipt status).
- Destination remains Main Store on PR, PO, GRN and inspection.

### A6. Pick and issue to Housekeeping

Return to the approved Housekeeping request and issue **50 L**.

| Field | Value |
|---|---|
| Issued quantity | 50 L |
| Receiver | Amina Nansubuga |
| Handover note | Issued for August deep-cleaning programme |

Expected:

- Main Store reduces by 50 L; 10 L remains from this receipt if there was no opening stock.
- Requested = 60 L, approved = 50 L, issued = 50 L remain independently visible.
- Stock ledger links the issue voucher to the request.
- Request reaches Completed/Issued as defined by the workflow.

### A7. Department return

Return **5 L** unused detergent to Main Store.

Expected: a store-return document is created, Main Store increases by 5 L, and the stock movement report shows both issue and return.

## 9. Scenario B — Direct-to-workspace procurement

Business story: new towels are an immediate room-opening requirement. They must be inspected at receipt but delivered directly to the **Housekeeping Linen Room**, bypassing Main Store.

Create a requisition:

| Field | Value |
|---|---|
| Department | Housekeeping |
| Required by | 2026-08-10 |
| Justification | Replace condemned guest towels before room reopening |
| Article | Premium White Bath Towel |
| Quantity | 4 cartons = 40 pieces |
| Destination type | Workspace |
| Destination department | Housekeeping |
| Workspace | Housekeeping Linen Room |
| Destination justification | Linen issued immediately to operational linen room |
| Supplier | Nile Hospitality Supplies |
| Catalogue price | UGX 180,000/carton |
| Expected subtotal | UGX 720,000 |

Approve it and create the PO. Receive all 40 pieces using delivery note `NHS-DN-0803-02`; accept all 40. Record **Grace Namusoke** or another authorised Housekeeping receiver as the workspace recipient.

Expected:

- The destination is selected at requisition line level and is visible on PR, PO, GRN and inspection.
- Main Store stock for towels does **not** increase.
- The receipt identifies Housekeeping Linen Room and the person who accepted custody.
- The Direct-to-Workspace Report shows 40 pieces, value UGX 720,000, supplier, department and recipient.

Negative check: try changing the GRN destination to Main Store. The system should block a downstream route change or require a controlled upstream amendment.

## 10. Scenario C — Partial and rejected delivery

Create and approve a Maintenance requisition for **5 cartons (100 pieces) of LED Bulb 12W**, destination **Engineering Store**.

| Field | Value |
|---|---|
| Supplier | BrightSpark Electricals |
| Unit price | UGX 240,000/carton |
| PO value | UGX 1,200,000 |
| Delivery note | BSE-DN-0803-01 |
| Received | 90 pieces |
| Accepted | 85 pieces |
| Rejected | 5 pieces |
| Rejection reason | Five bulbs cracked in transit |

Expected:

- PO remains partially received with 10 pieces outstanding.
- Only 85 accepted pieces enter Engineering Store stock.
- A supplier return can be created for the 5 rejected pieces.
- Exception Report shows partial/overdue quantity when applicable and rejected delivery.
- No invoice should be approved for 100 pieces when only 85 have been accepted.

## 11. Scenario D — Finance: invoice, match and payment

Use the fully received detergent PO from Scenario A.

### D1. Finance setup

Create:

| Setup | Value |
|---|---|
| Payment method | Bank Transfer |
| Description | Electronic supplier settlement |
| Bank account name | Lakeview Operations Account |
| Bank | UAT Commercial Bank |
| Account number | UAT-001-2026 |
| Opening balance | UGX 10,000,000 |

### D2. Register and match invoice

| Field | Value |
|---|---|
| Received LPO | Detergent PO from Scenario A |
| Invoice number | NHS-INV-0803-01 |
| Invoice date | 2026-08-03 |
| Due date | 2026-09-02 |
| Subtotal | UGX 420,000 |
| Tax | UGX 0 |

Perform three-way match and approve for payment.

Expected: PO quantity/value, accepted GRN quantity/value and invoice value agree; match succeeds and approval trail identifies the approver.

### D3. Negative invoice mismatch

For the bulb PO, register a test invoice using the full PO value **UGX 1,200,000** before the remaining goods are accepted. Perform matching.

Expected: mismatch is visible and approval for payment is blocked. Confirm it appears in Exception Report. Do not post payment for this invoice.

### D4. Supplier payment

For the approved detergent invoice:

| Field | Value |
|---|---|
| Amount | UGX 420,000 |
| Payment date | 2026-08-03 |
| Method | Bank Transfer |
| Bank account | Lakeview Operations Account |
| Reference | UAT-PAY-0803-001 |

Create the draft, then post it.

Expected: invoice balance becomes zero/paid, payment becomes posted, and the same user cannot bypass any configured approval control.

### D5. Operating expense and bank transaction

Record an expense:

| Field | Value |
|---|---|
| Category | Emergency transport |
| Store/property | Main Store |
| Amount | UGX 85,000 |
| Payment method | Bank Transfer |
| Reference | UAT-EXP-0803-001 |
| Description | Emergency transport for supplier quality inspection |

Record a bank withdrawal/transaction for UGX 420,000 with reference `UAT-BANK-0803-001`. Confirm the records are visible only to authorised users.

## 12. Scenario E — Stock control tests

### E1. Reorder rule

For detergent in Main Store:

| Minimum | Reorder quantity | Preferred supplier |
|---:|---:|---|
| 20 L | 60 L | Nile Hospitality Supplies |

After Scenario A's issue and return, check whether the resulting balance correctly triggers or clears the low-stock condition.

### E2. Stock transfer

Transfer **10 LED bulbs** from Engineering Store to Main Store. Confirm the source decreases and destination increases with one linked transfer reference.

### E3. Stock adjustment

Attempt a **-2 bulb** damage adjustment with reason `Damaged during maintenance handling`.

Expected: adjustment requires authorisation according to role; ledger identifies user, reason and reference; negative stock is blocked.

### E4. Stock count

Count detergent in Main Store:

- System quantity: use the displayed balance.
- Counted quantity: enter one litre less than system quantity.
- Variance reason: `UAT measurement variance`.

Expected: variance is not silently posted; approval/audit is retained and Exception Report displays the variance.

## 13. Reports and audit verification

Use date range **2026-08-03 to 2026-08-10**, branch **Kampala Main Branch**, then verify:

| Report | Minimum expected evidence |
|---|---|
| Daily Crucial Activities | PR/PO/GRN/inspection, issue/return, invoice/payment and price update |
| Pending Actions | Outstanding bulb delivery, any unapproved count/adjustment, unmatched invoice |
| Exception Report | Rejected bulbs, invoice mismatch, count variance and overdue PO when date passes |
| User Activity | Actions grouped under Amina, Grace, Peter, Sarah, Daniel and Ruth |
| Stock Movement Control | Detergent receipt, issue and return; bulb receipt/transfer/adjustment/count |
| Approval Trail | Maker-checker sequence with comments and timestamps |
| Direct-to-Workspace | 40 towels delivered to Housekeeping Linen Room and named recipient |
| Supplier Price Changes | Rice 115,000 → 119,000 and approximately 3.48% increase |
| Management Summary | Counts/values for procurement, exceptions, direct consumption and large transactions |
| Stock Valuation | Accepted stock only; no rejected bulbs or direct-workspace towels in Main Store |
| Low Stock & Reorder | Detergent according to the configured 20 L threshold |
| Procurement Status | Full detergent/towel receipts and partial bulb receipt |

For every report:

1. View on screen.
2. Apply at least three relevant filters.
3. Export CSV and Excel.
4. Print/save PDF.
5. Click a row and confirm drill-down opens the original transaction or complete raw record.
6. Compare exported totals with the on-screen totals.

## 14. Search, usability and integrity checks

- Search suppliers by name, item and category.
- Filter supplier catalogue by supplier/article/category.
- Sort monetary and quantity columns numerically.
- Confirm Inter is used for normal UI and monospace only for IDs/references.
- Test at desktop width, tablet width and approximately 390px mobile width.
- Refresh after saving each major transaction and confirm data persists.
- Open the same document as two different roles and confirm role-appropriate actions.
- Attempt duplicate supplier invoice number and duplicate payment reference.
- Attempt receipt above PO quantity.
- Attempt issue above available/approved quantity.
- Attempt use of an inactive supplier catalogue row.
- Attempt deletion/edit of an approved or posted controlled record.
- Confirm validation messages explain what must be corrected.
- Confirm audit entries cannot be edited from the application.

## 15. Completion criteria

The UAT cycle passes only when:

- Both Store and Direct-to-Workspace routes remain visible and controlled end to end.
- Accepted store receipts change stock exactly once; direct-workspace receipts do not change store stock.
- Original, approved, received, accepted, rejected and issued quantities remain distinguishable.
- Catalogue price history is immutable and valid prices flow into purchasing.
- Maker-checker and role restrictions prevent self-approval and unauthorised posting.
- Three-way matching blocks mismatches.
- Every crucial action appears in audit/control reports with user, time and source reference.
- Screen, CSV/Excel and PDF totals agree.
- No critical defect, unexplained balance difference, or missing audit trail remains open.

