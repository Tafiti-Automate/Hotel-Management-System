# Connected Procurement, Receiving, Stores, and Finance

## Implementation specification

### 1. Objective

The system must preserve one auditable document chain from an operational need to supplier
payment and departmental consumption:

```text
Department need
  -> Store request when stock is expected to exist
  -> Purchase requisition for an approved shortage/non-stock requirement
  -> Sourcing and quotation evaluation
  -> Approved purchase order (LPO)
  -> Physical receipt and inspection
  -> Posted GRN or service entry
  -> Available inventory/direct consumption/fixed asset
  -> Supplier invoice match
  -> Approved supplier payment
```

Procurement, Receiving, Stores, Departments, and Finance remain separate workspaces. They share
document references and transaction lines; they do not maintain disconnected copies of the same
facts.

### 2. Non-negotiable controls

1. Requester, request approver, buyer, LPO approver, receiver, invoice approver, and payment
   approver are independently assigned. A user cannot decide a document they created or own.
2. A Store Request is checked against available stock before it creates a Purchase Requisition.
3. An LPO can only contain approved requisition lines and cannot exceed their remaining approved
   base-unit quantities.
4. An LPO must pass its configured value-based approval route before it can be issued.
5. Editing a commercially material field after approval creates a new revision and requires
   reapproval.
6. An LPO never changes stock. Only accepted quantities on a posted GRN change stock.
7. Received, accepted, rejected, quarantined, returned, and invoiced quantities are distinct.
8. Posted stock and finance transactions are immutable. Corrections use linked reversals, returns,
   debit/credit notes, or cancellation entries.
9. Supplier payment requires an approved match or a separately authorized exception.
10. All decisions record the actor, timestamp, reason, previous status, and new status.

### 3. Responsibility matrix

| Stage | Responsible | Approver/reviewer | Key restriction |
| --- | --- | --- | --- |
| Identify need | Department requester/supervisor | Department Head | Procurement cannot invent operational demand |
| Check stock | Storekeeper/Inventory Controller | Stores Manager | Use available, reserved, quarantined, and on-order quantities |
| Purchase Requisition | Department or controlled shortage process | Configured approval matrix | Creator cannot approve |
| RFQ and quotation capture | Procurement Officer | Procurement Manager | Quotations remain supplier-specific and comparable by line |
| Supplier award | Procurement Officer recommendation | Procurement Manager/committee | Written reason; quotation waiver for allowed exceptions |
| LPO preparation | Procurement Officer | Configured LPO approval matrix | Buyer cannot approve own LPO |
| Physical receipt | Receiving Clerk | Stores Supervisor | Cannot alter LPO price or ordered quantity |
| Technical inspection | Requesting/technical department | Department Head where required | Inspector cannot increase delivered quantity |
| GRN posting | Authorized receiving/stores role | Stores Supervisor where policy requires | Only accepted quantities post |
| Invoice entry | Accounts Payable | Finance Controller | Duplicate supplier invoice is blocked |
| Match exception | Accounts Payable investigation | Finance Controller/authorized manager | Receiver cannot edit GRN to force a match |
| Payment preparation | Accounts Payable | Authorized payment approver | Payment cannot exceed approved balance |
| Stock adjustment/count | Stores/count team | Independent Stores/Finance approver | Counter/preparer cannot approve own variance |

### 4. Required document relationships

Relationships are line-based rather than a single linear header foreign key:

- A Purchase Requisition contains one or more approved requisition lines.
- A Purchase Order Line references its originating Requisition Line.
- One Purchase Requisition can be split across multiple LPOs and suppliers.
- A future consolidated LPO may contain lines from multiple approved requisitions for the same
  legal entity, currency, supplier, and delivery context.
- A GRN contains one or more receipt lines, each referencing one LPO line.
- One LPO line can be received through multiple GRNs.
- An inspection line references one GRN line and records accepted and rejected base quantities.
- A Supplier Invoice contains invoice lines referencing LPO lines and, when allocated, accepted GRN
  lines.
