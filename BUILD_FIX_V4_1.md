# Requester Requisition UI V4.1 — Vercel Build Fix

This patch addresses the TypeScript errors reported by the production frontend build in `src/screens/InventoryWorkbench.tsx`.

## Fixed

1. Removed the unused `data` parameter from `RequesterDraftEditor` to satisfy `noUnusedParameters` / TS6133.
2. Explicitly typed the UOM lookup as `Map<string, string>` so values rendered in JSX are guaranteed strings, resolving the two TS2322 `ReactNode` errors.

No procurement workflow or backend business rule was changed by this patch.

## Deployment

Run the normal frontend build:

```bash
npm ci
npm run build
```

The `npm audit fix --force` suggestion is unrelated to these TypeScript errors and should not be used merely to resolve this build failure, because it may introduce breaking dependency upgrades.
