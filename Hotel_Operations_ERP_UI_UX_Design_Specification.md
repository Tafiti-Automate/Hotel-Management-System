# Hotel Operations ERP Target UI/UX Design Specification

> **Document classification: TARGET STATE / PROPOSED DESIGN**
>
> This document describes the desired user experience. It is not evidence that
> a capability is implemented, connected to an API, permitted for a role, or
> verified in production. Some target capabilities overlap with the current
> application, but that overlap must be confirmed in the companion documents.

Companion documents:

- [Current UI/UX Behaviour](CURRENT_UI_UX_BEHAVIOR.md) — evidence-backed behaviour found in the repository.
- [UI/UX Gap Register](UI_UX_GAP_REGISTER.md) — implementation status, evidence, gaps, decisions and priorities.

## Reading Rules

- Every item below is a target unless the gap register explicitly marks it `VERIFIED`.
- `IMPLEMENTED–UNVERIFIED` means code exists, but the complete deployed workflow has not been live-tested.
- Proposed actions must not be exposed merely because a button can be drawn; the API status guard and role permission must also exist.
- Database statuses and role permissions in the current-behaviour document take precedence over simplified examples in this target document.
- A capability may move to `VERIFIED` only after screen, API, database, permission and live-behaviour evidence are recorded.

## System Layout

``` text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Logo     Global Search                    🔔 Notifications     👤 User Menu │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ Dashboard │ Procurement │ Inventory │ Finance │ HR │ Reports │ Settings      │
│                                                                              │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ Context Menu  │                                                              │
│               │                     Main Workspace                           │
│               │                                                              │
│ Quick Tasks   │                                                              │
│ Recent        │                                                              │
│ Favorites     │                                                              │
│               │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

## Launchpad

Instead of taking users directly to a menu, show them an application
launcher.

``` text
HOTEL OPERATIONS ERP

Welcome back John

□ Procurement
□ Inventory
□ Finance
□ Human Resources
□ Reports
□ Administration

Recent
- Purchase Requisition PR0045
- Goods Receipt GRN0032
- Supplier Invoice INV0018

My Tasks
- 12 Pending Approvals
- 4 Low Stock Alerts
- 2 Goods Waiting Inspection
```

This immediately tells the user what needs attention.

# Role-Based Dashboards

## Procurement Manager

-   Pending PRs: 25
-   Pending Quotations: 8
-   Pending Purchase Orders: 4
-   Suppliers Awaiting Response: 3
-   Monthly Spend: UGX 142,000,000

### Quick Actions

-   Purchase Requisition
-   Create Quotation
-   Generate Purchase Order

### Workflow

Submitted → Approvals → Quotations → Award → Purchase Order → Delivery

## Stores Dashboard

-   Stock Value: UGX 823,000,000
-   Today's Receipts: 12
-   Today's Issues: 27
-   Transfers: 4
-   Returns: 2

### Alerts

-   Low Stock
-   Near Expiry
-   Negative Stock
-   Pending Reservations

### Quick Actions

-   Receive Goods
-   Issue Stock
-   Transfer Stock
-   Stock Count

## Finance Dashboard

-   Invoices Awaiting Match: 15
-   Payments Due: 9
-   Outstanding Supplier Balance: UGX 54,000,000
-   Today's Payments: UGX 12,500,000

### Quick Actions

-   New Invoice
-   New Payment
-   Expense

# Navigation

``` text
Inventory
├── Operations
│   ├── Store Requests
│   ├── Issues
│   ├── Returns
│   ├── Transfers
│   └── Receiving
├── Stock
│   ├── Items
│   ├── Balances
│   ├── Batches
│   └── Ledger
├── Control
│   ├── Adjustments
│   ├── Stock Counts
│   ├── Reorder Rules
│   └── Consumption
└── Reports
    ├── Stock Valuation
    ├── Movement
    ├── Consumption
    └── Low Stock
```

# Procurement Workbench

-   Purchase Requisitions
-   Purchase Orders
-   Goods Receipts
-   Supplier Returns
-   Quotations
-   Suppliers

Statuses: Draft → Submitted → Pending Approval → Approved → Ordered →
Received → Completed

Filters: - Branch - Department - Supplier - Date - Status

Table Columns: Reference \| Requester \| Department \| Amount \| Status
\| Actions

# Workflow Visualization

Need → Purchase Request → Approval → Quotation → Award → Purchase Order
→ Delivery → Goods Receipt → Inspection → Inventory → Invoice → Payment
→ Completed

# Purchase Requisition Wizard

1.  Request Type, Department, Reason, Required Date
2.  Search Item, Quantity, Estimated Cost, Supplier Preference
3.  Review, Approval Route, Estimated Total
4.  Submit

# Smart Tables

Reference Card: - PR-2026-0045 - Department: Housekeeping - Requester:
John - Status: Approved - Amount: UGX 1,000,000 - Created: Today

Actions: - View - Edit - Generate PO - History

# Document Page

Tabs: - Overview - Items - Workflow - History - Attachments - Comments -
Audit

Supporting Panels: - Details - Approval Timeline - Related Documents -
Activity Feed

# Notification Center

-   John approved PR0045
-   Supplier acknowledged PO0003
-   Invoice INV0012 matched
-   Stock below reorder level
-   Transfer completed
-   Goods received
-   Inspection pending

# Global Search

Search across: - PR - Employee - Item - Supplier - Invoice - GRN - Store
Request

# Color Standards

  Status        Color
  ------------- ------------
  Draft         Gray
  Submitted     Blue
  Pending       Orange
  Approved      Green
  In Progress   Purple
  Completed     Dark Green
  Returned      Yellow
  Rejected      Red
  Cancelled     Dark Gray

# UX Improvements

## Quick Create

-   Purchase Request
-   Store Request
-   Supplier
-   Invoice
-   Transfer

## Breadcrumbs

Home \> Procurement \> Purchase Requisitions \> PR0045

## Empty State

> No Purchase Orders yet.

**Create your first Purchase Order**

## Skeleton Loading

Use loading placeholders instead of spinners.

## Confirmation Dialog

Delete Purchase Order PO0045?

This action cannot be undone.

Buttons: - Cancel - Delete

## Inline Validation

-   Quantity: ✓ Available
-   Supplier: ✓ Preferred supplier exists
-   Budget: ⚠ Budget almost exceeded

# Responsive Mobile

Display: - PR0045 - Housekeeping - UGX 1,000,000 - Submitted Yesterday -
Reason: Cleaning Supplies

Actions: - Approve - Return - Reject