- One LPO can have multiple partial invoices; one invoice may cover multiple accepted receipts.
- Supplier returns and credit notes reduce the quantities/values eligible for payment.

Document numbers are human-readable identifiers. UUID primary keys remain the system identifiers.

### 5. State machines

#### Purchase Requisition

```text
Draft -> Submitted -> Approval stages -> Approved
                    -> Returned -> Submitted
                    -> Rejected
Approved -> Partially ordered -> Fully ordered -> Partially received -> Fulfilled -> Closed
Any unposted eligible state -> Cancelled
```

#### Purchase Order / LPO

```text
Draft -> Pending approval -> Approved -> Issued -> Partially received -> Received
          |                   |
          -> Rejected --------> Revised draft -> Pending approval
Draft/Rejected/Approved (before issue) -> Cancelled
```

Commercially material changes are supplier, source line, item, unit, quantity, unit price, tax,
currency, payment terms, delivery destination, and delivery terms.

#### GRN

```text
Draft -> Inspection pending -> Accepted/Partially accepted/Rejected -> Posted
Draft or rejected, if unused -> Cancelled
Posted -> Reversal document only
```

Physical receipt may be recorded before acceptance. Stock becomes available only when accepted
quantities are posted. If quarantine is enabled, the posting first targets a quarantine stock
status/location and a release transaction moves it to available stock.

#### Supplier invoice

```text
Draft -> Matched or Match exception -> Approved for payment
Approved -> Partially paid -> Paid
Eligible unposted state -> Cancelled
```

### 6. Quantity definitions

Every transactional line stores its entered unit and immutable base-unit conversion used at the
time of posting.

```text
On hand       = all physically posted stock in the location
Reserved      = approved but not yet issued Store Request quantity
Quarantined   = posted stock unavailable until quality release
Available     = On hand - Reserved - Quarantined
On order      = approved/issued LPO quantity - net accepted quantity
Net accepted  = accepted receipts - supplier returns/reversals
Invoiceable   = net accepted quantity - previously matched invoice quantity
```

No operational posting may create negative on-hand, reserved, batch, or invoiceable quantity.

### 7. Receipt and inspection rules

- Receiving captures supplier delivery note, arrival date/time, receiver, packaging/condition, and
  actual quantity.
- Expiry-controlled items require batch/lot and expiry data before posting.
- Serial-controlled items require unique serials before posting.
- Temperature-controlled items capture required and actual temperature plus the decision.
- Accepted plus rejected quantity must equal the inspected quantity before inspection is complete.
- Replacement goods for rejected quantities remain receivable against the original LPO.
- Over-receipt is blocked by default. A configured tolerance requires an explicit authorized
  override and never silently changes the LPO.
- Direct-to-department goods record departmental receipt/consumption and never create central-store
  stock.
- Services use a Service Entry/Completion Certificate rather than a stock GRN.

### 8. Invoice matching

Matching is performed by invoice line and then summarized on the invoice header.

For stocked goods and direct-delivery goods, validate:

- supplier and currency equal the LPO;
- invoiced cumulative quantity does not exceed net accepted quantity;
- invoice unit price/amount is within configured LPO tolerance;
- invoice tax is consistent with the LPO/item tax treatment;
- the supplier invoice number is unique after normalization;
- the same GRN allocation is not billed twice.

Services use LPO + accepted Service Entry + Invoice. Explicitly authorized categories may use a
two-way LPO + Invoice match. Non-PO invoices are exceptions with their own approval route.

### 9. Budget and accounting events

The target accounting flow is:

| Event | Budget/accounting effect |
| --- | --- |
| PR submission/approval | Availability check; optional pre-commitment |
| LPO approval | Commitment/encumbrance |
| GRN posting | Inventory/direct expense/asset received and goods-received-not-invoiced |
| Invoice approval | Clear received-not-invoiced and create Accounts Payable |
| Supplier payment | Clear Accounts Payable and reduce bank/cash |
| LPO cancellation/closure | Release unused commitment |

