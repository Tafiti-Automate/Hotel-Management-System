# Procurement Guidance, Gender Control, and Light Mode v21

## Procurement sourcing
- Displays competitive-sourcing progress before supplier award.
- Shows quotation count against the configured operational policy presentation (UGX 1,000,000 / 3 quotations).
- Checks selected quotation coverage, expiry, and evaluation notes before enabling `Select as winner`.
- Replaces avoidable award-time errors with visible blockers and a disabled action.
- Backend validation message now reports the exact number of additional quotations required.

## Employee gender
- Employee gender accepts only `Male` or `Female`.
- API validation rejects any other non-empty value.
- The frontend selector contains only Male and Female.

## Light mode
- Replaced the flat white canvas with blue-grey application surfaces.
- Increased card, border, input, drawer, table-hover, and navigation contrast.
- Added a subtle background treatment while preserving dark mode.

## Deployment
Run migrations after deployment:

```bash
python manage.py migrate --settings=core.settings.prod
```
