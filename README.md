# Hotel Management System

Django + DRF backend and a Next.js App Router frontend for a hotel management ERP focused on
procurement, inventory, approvals, vendors, finance, reports, notifications, and audit logs.

The controlled operating model and implementation requirements for the connected procure-to-pay
and stores process are documented in
[CONNECTED_PROCUREMENT_STORES_IMPLEMENTATION_SPEC.md](CONNECTED_PROCUREMENT_STORES_IMPLEMENTATION_SPEC.md).

For a screen-by-screen Uganda demo and operator walkthrough, see
[PRESENTATION_GUIDE.md](PRESENTATION_GUIDE.md).

## Getting started

```bash
cd frontend
npm install
npm run dev        # start Next.js on http://localhost:3000
npm run typecheck  # strict TypeScript check
npm test           # focused frontend safety tests
npm run build      # tests + optimized production build
npm run start      # serve the production build
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

Start Next.js in another terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend calls `/api/v1/...`; Next.js proxies `/api` and `/media` to Django. Local development
defaults to `http://127.0.0.1:8000`. Set `BACKEND_ORIGIN=http://host:port` when Django runs
elsewhere. In production, `BACKEND_ORIGIN` is required. It is a server-side variable and must not
contain `/api/v1`.

The app starts on the **Login** screen and uses the existing DRF token-authentication flow. Use a
real account provisioned by Django; the frontend does not provide fallback business data.

## Railway deployment

The frontend service can stay rooted at `/frontend`. Configure `BACKEND_ORIGIN` with the Django
service origin so that the Next.js server can proxy same-origin `/api/v1/...` and `/media/...`
requests without exposing a private backend variable in browser code.

For the Django backend service, create/use a Railway service from the same repo with root directory
`/hotel_erp_backend`. The backend root includes `railway.json` and `requirements.txt` for Railway.
Set these variables on the backend service:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
DJANGO_SECRET_KEY=<strong random secret>
DJANGO_SETTINGS_MODULE=core.settings.prod
DJANGO_CSRF_TRUSTED_ORIGINS=https://<your-railway-domain>
DJANGO_SUPERUSER_USERNAME=admin2
DJANGO_SUPERUSER_PASSWORD=<strong initial admin password>
DJANGO_SUPERUSER_EMPLOYEE_CODE=EMP-ADMIN2
DJANGO_SUPERUSER_EMAIL=admin2@example.com
EMAIL_HOST=<smtp-provider-host>
EMAIL_PORT=587
EMAIL_HOST_USER=<smtp-login>
EMAIL_HOST_PASSWORD=<smtp-password-or-app-password>
EMAIL_USE_TLS=True
EMAIL_USE_SSL=False
DEFAULT_FROM_EMAIL=<verified-sender-address>
```

`DATABASE_URL` must be added to the **Django backend service**, not edited on the Postgres service:
open the backend service's **Variables** tab, choose **New Variable** -> **Add Reference**, and select
`Postgres.DATABASE_URL`. If the database service has a different name, Railway generates the
corresponding `${{ServiceName.DATABASE_URL}}` value for you. Deploy the staged changes afterward.

The backend reads this connection URL through `dj-database-url`, and the Railway start command runs
all Django migrations before Gunicorn starts. When `DJANGO_SUPERUSER_USERNAME` and
`DJANGO_SUPERUSER_PASSWORD` are set, the same command creates/updates that superuser during deploy.
You can then sign in with either the username or employee code.

The email variables belong on the Django backend service. They are required for sending approved
LPO PDFs to suppliers; the system does not mark an LPO as issued or start its lead-time clock until
the mail provider confirms delivery. Never commit the SMTP password to this repository.

### Add Uganda presentation data

The presentation seed builds a coherent, Uganda-based hotel story across procurement, approvals,
stores, inventory, finance, sales, suppliers, notifications, and audit history:

```bash
python manage.py seed_presentation_data \
  --settings=core.settings.prod \
  --hotel-name="Pearl of Africa Grand Hotel"
```

On Railway, run it in an SSH session to the backend service. On Vercel, link the
`hotel_erp_backend` directory to the backend project and run it with the production environment:

```bash
vercel env run -e production -- \
  .venv/bin/python manage.py seed_presentation_data \
  --settings=core.settings.prod \
  --hotel-name="Pearl of Africa Grand Hotel"
```

The command refuses to modify a populated database. Seeded staff password logins are disabled by
default; set `SEED_EMPLOYEE_PASSWORD` to a strong value of at least 12 characters if the role-based
demo accounts must sign in. The existing Django superuser remains available for a complete
presentation. Adding `--reset` intentionally deletes existing application data for that hotel, so
only use it after taking a database backup.

Set this server-side variable on the frontend service before building and running it:

```text
BACKEND_ORIGIN=https://<backend-domain>
```

`NEXT_PUBLIC_API_BASE_URL` is optional and should only be used when the browser intentionally calls
a public API base directly. The recommended deployment keeps it unset and uses the same-origin
proxy.

### Vercel backend migrations

The backend's [`vercel.json`](hotel_erp_backend/vercel.json) runs pending Django migrations,
refreshes the hotel role permissions, and executes Django's system check during every Vercel
production build. Vercel only promotes the new deployment when all three commands succeed, so
schema changes are applied before the matching backend starts serving production traffic.

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
- **Controlled LPO release**: value-routed maker-checker approval, revision tracking, and supplier
  issue only after final approval.
- **Controlled receiving**: explicit draft / inspected / posted / cancelled GRN lifecycle, accepted
  quantity posting, replacement receipt support for rejected goods, and immutable posted records.
- **Line-level invoice matching**: partial supplier invoices consume accepted GRN quantities by LPO
  line and cannot bill the same accepted quantity twice.
- **Reports**: report gallery + report viewer with filters, totals and PDF/Excel export buttons.
- Toast notifications for create / edit / delete / approval actions.

## Project structure

```
frontend/
  app/
    layout.tsx            Root metadata and enterprise style layers
    page.tsx              App Router entry point
    workspace/[section]/  Refresh-safe workspace route
    client-application.tsx Client boundary for the existing authenticated application
  next.config.mjs         Django API and media proxy
  package.json
  src/
    App.tsx               Root: applies theme vars, routes between top-level screens
    index.css             Global styles, fonts, icon helper, hover utilities
    enterprise-redesign.css Final responsive enterprise presentation layer
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
- The frontend hides actions the current role cannot use, while Django remains authoritative for
  authentication, branch/store scope, permissions, state transitions, and stock posting.
- Monetary values are stored in the prototype's base unit and rendered as UGX (`money()` in
  `lib/theme.ts`).
