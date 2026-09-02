# Supplier Management Table + Detail Drawer

Date: 2 September 2026

## Scope

This change refactors only the Supplier Management user interface. It does not alter supplier registration rules, supplier quotation workflow, permissions, procurement approvals, LPO logic, or other business workflow logic.

## Implemented

- Replaced the split Supplier Explorer/profile layout with a full-width supplier table.
- Added KPI cards for active suppliers, pending/inactive quotation records, and flagged action items.
- Added supplier search and status filtering above the table.
- Added full-row click/keyboard interaction for opening supplier details.
- Added a responsive right-side supplier detail drawer:
  - 40% desktop width.
  - 60% width on tablet-sized screens.
  - Full width on mobile.
  - Backdrop overlay, Escape-to-close, click-outside-to-close, and independent drawer scrolling.
- Added drawer tabs:
  - Overview.
  - Items & Quotations.
  - Contact Details.
- Kept existing Edit Supplier, Add Quotation, Edit Quotation, All Quotations, and Register Supplier actions and permissions.
- Payment terms are no longer mixed with supplier email/contact information.
- Legacy values that look like payment methods (for example `Bank`) are shown as `Needs review` rather than being presented as valid payment terms.
- Supplier email is displayed under Contact Details.
- Added a compact supplied-items/quotation table with SKU, name, UOM, reference, quoted price, validity and status.
- Added responsive styling and reduced-motion support.

## Validation

Frontend TypeScript compilation and Vite production build completed successfully.
