# Hotel Management System

Django + DRF backend and React + Vite frontend for a hotel management ERP focused on
procurement, inventory, approvals, vendors, finance, reports, notifications, and audit logs.

## Getting started

```bash
cd frontend
npm install
npm run dev      # start the dev server (Vite)
npm run build    # type-check + production build
npm run preview  # preview the production build
```

## Run with the Django backend

Start Django in one terminal:

```bash
cd hotel_erp_backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements/dev.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

Start React in another terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend calls `/api/v1/...`; Vite proxies `/api` to `http://127.0.0.1:8000`.
Set `VITE_BACKEND_URL=http://host:port` if Django runs somewhere else, or set
`VITE_API_BASE_URL` if the API path itself is different.

The app starts on the **Login** screen — click **Sign in** (credentials are prefilled) to reach
the module **Launchpad**, then open **Stock Management**.

## Railway deployment

The frontend service can stay rooted at `/frontend`. In production the React app calls
`/api/v1/...` by default, so it expects the Django backend to be reachable on the same domain
under `/api/v1`.

For the Django backend service, create/use a Railway service from the same repo with root directory
`/hotel_erp_backend`. The backend root includes `railway.json` and `requirements.txt` for Railway.
Set these variables on the backend service:

```text
DJANGO_SECRET_KEY=<strong random secret>
DJANGO_SETTINGS_MODULE=core.settings.prod
DJANGO_CSRF_TRUSTED_ORIGINS=https://<your-railway-domain>
DJANGO_SUPERUSER_USERNAME=admin2
DJANGO_SUPERUSER_PASSWORD=123
DJANGO_SUPERUSER_EMPLOYEE_CODE=EMP-ADMIN2
DJANGO_SUPERUSER_EMAIL=admin2@example.com
```

Attach a Railway Postgres database if possible; the backend will use Railway's `DATABASE_URL`
automatically. When `DJANGO_SUPERUSER_USERNAME` and `DJANGO_SUPERUSER_PASSWORD` are set, Railway's
start command creates/updates that superuser during deploy. You can then sign in with either the
username or employee code.

If the backend gets a separate public URL instead of sharing the frontend domain, set this on the
frontend service before building:

```text
VITE_API_BASE_URL=https://<backend-domain>/api/v1
```

## What's implemented

- **Login** → **Launchpad** (module picker) → **App shell**
- **App shell**: collapsible-group sidebar with property switcher + user footer, and a header with
  breadcrumb, search, theme toggle, appearance popover (accent / theme / density) and notifications.
- **Dashboard**: Overview / Procurement / Inventory tabs, KPI cards with sparklines, procurement
  pipeline, recent activity, spend-by-category bars, PO status donut, and pending approvals.
- **List views** (config-driven): Items, Categories, Units of Measure, Store Locations, Stock
  Balances, Stock Ledgers, Inventory Batches, Requisitions, Approvals, Purchase Orders, Goods
  Receipts, Suppliers — with search, create/edit (slide-in drawer) and delete (confirm dialog).
- **Detail view**: requisition / purchase-order documents with line items, approval decision panel
  (approve / reject) and an activity timeline.
- **Reports**: report gallery + report viewer with filters, totals and PDF/Excel export buttons.
- Toast notifications for create / edit / delete / approval actions.

## Project structure

```
frontend/
  index.html
  package.json
  vite.config.ts
  src/
    App.tsx               Root: applies theme vars, routes between top-level screens
    main.tsx              Entry point + AppProvider
    index.css             Global styles, fonts, icon helper, hover utilities
    state/AppContext.tsx  All app state, routing and actions
    lib/
      api.ts              Backend API client + Django-to-frontend row mapper
      data.ts             Entity config, report definitions, helpers
      theme.ts            Theme variables, accent map, money() + status chip helpers
      reports.ts          Report table builder
    components/           Icon, Sidebar, Header, FormDrawer, ConfirmDialog, Toast
    screens/              Login, Launchpad, AppShell, Dashboard, ListView,
                          DetailView, Reports, ReportView
hotel_erp_backend/
  manage.py
  apps/
  core/
  tests/
```

## Notes

- Data syncs from Django when the backend is available. Empty backend tables render as empty
  frontend tables, so the UI can be used to verify the live API connection.
- In `core.settings.dev`, the API uses `AllowAny` so the prototype login can talk to Django
  during local development. Production settings keep the stricter permission configuration.
- Monetary values are stored in the prototype's base unit and rendered as UGX (`money()` in
  `lib/theme.ts`).
