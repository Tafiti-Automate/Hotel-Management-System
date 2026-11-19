# Hospitality Phase 1C — Reception and Bar workspaces

This batch introduces two operational Next.js workspaces:

- **Reception / Reservations** at `/front-desk/reservations`: property room register,
  date range availability, existing-guest reservation creation, and booking register.
- **Bar POS check register** at `/bar/pos`: assigned outlet list, open check creation
  and open-check register.

Screens use secured Phase 1B Django endpoints; no mock inventory, fake bookings
or browser-only settlement. Guest ID is intentionally an existing Customer UUID:
the existing Customer listing API is not adequately property-scoped for a
new reception lookup; private guest search/registration is a separate next step.

Bartender POS intentionally means **check opening only** at this stage,
not menu ordering, payment capture, receipts, settlement or inventory posting.
Cashier access remains read-only until shift/tender authorization exists.

## Deployment resource management

Changes are staged as one cohesive Git commit and one branch update. Avoid
pushing numerous small WIP commits to a Vercel-connected branch.

Recommended Vercel project settings:
- Set frontend Root Directory to `frontend` and backend Root Directory to `hotel_erp_backend`.
- Under Build and Deployment / Ignored Build Step configure
  **Only build if there are changes in a folder** for the corresponding project.
- If the available Vercel plan supports automatic skipping of unaffected
  monorepo projects, prefer that behavior. Workspace-based auto skipping may
  require root package workspace definitions and is not assumed by this repo.
- Protect production deployment via a separate promoted release branch;
  only move to it after GitHub Actions pass. Do not change deployment branch
  settings without the owner's approval.

One Git push can still trigger separate frontend and backend deployments when
both projects are wired to the same branch. CI also runs a build but does not
consume Vercel build CPU time.

## Next

Implement property-scoped guest search/registration, reservation lifecycle
transitions, POS order items, cashier sessions, sale settlement and room folios.
