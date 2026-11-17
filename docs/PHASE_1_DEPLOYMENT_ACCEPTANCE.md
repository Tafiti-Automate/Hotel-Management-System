# Phase 1 — Deployment & role acceptance gate

**Branch:** `back$front`  
**Status:** Code-level remediation in progress; live environment is **not** certified.

## Why another pass was required

A successful Django/Next.js CI run proves the source builds and tests pass in the test database. It does not establish that an existing hotel database contains up-to-date role permissions, correctly assigned employees, or that deployed API routes match the branch.

The latest code-level audit found a critical inventory write issue: `POST inventory-balances/<id>/reconcile-reservation/` allowed IT administrators and did not validate the Store Keeper's store assignment. This action now denies IT/superusers and checks that the Store Keeper is assigned to the specific store. Automated regression coverage prevents accidental reintroduction.

**Additional read-scope control:** Cost Controller and Financial Manager stock counts, count items and stock ledgers now respect the assigned hotel/property. A two-branch regression test asserts that each role can see its own records but cannot read the other property's evidence. Real deployment testing is still required.

## Controlled deployment validation

Run these commands from the **deployed backend**, using the approved change-control process:

```sh
python manage.py migrate
python manage.py setup_hotel_roles
python manage.py audit_role_readiness --strict
```

The first two commands change the database and must be run only after backing up the production database and confirming the deployment version. `audit_role_readiness` is read-only and exits nonzero if any of the **ten canonical groups** lacks an active, correctly assigned user; it does not create accounts, reset credentials or touch stock.

**Do not automatically execute `provision_role_test_users` in production.** It currently creates seven synthetic accounts rather than all ten, and would mutate user accounts/passwords. Use individual authorized staff accounts or a staging environment for ten-role browser acceptance.

## Browser acceptance record

For each canonical role below, using the **actual deployed frontend and backend**, record: user identity (internally only), property/department/store scope, permitted page loads (GET 200), deliberately denied pages/actions (403), permitted mutations, audit trail, and any differences between API and GUI navigation.

| Role | Critical acceptance flow |
|---|---|
| Department Supervisor | Create and track own store request; no store-wide counts or commercial prices |
| Department Head | Review department request; own quantity-only PR; no contracted price visibility |
| Store Keeper | Assigned-store balances, issue/transfer, count and reservation reconciliation; no access to unassigned stores |
| Cost Controller | Read stocktake variance/ledger; approve supplier commercial quotes where authorized; no direct IT posting |
| Procurement Manager | Buyer workbench, vendor allocation and PO workflow; no stock posting |
| Receiving Clerk | Blind GRN receipt/inspection and returns; no contract prices |
| Accounts Payable Clerk | Invoice matching with GRN/PO evidence, permitted invoice actions |
| Financial Manager | Financial approval, stocktake variance read, budget and close; no unauthorized count editing |
| General Manager | Executive approval queue, reports and financial oversight |
| System Administrator | Manage user/role assignments and master data; cannot post financial/stock transactions |

## Open acceptance blockers

1. The deployed system's URL, CI-to-deployment linkage and credentials were not provided through repository access; **live browser acceptance has not been performed**.
2. Sample account provisioning does not yet cover all ten operational roles.
3. Positive and negative **real-record** API tests must confirm scope of stock/ledger, GRNs, invoices and procurement transactions across two branches and stores.
4. Frontend automated navigation checks do not replace role-specific browser tests. In particular, the outlet blind-count workflow remains a separate feature and is not yet represented as a permitted Store Keeper count.

Phase 1 must not be considered signed off until the production/staging environment passes the above role matrix with documented evidence.


## Machine-readable ten-role deployment readiness report

After deployment and an authorized `setup_hotel_roles` run, execute the **read-only** preflight:

```sh
python manage.py audit_role_readiness --json --strict
```

It emits one JSON object with `schema_version`, `read_only`, `all_roles_ready`, `ready_role_count`, `required_role_count`, and exactly ten role summaries containing counts of active/assigned, inactive and unassigned accounts plus a blocker code. It does **not** print user names, employee identifiers, emails, role passwords or property details. Without `--strict`, the command returns a non-blocking report; with `--strict`, it exits with an error if any required role is missing or unready. A code-only CI environment without real users must not be treated as ten-role acceptance. Keep exported JSON in access-controlled deployment evidence, not public GitHub commits.

**Acceptance meaning:** ten role assignments passing does *not* prove that the assigned users can execute their full browser journeys. Separate API/GUI actions, property/store scope, migrations, realistic transactions and screen-by-screen signoff still remain essential. This command creates no accounts and does not change inventory.
