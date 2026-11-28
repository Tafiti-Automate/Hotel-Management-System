# Persistent general ledger foundation (staged)

Base inspected: `back$front` at `155ba791d6b96593b4ac557f051ec1414650bf82`.
This patch includes the previous statement engine, new internal ledger tables,
manual journal services and tests. No changes to existing operational posting,
GL exports, database data, or fiscal period close logic are made.

## Scope and limitations

- Financial Manager creates property-specific accounts; the three specified
  roles can prepare journals and read calculated statements. Independent General
  Manager approval is required; a Financial Manager distinct from the approver
  posts. These are proposed segregation-of-duty rules, not yet client-confirmed.
- Journal source keys are unique per property; repeated submission is rejected.
  Opening journal requires supporting evidence and approval. No client balances
  are loaded. The opening date is reserved for the opening journal, so the
  opening fiscal period must cover that date and remain open until posting.
- No API/admin CRUD is exposed. All writes must use the ledger service. Direct
  ORM/SQL writes can bypass service checks; DB-level immutable journal enforcement,
  reversal workflow, account classification change controls, and full close
  checklist integration are still required before production use.
- Statement arithmetic only; complete source integration, opening evidence and
  period completeness must be reconciled independently. Existing GL exports are
  not posted journals. No historical or automatic operational posting.
- The direct cash-flow calculation is not the client's required indirect format.
  Fixed assets, reconciliation UI, report exports and endpoints remain pending.

## Apply and validate locally

From the repository root on `back$front`, with a clean worktree and the patch
saved outside the repository:

```sh
git apply --check /path/to/hotel_finance_persistent_ledger.patch
git apply /path/to/hotel_finance_persistent_ledger.patch
cd hotel_erp_backend
python manage.py makemigrations --check --dry-run
python manage.py check
python manage.py migrate --plan
# Run migrations on an isolated test database, NOT production.
python -m pytest tests/test_persistent_ledger.py tests/test_ledger_validation.py tests/test_financial_statement_engine.py
```

Use the cumulative patch only if the prior calculation patch has not been
applied. If it has, use the incremental patch instead. Standalone tests: 16
passed; Python syntax compilation passed. Django/DB integration, migration
checks, concurrency and full regression suite were not run in the isolated
build environment. No push or deployment performed.