Budget is scoped by hotel, branch, department/cost centre, account/category, fiscal period, and
optional project. Amounts cannot be committed into a closed financial period.

### 10. Inventory integrity

- Each hotel/branch has a hierarchy of stores, zones, racks, shelves, and bins where required.
- Transfers between separately accountable stores use `Pending -> In transit -> Completed`.
- FEFO is mandatory for expiry-tracked items; FIFO is the fallback for other batched stock.
- Inventory valuation method is configured per hotel and cannot change within an open period
  without controlled revaluation.
- Stock Ledger rows are append-only and reference their source document and line.
- Period locks prevent backdated operational changes to closed inventory/accounting periods.
- Returned department goods require a condition decision. Unsafe food, opened chemicals, or
  otherwise unsuitable goods go to quarantine/wastage rather than available stock.

### 11. Supplier controls

- Supplier creation and activation are separate decisions.
- Tax identifiers, registration identifiers, and normalized invoice numbers are unique.
- Supplier bank details are versioned and require maker-checker verification.
- Single-source, emergency, and quotation-waiver purchases require a reason, attachment, approver,
  and exception report.
- Quotation comparison normalizes unit conversions, tax, freight, discounts, currency, delivery,
  warranty, and specification compliance.

### 12. API and concurrency requirements

- Workflow transitions use dedicated transactional endpoints; clients cannot set protected status
  fields directly.
- Posting methods lock the document, relevant balances, reservations, batches, and invoice
  allocations with database row locks.
- Retried requests are idempotent: a posted document cannot post twice.
- List APIs may filter by hotel, branch, department, store, supplier, status, and date while
  respecting role scope.
- Readiness endpoints return blockers and warnings before submit, approve, issue, post, match, and
  pay actions.
- API errors explain the corrective action without exposing internal exceptions.

### 13. UI requirements

Every purchasing record provides a connected timeline with links to:

```text
Store Request -> PR -> approvals -> quotations -> award -> LPO approvals -> LPO
-> deliveries -> inspections -> GRNs -> returns -> invoice matches -> payments
```

Role work queues show only actionable records. Buttons are displayed from server-returned readiness
and permission state, not inferred solely from labels. Quantity cards always distinguish ordered,
delivered, accepted, rejected, posted, returned, invoiced, and outstanding values.

### 14. Delivery phases

1. **Control core:** line traceability, PR approval, LPO approval, immutable LPO/GRN lines, accepted
   receipt posting, stock reservations/issues, and append-only ledgers.
2. **Financial control:** invoice lines, partial three-way matching, match exceptions, payments,
   supplier returns, and credit notes.
3. **Planning and accounting:** budgets, commitments, service entries, fixed assets, period locks,
   and general-ledger postings.
4. **Advanced hotel control:** recipes/production, expected versus actual usage, occupancy-driven
   planning, barcode/serial workflows, supplier scoring, and analytical dashboards.

### 15. Minimum acceptance scenarios

The release is not complete until automated tests prove at least the following:

1. A requester cannot approve their own PR.
2. A buyer cannot approve or issue their own unapproved LPO.
3. LPO quantities cannot exceed the remaining approved requisition quantities.
4. Two suppliers can fulfil separate lines/quantities from one PR with full traceability.
5. A rejected delivered quantity can be replaced without exceeding the accepted LPO quantity.
6. Draft, rejected, and cancelled GRNs do not change stock.
7. Posting a partially accepted GRN increases stock only by accepted quantity.
8. Retrying the same GRN/issue/transfer/payment posting does not duplicate a transaction.
9. Two partial supplier invoices can match separate accepted quantities on one LPO.
10. Cumulative invoiced quantity above net accepted quantity is blocked.
11. A transfer remains unavailable at the destination until the destination confirms receipt.
12. A stock count cannot reduce on-hand below active reservations.
13. Closed-period and posted-document edits are blocked and corrected by reversal.
14. Payment cannot exceed the approved invoice balance.
15. The document timeline identifies every actor, decision, exception, and posting.
