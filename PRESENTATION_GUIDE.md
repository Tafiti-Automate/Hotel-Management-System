# Hotel Management ERP — Step-by-Step Presentation Guide

This guide explains how to present and operate the Uganda demonstration environment for
**Pearl of Africa Grand Hotel**. It follows the menus and records currently available in the
production system.

Production frontend:
[https://hotel-management-system-five-livid.vercel.app](https://hotel-management-system-five-livid.vercel.app)

## 1. Before the presentation

1. Open the production frontend.
2. Sign in with the existing Django superadmin account.
3. If the screen was already open, press `Ctrl + Shift + R` to reload live data.
4. Confirm that the dashboard says **Live data**.
5. Use the property selector near the top of the sidebar to select the branch you want to show.
6. Keep the sidebar expanded so your audience can see the workflow sections.

Use the superadmin when you need to demonstrate the complete system. Use the role accounts below
when you want to demonstrate separation of duties. Their passwords are supplied privately and are
not stored in this repository.

### Role demonstration accounts

| Employee | Username / employee code | Role | Intended responsibilities |
|---|---|---|---|
| Alex Nankya | `anankya` / `EMP-004` | Store Keeper | Store requests, picking and issuing, department returns, stock counts and read-only stock visibility |
| Esther Nambasa | `esther.nambasa` / `UG-HQ-106` | Department Head | Department purchase requests, store requests and only the approval stages assigned to her |
| Grace Nakato | `grace.nakato` / `UG-HQ-101` | General Manager | Management dashboard, broad read-only oversight, assigned management approvals and controlled inventory decisions |
| Daniel Okello | `daniel.okello` / `UG-HQ-102` | Procurement Manager | Suppliers, quotations, LPOs, procurement documents and read-only visibility of received goods |

These are active role-only accounts. They are not Django staff users or superusers. A role may
review information needed for its work, but backend permissions block unrelated operations. For
example, the store keeper cannot access purchase orders, the department head cannot manage
suppliers, and the procurement manager cannot access supplier invoices or payments.

### Presentation safety

- View the completed records instead of editing or deleting them.
- Do not click **Approve**, **Reject**, **Post**, **Apply**, or **Cancel** merely to demonstrate a
  button. Those actions change production data.
- Completed documents cannot be posted twice; this is an intentional accounting control.
- Use the pending Food & Beverage request to explain the approval queue without deciding it.
- If you want to practise data entry, create a new clearly labelled test record and do not reuse a
  completed seeded document.

## 2. The business story you are presenting

Pearl of Africa Grand Hotel has a main operation in Kampala and a branch in Jinja. Kampala is
preparing for a corporate conference week. Housekeeping requests cleaning and administration
supplies, procurement obtains three quotations, management approves the request, a local purchase
order is issued, goods are inspected and received, finance performs a three-way match, and the
supplier is paid. Stock is then issued to departments and transferred between branches.

The main example contains:

| Area | Demonstration record |
|---|---|
| Hotel | Pearl of Africa Grand Hotel |
| Branches | Pearl of Africa Grand Hotel Kampala and Pearl of Africa Grand Hotel Jinja |
| Main stores | Main Warehouse, F&B Kitchen Store and Jinja Branch Store |
| Staff | 13 employees across management, procurement, finance, stores and departments |
| Main supplier | Kampala Hospitality Supplies Ltd |
| Purchase request | 20 litres of Mukwano liquid hand soap and 12 A4 paper reams |
| Quotations | Three competing Uganda-based supplier quotations |
| Delivery note | `KHS-DN-24071` |
| Supplier invoice | `KHS-INV-2026-0714` |
| Supplier payment | `STANBIC-EFT-260714-8841` |
| Supplier credit note | `KHS-CN-2026-0098` |
| Utility expense | `UMEME-2607-44821` for UGX 850,000 |
| Pending work | 40 kg of Kakira sugar for the weekend conference buffet |

## 3. Recommended 15–20 minute presentation

### Step 1 — Sign in and introduce access control

1. Sign in with the superadmin.
2. On **Select your workspace**, point out **Hotel Operations** and **Human Resources**.
3. Explain that available modules, menus, branches and actions depend on the employee's assigned
   role.
4. Open **Human Resources** first.

What to say:

> The system gives each employee only the functions required by their job. A department head,
> stores manager, procurement manager, finance controller and auditor see different workspaces.

### Step 2 — Show the hotel team

1. On **People overview**, show the employee and department totals.
2. Open **Employees** from the sidebar.
3. Search for names such as Grace Nakato, Daniel Okello, Ruth Namusoke or Samuel Kato.
4. Open one employee to show the employee code, department, branch and designation.
5. Open **Departments** and show Housekeeping, Food & Beverage, Front Office,
   Procurement & Stores, and Finance & Accounts.
6. Click **Switch module** at the bottom of the sidebar and open **Hotel Operations**.

What to say:

> Every transaction is tied to a real responsibility. Esther Nambasa requests housekeeping
> supplies, Daniel Okello manages sourcing, Mercy Akello receives goods, Samuel Kato controls
> stores, Ruth Namusoke controls payment, and Grace Nakato provides management approval.

### Step 3 — Explain the operations dashboard

1. Select **Pearl of Africa Grand Hotel Kampala** using the property selector.
2. Open **Dashboard**.
3. Confirm the green **Live data** indicator.
4. Explain the KPI cards:
   - pending purchase requests;
   - pending approvals;
   - low-stock articles;
   - near-expiry stock;
   - today's receipts;
   - inventory value.
5. Point out the **Purchase requests awaiting action**, **Low stock**, **Recent stock movements**
   and **Notifications** panels.

What to say:

> The dashboard is an exception screen. Management sees what requires action instead of searching
> through every transaction.

### Step 4 — Show the master data

1. Under **Inventory**, open **Articles**.
2. Search for:
   - Mukwano Liquid Hand Soap 5L;
   - A4 Printing Paper Ream;
   - Kakira White Sugar 1kg;
   - Rwenzori Mineral Water 500ml;
   - Coca Cola Soda 300ml;
   - Nile Special Beer 500ml.
3. Open **Categories** to explain article classification.
4. Open **Stock balances** to show stock by article and store.
5. Under **Partners & control**, open **Suppliers**.
6. Show Kampala Hospitality Supplies Ltd, Pearl Hospitality Traders Uganda, Mukwano Industries
   Uganda and Kakira Sugar Works.
7. Open **Supplier catalogue** to show supplier-specific prices and lead times.

What to say:

> Master data is entered once and reused throughout requisitions, quotations, receiving,
> inventory and finance. This prevents departments from typing different names for the same item.

### Step 5 — Follow the completed purchase request

1. Under **Procurement**, open **Purchase requisitions**.
2. Open the approved Housekeeping request whose reason mentions the Kampala corporate conference
   week.
3. Show its two lines:
   - 20 litres of hand soap at an estimated UGX 18,000;
   - 12 A4 paper reams at an estimated UGX 22,000.
4. Point out the department, requester, total, status and activity information.
5. Return to the list and open **Approvals**.
6. Explain the four approval stages:
   1. Department review;
   2. Procurement review;
   3. Finance review;
   4. General Manager approval.

What to say:

> A department cannot directly create an order or payment. The request must pass sequential,
> value-controlled approvals, and every decision becomes audit evidence.

### Step 6 — Show the pending approval

1. In **Purchase requisitions** or **Approvals**, open the Food & Beverage request.
2. Confirm that its reason mentions the weekend conference buffet and breakfast service.
3. Show the line for 40 kg of Kakira sugar at an estimated UGX 3,500 per kg.
4. Explain that department review is complete and procurement review is still pending.
5. Do not approve or reject it during a view-only presentation.

What to say:

> This is the live work queue. The system separates completed history from transactions that still
> require a responsible officer's decision.

### Step 7 — Follow sourcing and the LPO

1. Open **Procurement workbench**.
2. Use the numbered tabs across the top.
3. Open **2 — Quotation comparison**.
4. Show the three supplier quotations.
5. Explain that Kampala Hospitality Supplies Ltd won because of price, two-day delivery and local
   availability. Its evaluated score is 92/100.
6. Open **3 — LPO**.
7. Show the issued and supplier-acknowledged local purchase order.
8. Point out the receiving store, supplier, line quantities, costs and delivery instructions.

Quotation comparison:

| Supplier | Soap unit price | Paper unit price | Lead time |
|---|---:|---:|---:|
| Kampala Hospitality Supplies Ltd | UGX 17,500 | UGX 21,500 | 2 days |
| Pearl Hospitality Traders Uganda | UGX 17,000 | UGX 23,500 | 4 days |
| Mukwano Industries Uganda | UGX 18,000 | UGX 22,000 | 3 days |

What to say:

> The cheapest individual line does not automatically win. Procurement records a defensible
> evaluation of price, completeness, delivery time and availability.

### Step 8 — Show receiving, inspection and supplier return

1. In **Procurement workbench**, open **4 — Goods receipt**.
2. Open the GRN connected to delivery note `KHS-DN-24071`.
3. Confirm that it was received into Main Warehouse.
4. Open **5 — Inspection**.
5. Show that quantities, seals and product specifications were verified and the quantities were
   accepted.
6. Explain that only accepted goods can be posted into stock.
7. Open **6 — Supplier return**.
8. Show the return of one moisture-damaged paper ream.
9. Point out supplier credit note `KHS-CN-2026-0098`.

What to say:

> Delivery does not automatically increase stock. Receiving records what arrived, inspection
> determines what is acceptable, and posting updates inventory. Damaged goods leave through a
> controlled supplier return.

### Step 9 — Show stock movement and department consumption

1. Open **Stock ledger**.
2. Explain that it is the permanent history of stock entering and leaving each store.
3. Under **Stores**, open **Store requisitions**.
4. Open the Housekeeping request for daily room-turnover supplies.
5. Show the approved quantities:
   - 4 litres of hand soap;
   - 2 A4 paper reams.
6. Open **Stock issues** and show the posted issue voucher and department acknowledgement.
7. Open **Returns** and show the return of 0.5 litre of sealed unused soap.

What to say:

> Purchase stock belongs to the store until a department submits an approved request. The issue
> records who released it, who received it and which department carries the consumption cost.

### Step 10 — Show branch transfers, adjustment and count

1. Open **Transfers & counts**.
2. Select the **Transfers** tab.
3. Show the completed transfer of 24 Rwenzori water bottles from Main Warehouse to Jinja Branch
   Store.
4. Select **Adjustments** and show reference `ADJ-JJA-2026-004`, a verified positive adjustment of
   two bottles.
5. Select **Counts** and open the completed Jinja month-end count.
6. Show the one-bottle variance recorded as late-shift staff refreshment.
7. Select **Reorder** and show the A4 paper rule:
   - minimum level: 15;
   - reorder quantity: 30;
   - preferred supplier: Kampala Hospitality Supplies Ltd.
8. Change the property selector to **Pearl of Africa Grand Hotel Jinja** and show how the lists
   are scoped to that branch. Return to the Kampala property afterward.

What to say:

> A transfer has two controlled moments: dispatch reduces the source and destination receipt adds
> the stock. Adjustments and count differences require approval because they change the stock
> valuation without a normal purchase or issue.

### Step 11 — Show finance control

1. Under **Partners & control**, open **Finance**.
2. Open **Invoices & matching**.
3. Show invoice `KHS-INV-2026-0714`.
4. Explain the three-way match:
   - ordered quantity and cost from the LPO;
   - accepted quantity from the GRN and inspection;
   - amount claimed by the supplier invoice.
5. Open **Supplier payments** and show reference `STANBIC-EFT-260714-8841`.
6. Open **Expenses** and show the UGX 850,000 Kampala electricity expense,
   `UMEME-2607-44821`.
7. Open **Banking** and point out the supplier payment withdrawal, utility withdrawal, and daily
   card/mobile-money settlement.
8. Open **Payment methods** to show EFT, MTN Mobile Money and Visa/Mastercard.

What to say:

> Finance pays only an approved invoice that agrees with both the LPO and accepted delivery. The
> resulting payment, cash flow and bank transaction provide a connected financial trail.

### Step 12 — Show reporting and audit evidence

1. Open **Reports**.
2. Generate:
   - Stock Valuation;
   - Low Stock & Reorder;
   - Stock Movement;
   - Requisition Summary;
   - Purchase Order Summary;
   - Goods Receipt Report;
   - Supplier Performance.
3. Explain the filters and export/print controls where available.
4. Open **Audit log**.
5. Show the recorded requisition approval, LPO issue, GRN posting, Kampala-to-Jinja transfer and
   completed sale audit entries.

What to say:

> Reports explain the current position; the audit log explains how the system reached that
> position and who performed each controlled action.

### Step 13 — Close the presentation

Return to **Dashboard** and summarise:

> The system connects people, approvals, procurement, receiving, inventory, departmental use,
> finance, reporting and audit history. Each step produces the controlled input required by the
> next step, reducing unauthorized purchases, stock losses and unsupported payments.

## 4. How to process a new procurement transaction

Use this sequence when entering a new transaction rather than viewing the seeded example:

1. **Purchase requisitions → New requisition**
   - choose type, department, requester, preferred supplier and expected date;
   - enter a clear business reason;
   - save the header.
2. **Procurement workbench → Requisition lines**
   - select the draft requisition;
   - choose an article;
   - enter quantity and estimated unit cost;
   - add every required line;
   - click **Submit requisition**.
3. **Approvals**
   - the assigned approver checks purpose, quantities, prices and budget;
   - approve with a useful comment or reject with a reason;
   - repeat until all configured stages are complete.
4. **Procurement workbench → Quotation comparison**
   - create a quotation for each supplier;
   - add every requested article and supplier price;
   - record commercial terms, delivery time, validity, score and evaluation notes;
   - select one complete quotation as the winner.
5. **Procurement workbench → LPO**
   - select the approved requisition;
   - choose supplier, ordered-by employee and receiving store;
   - generate the draft LPO;
   - verify quantities and unit costs;
   - issue the LPO and record supplier acknowledgement.
6. **Procurement workbench → Goods receipt**
   - select the issued LPO;
   - choose receiving officer and date;
   - enter the supplier delivery-note number;
   - create the GRN and add delivered lines.
7. **Procurement workbench → Inspection**
   - open an inspection against the GRN;
   - record received, accepted and rejected quantities;
   - complete the inspection.
8. **Goods receipt**
   - post the accepted GRN lines to inventory.
9. **Finance → Invoices & matching**
   - register the supplier invoice against the received LPO;
   - perform the three-way match;
   - approve the matched invoice for payment.
10. **Finance → Supplier payments**
    - create a payment with method, bank account and reference;
    - post the payment.
11. **Reports and Audit log**
    - verify the stock, payable, payment and audit effects.

Do not skip stages. If a button is disabled, select the required record and complete the preceding
stage rather than trying to bypass the control.

## 5. How to issue stock to a department

1. **Store requisitions → New store requisition**
   - choose department, store, requester, required date and purpose.
2. **Transfers & counts → Requests**
   - select the draft request;
   - add article lines and requested quantities;
   - submit it.
3. The stores manager reviews available stock and enters approved quantities.
4. Click **Approve / reserve decided quantities**.
5. **Transfers & counts → Issues**
   - select the approved request;
   - create an issue voucher;
   - add pick quantities;
   - post the issue;
   - record the receiving employee or receiver name;
   - acknowledge department receipt.
6. Review the result in **Stock balances**, **Stock ledger** and the consumption reports.

## 6. How to transfer or correct stock

### Inter-store transfer

1. Open **Transfers & counts → Transfers**.
2. Choose source store, destination store and requesting employee.
3. Create the transfer and add article quantities.
4. Approve the transfer.
5. Dispatch from the source store.
6. Confirm receipt at the destination store.

### Stock adjustment

1. Open **Transfers & counts → Adjustments**.
2. Enter store, reference and a specific reason.
3. Add signed quantities: positive to increase, negative to decrease.
4. Submit, approve and apply the adjustment.

### Stock count

1. Open **Transfers & counts → Counts**.
2. Select store and person conducting the count.
3. Open the count and populate the system count sheet.
4. Enter physical quantities.
5. Submit the count.
6. A responsible manager approves the variance.
7. Apply the approved variance.

## 7. Status guide

| Status | Meaning |
|---|---|
| Draft | The document can still be edited and has not entered the control workflow |
| Submitted/Pending | It is waiting for review or approval |
| Approved | Required approval has been granted |
| Issued | An LPO or stock document has been formally released |
| In transit | Stock left the source store but has not reached the destination |
| Received | Delivery or transfer receipt has been recorded |
| Inspected | Received quantities have been accepted or rejected |
| Posted/Applied | Inventory or accounting balances have been changed |
| Matched | LPO, accepted GRN and supplier invoice agree |
| Paid | The approved financial obligation has been settled |
| Rejected/Cancelled | The workflow stopped and should not continue |

## 8. Current scope

The active frontend workspaces are Hotel Operations and Human Resources. Finance functions related
to procurement, expenses and banking are available inside Hotel Operations.

Front Office and Restaurant/POS appear as **Planned** workspaces. The presentation database
contains two backend sales examples so inventory and banking history is realistic, but there is not
yet a dedicated sales/POS screen in the current frontend. Do not claim that reservations, check-in,
restaurant ordering or POS are already active.

## 9. Quick troubleshooting

- **Connection unavailable:** refresh the page; confirm the backend health URL and frontend API
  environment are still configured.
- **Empty list:** confirm the correct branch in the property selector, clear search filters and
  press the page refresh button.
- **Button disabled:** select the document required by that panel and check that the preceding
  workflow stage is complete.
- **Operation blocked:** read the displayed requirement; the backend is preventing an invalid
  sequence, duplicate posting or insufficient stock.
- **Data looks old:** sign out, sign in again and press `Ctrl + Shift + R`.
- **Cannot see a menu:** the signed-in role does not have access to that function.
