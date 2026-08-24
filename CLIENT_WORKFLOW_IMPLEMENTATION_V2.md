# Client Procurement Workflow Implementation V2

## Status

Implemented in this package for the client-confirmed procurement process.

## Operational workflow

1. **Cost Controller** maintains approved suppliers, Articles, UOMs, article-specific conversions, supplier-item prices, quotation references and quotation attachments.
2. **Requester** creates one Department Requisition containing one or many Articles, quantities and a reason/note. Commercial information is not exposed.
3. **Department Head** approves or rejects the Department Requisition. Self-approval is blocked.
4. **Store Keeper** selects an assigned destination store and confirms/reduces each carried-forward quantity. Supplier and price data remain hidden.
5. **Procurement Manager** allocates a vetted supplier and current supplier price to each requisition line. Purchase-unit conversion is shown and enforced.
6. The system groups allocated lines by supplier and creates **one LPO per supplier** automatically.
7. Every LPO follows the fixed route **Financial Manager → General Manager**. Finance may reduce line quantities. Rejection requires a reason and is terminal for that LPO.
8. Final-approved LPOs return to Procurement for controlled printing and supplier email. First print is ORIGINAL; later prints are COPY. Lead time begins only after successful supplier issue/email.
9. **Receiving Clerk** receives only issued LPOs, enters supplier invoice/delivery details and actual received quantities, records accepted/rejected quantities, and posts the GRN. Partial receipt does not alter approved LPO quantity and over-receipt is blocked.
10. After received stock is posted to the Store Keeper's destination, the original Department Requisition is automatically re-evaluated. Once the Store Keeper-forwarded quantities are available, it returns to the Store Keeper for stock issue to the department.

## Major implementation changes

- Line-level supplier allocation fields added to `RequisitionItem`.
- Supplier catalogue/current-price confirmation is now Procurement's sourcing source; the old requisition-wide quotation award is no longer required by the Procurement role.
- Multiple suppliers in one Store Requisition automatically produce multiple LPOs.
- Procurement allocation validates article, supplier price, UOM conversion, current price and maximum Store Keeper quantity.
- Supplier price changes retain a history snapshot.
- Purchase Requisition, Department/Store Requisition, LPO and GRN use one shared six-digit numeric client-reference sequence.
- `po_number` is retained only for compatibility and mirrors `lpo_number` so users see one purchase document reference.
- Existing formatted references are normalized back to numeric values while preserving their historical numeric suffix where possible.
- New schema and data migrations are deliberately separated to avoid PostgreSQL pending-trigger/index conflicts on Vercel.
- Fixed LPO approval route replaces purchase-order approval-matrix routing.
- Rejected LPOs are terminal and their Procurement/Finance quantity evidence is preserved.
- Receiving Clerk now has the inspection permissions required by the current GRN-posting control.
- Store Keeper now has stock issue permissions so the Department request can complete after procurement.
- Store-request resume logic uses the Store Keeper-confirmed quantity rather than the original Department quantity.
- GRN posting automatically re-checks the originating Department request after stock replenishment.
- Operational role permissions are fixed. Role API is read-only and Access Management no longer edits role permissions.
- Legacy Stores Manager/Store Manager aliases consolidate into Store Keeper.
- `Tot` is seeded as an available UOM; it is not forced as the base unit for unrelated Articles.
- Procurement UI uses role/task queues and item-level supplier allocation with conversion previews.

## New migrations

- `inventory.0020_seed_tot_unit`
- `procurement.0024_client_procurement_workflow` — schema only
- `procurement.0025_numeric_client_references` — data normalization only

The schema/data split is intentional. Do not combine `0024` and `0025` into one atomic PostgreSQL migration.

## Deployment

The existing Vercel build script already runs migrations and `setup_hotel_roles`. After pushing this package, deployment should execute the normal build process.

For a manual environment:

```bash
cd hotel_erp_backend
python manage.py migrate
python manage.py setup_hotel_roles
python manage.py check
```

Then confirm:

- exactly one active Financial Manager is assigned for each relevant branch (or one global holder when no branch holder exists);
- exactly one active General Manager is assigned for each relevant branch (or one global holder);
- every Store Keeper has the correct active store assignment;
- supplier Articles have valid base/purchase UOM conversions and active supplier prices.

## Required UAT before client demonstration

Use separate role accounts and execute this scenario:

1. Cost Controller registers Supplier A, Supplier B and Supplier C, quotation evidence and prices.
2. Configure an Article with a base unit and a larger purchase unit (example: 1 carton = 12 bottles).
3. Requester creates one Department Requisition with at least four Articles.
4. HOD approves.
5. Store Keeper selects the destination store and forwards different quantities per line.
6. Procurement assigns at least three suppliers across the lines and confirms a current price.
7. Generate LPOs and verify lines are grouped by supplier.
8. Finance reduces at least one LPO line and approves.
9. General Manager approves one LPO and rejects another with a reason; verify the rejected LPO is terminal.
10. Procurement prints approved LPO twice; verify ORIGINAL then COPY.
11. Email supplier; verify issue timestamp/lead-time start.
12. Receiving Clerk receives a partial quantity and posts a GRN; verify LPO approved quantity remains unchanged and outstanding quantity is correct.
13. Receive the balance; verify over-receipt is blocked.
14. Verify the original Department Requisition returns to Store Keeper when the forwarded stock is available.
15. Store Keeper issues the stock to the department and completes the demand lifecycle.

## Validation completed in this workspace

- Backend Python source compilation: passed.
- All 39 frontend TypeScript/TSX source files: syntax-transpilation passed.
- Focused procurement test source updated/added for fixed approval routing and multi-supplier LPO splitting.

A full Django test run and a fresh Vite production build were not completed in this workspace because the required local dependencies were not available/reliably installable. Run them in CI or the normal project environment before production release.
