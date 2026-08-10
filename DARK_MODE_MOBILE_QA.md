# Dark Mode and Mobile Workflow QA

## Completed corrections

- Applies the saved theme before React starts, preventing the light flash after refresh.
- Persists the selected light/dark appearance through `hms_appearance`.
- Applies dark surfaces to the document, application root, form controls, date controls, authentication card, alerts, access-management statuses, disabled controls, scrollbars, and hotel-logo preview.
- Replaced the remaining light-only table-row hover with the design-system surface token.
- Replaced the tablet horizontal sidebar groups with a compact mobile header and off-canvas navigation drawer.
- Added a navigation backdrop, accessible menu labels, expanded state, and automatic closing after navigation.
- Made the application header sticky below the mobile navigation header.
- Improved narrow-screen search/header sizing.
- Made workbench hero actions full-width on phones.
- Increased touch targets for workflow actions.
- Made form actions sticky and easier to operate on phones.
- Reduced two-column KPI and workflow layouts to one column on very narrow screens.
- Improved mobile table label/value proportions and notification panel positioning.
- Added overscroll containment to mobile detail drawers.

## Viewports reviewed

- Desktop: 1440 × 900
- Tablet: 768 × 1024
- Mobile: 390 × 844
- Narrow mobile: 360 × 740

## Workflows covered by responsive rules

- Navigation and role menu
- Global search and header actions
- Store request and procurement workbenches
- Record lists and filter controls
- Requisition and inventory detail drawers
- Create/edit form drawers
- Approval and workflow buttons
- Notifications
- KPI cards, charts and dashboard grids
- Access-management dialogs

## Build validation

`npm run build` passed using TypeScript and Vite.

The remaining Vite warning concerns a JavaScript chunk slightly over 500 KB. It does not block deployment and is unrelated to dark-mode or mobile behavior.

## Live UAT still required

Visual rules and production compilation are verified in this package. Final live UAT should still use real role accounts and real backend data to verify long tables, unusually long supplier/article names, browser autofill, native date pickers, and device-specific keyboards.
