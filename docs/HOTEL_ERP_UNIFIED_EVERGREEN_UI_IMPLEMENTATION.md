# Hotel ERP unified evergreen visual implementation

The five approved 1920 x 1080 concepts (application shell, procurement, receiving, Store Keeper, finance) are the shared design baseline.

## Implementation
- Final CSS layer imported after the old navy precision theme in the Next.js App Router layout.
- Evergreen #17382C, action green #176A49, muted gold #BD8F48, ivory #F7F8F5, white #FFFFFF, charcoal #1C2924.
- Reorganized header for property context, global search, notifications, role profile, page title and fiscal-period context.
- Shared role screens keep their real React/Django data sources, control actions, state and access checks.
- Corrected the Department Head stores route that was shadowed by the common supply role condition.
- Integrated frontend regression checks and responsive, keyboard, print and dark-mode styles.

## Required before client signoff
- Verify all ten roles against Django permissions at 1920/1440/1024/390 widths in the deployed staging app.
- Confirm blind receiving masks purchase prices and PO quantities; only Stores posts stock.
- Test Procurement, GRN, transfer, 3-way invoice matching, Finance approvals, audit and accounting periods with real data.
- Verify labels, overflow, empty/error/offline states and functional actions on every screen.
- CI does not replace a deployed browser visual acceptance audit. No backend accounting models are changed in this styling pass.
