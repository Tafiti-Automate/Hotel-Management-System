# Commercial ERP UX Refactor

Implemented in this package:

- Modern permission-aware global search and command palette (`Ctrl/Cmd + K`).
- Search across authorised workspaces and loaded records only.
- Streamlined dark-blue ERP navigation shell and breadcrumb header.
- Role-aware operational dashboards retained and integrated.
- Shared design tokens for spacing, radii, focus states and surfaces.
- Standard button, card, badge and page-heading patterns.
- Existing drawers, dialogs, toasts, status badges and workflow panels retained as the professional interaction model.
- Keyboard-accessible dialogs and visible focus states.
- Responsive header/search behaviour for tablets and mobile.
- Reduced-motion accessibility support.
- Eight-hour inactivity session policy retained from the commercial polish phase.

Validation:

- TypeScript project compilation passed.
- Vite production build passed.
- Vite reports a non-blocking bundle-size warning above 500 KB. Route-level code splitting is recommended as the next performance phase.
