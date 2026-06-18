# Hotel Management ERP — Frontend

Implementation of the **Stock Management** module for a Hotel Management ERP. React + Vite +
TypeScript, with a CSS-variable theming system (light/dark, 6 accent colors, airy/compact density)
ported from the original design prototype.

## Getting started

```bash
npm install
npm run dev      # start the dev server (Vite)
npm run build    # type-check + production build
npm run preview  # preview the production build
```

The app starts on the **Login** screen — click **Sign in** (credentials are prefilled) to reach
the module **Launchpad**, then open **Stock Management**.

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
src/
  App.tsx               Root: applies theme vars, routes between top-level screens
  main.tsx              Entry point + AppProvider
  index.css             Global styles, fonts, icon helper, hover utilities
  state/AppContext.tsx  All app state, routing and actions
  lib/
    data.ts             Seed data, entity config, report definitions, helpers
    theme.ts            Theme variables, accent map, money() + status chip helpers
    reports.ts          Report table builder
  components/           Icon, Sidebar, Header, FormDrawer, ConfirmDialog, Toast
  screens/              Login, Launchpad, AppShell, Dashboard, ListView,
                        DetailView, Reports, ReportView
```

## Notes

- Data is in-memory (seeded from the prototype); create / edit / delete and approvals mutate it
  for the session and reset on reload. Swap `lib/data.ts` + the actions in `state/AppContext.tsx`
  for a real API when wiring up a backend.
- Monetary values are stored in the prototype's base unit and rendered as UGX (`money()` in
  `lib/theme.ts`).
