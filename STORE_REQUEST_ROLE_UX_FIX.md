# Store Request Role UX Fix

## Changes

- Removed the five-role workflow tutorial from the Store Requests page.
- Each role now receives a focused workspace:
  - Department requester: My Store Requests
  - Department Head: Store Request Approvals
  - Stores Manager: Stock Review, Shortages and Ready to Issue
  - Store Keeper: Pick and Issue
- Replaced the numbered saved-draft tutorial with a compact request editor.
- A requester now clicks New Request, saves request details, adds articles and submits.
- The item editor only appears after a draft exists.
- Request lists show requested article summaries and quantities.
- Added search, status, From date and To date filters.
- Record tables are filtered to the active role queue.
- Updated navigation terminology from Department supply & stores to Store Requests.
- Added a mobile one-column filter layout.

## Validation note

The source was inspected for the removed workflow text. A production npm build could not be executed in the container because the configured npm proxy returned 404 for yallist@3.1.1.
