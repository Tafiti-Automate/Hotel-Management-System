# Hotel Management System

Django + DRF backend scaffold for a hotel management system focused on procurement,
inventory, approvals, vendors, finance, reports, notifications, and audit logs.

## Backend layout

```text
hotel_erp_backend/
├── apps/
├── core/
├── tests/
├── media/
├── static/
├── manage.py
└── requirements/
```

## Quick start

```bash
cd hotel_erp_backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements/dev.txt
python manage.py migrate
python manage.py runserver
```

Primary API routes are available under `/api/v1/`, including:

- `/api/v1/vendors/`
- `/api/v1/items/`
- `/api/v1/requisitions/`
- `/api/v1/approvals/`
- `/api/v1/purchase-orders/`
- `/api/v1/grns/`
- `/api/v1/stores/`
- `/api/v1/inventory-balances/`
- `/api/v1/stock-transfers/`
- `/api/v1/stock-adjustments/`
- `/api/v1/store-requisitions/`
- `/api/v1/stock-issues/`
- `/api/v1/store-returns/`
- `/api/v1/stock-counts/`
- `/api/v1/reorder-rules/`
- `/api/v1/customers/`
- `/api/v1/sales/`
- `/api/v1/cashflows/`
- `/api/v1/reports/stock-summary/`
- `/api/v1/reports/low-stock/`
- `/api/v1/reports/expiry/`
- `/api/v1/reports/consumption/`
- `/api/v1/reports/procurement-summary/`
- `/api/v1/reports/stock-card/`

Workflow actions:

- `POST /api/v1/requisitions/{id}/submit/`
- `POST /api/v1/requisitions/{id}/cancel/`
- `POST /api/v1/approvals/{id}/approve/`
- `POST /api/v1/approvals/{id}/reject/`
- `POST /api/v1/grns/{id}/post-to-inventory/`
- `POST /api/v1/grn-items/{id}/post-to-inventory/`
- `POST /api/v1/store-requisitions/{id}/submit/`
- `POST /api/v1/store-requisitions/{id}/approve/`
- `POST /api/v1/store-requisitions/{id}/reject/`
- `POST /api/v1/stock-issues/{id}/apply/`
- `POST /api/v1/store-returns/{id}/apply/`
- `POST /api/v1/stock-counts/{id}/populate/`
- `POST /api/v1/stock-counts/{id}/submit/`
- `POST /api/v1/stock-counts/{id}/approve/`
- `POST /api/v1/stock-counts/{id}/apply/`
- `POST /api/v1/stock-transfers/{id}/apply/`
- `POST /api/v1/stock-adjustments/{id}/apply/`
- `POST /api/v1/supplier-returns/{id}/apply/`
- `POST /api/v1/sales/{id}/complete/`

Purchase requisitions support both department requisitions and hotel-level
purchase requisitions. Department requisitions require a requester and
department; hotel-level purchase requisitions can be raised for the hotel as a
whole and routed through approval stages before a purchase order is created.

Operational stock management includes department store requisitions, stock
issues, department returns, supplier returns, stock counts, reorder rules,
expiry reporting, consumption reporting, and stock valuation reporting.

Create or refresh the standard hotel roles with:

```bash
python manage.py setup_hotel_roles
```

The command creates groups such as System Administrator, General Manager,
Procurement Manager, Finance Controller, Stores Manager, Store Keeper,
Department Head, Receiving Officer, and Auditor.
