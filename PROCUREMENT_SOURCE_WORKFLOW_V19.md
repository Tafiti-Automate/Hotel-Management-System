# Procurement Source Workflow v19

## Implemented

- Purchase Requisitions now record a procurement source.
- Store shortage PRs retain a direct link to the originating Store Request.
- Stores generates shortage PR lines from the exact unavailable quantity only.
- A shortage PR is not created when no shortage remains.
- Procurement users create manual/exceptional requests under their own authenticated employee, department, branch and hotel context.
- The manual PR form no longer asks Procurement to select requester, department or preferred supplier.
- The Procurement workbench separates Store Shortages, Manual Requests and All records.
- Requisition lists and details show the source.
- Client-created records cannot claim to be system-generated Store Shortage requisitions.

## Deployment

Run:

```bash
python manage.py migrate --settings=core.settings.prod
```

The migration classifies existing PRs whose control notes contain `Generated from department material request` as Store Shortage records. Other existing PRs are classified as Manual Procurement.

## Workflow

Store Request -> Department Approval -> Stores shortage confirmation -> exact-shortage PR -> Procurement sourcing -> quotation -> award -> LPO -> receiving.

Manual PRs are limited to exceptional procurement such as capital assets, emergency purchases, projects and services/non-stock requirements.
