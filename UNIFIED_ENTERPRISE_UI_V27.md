# Unified Enterprise UI/UX Pass

This release standardizes the authenticated Hotel ERP interface using the Supplier and Supplier Quotation explorer screens as the visual and interaction benchmark.

## Scope

- Unified page headers, cards, tables, filters, workspaces, drawers, status chips, empty states and action bars.
- Applied the master/detail explorer pattern where appropriate across Procurement, Stores, Finance, Receiving, Reports, HR, Access Management, master-data lists and role dashboards.
- Tightened spacing, typography, borders, radii and interaction states for a restrained enterprise look.
- Simplified several technical/developer-facing helper statements into normal operational wording.
- Added responsive behavior for the standardized workspaces and master/detail layouts.

## Preserved behavior

- Backend source is unchanged from the immediately preceding fixed release.
- Procurement, receiving, GRN, inventory, finance and approval workflows are unchanged.
- Existing API calls, permissions, calculations and state transitions are unchanged.
- Login screen source is unchanged byte-for-byte.
- GRN print-specific behavior is preserved through print overrides.

## Validation

- TypeScript/Vite production build completed successfully.
- Frontend production output was refreshed in both `frontend/dist` and root `dist`.
