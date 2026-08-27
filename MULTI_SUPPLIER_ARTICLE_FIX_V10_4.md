# Multi-Supplier Article Fix V10.4

## Client rule
An article may be supplied by more than one approved supplier. Procurement must compare the active quotations for that article and choose the suitable supplier during requisition processing.

## Changes
- Removed the database rule that allowed only one active preferred supplier per article.
- Removed the Preferred Supplier field from the supplier quotation UI.
- Removed Preference from the supplier quotation table.
- New supplier quotations are stored as alternatives for Procurement comparison.
- CSV/Excel quotation imports no longer create a preferred supplier designation.
- Existing legacy preferred flags are cleared by migration `inventory.0023_remove_single_preferred_supplier_rule`.
- The same supplier + article combination remains unique. If that supplier's price changes, edit the existing quotation so price history is preserved.
- Procurement continues to see all active supplier quotations for an article and can select the appropriate supplier per requisition line.

## Example
A4 Printing Paper may simultaneously have active quotations from:
- Prime Housekeeping & Office Supplies Ltd
- Kampala General Supplies Ltd
- Tafiti Office Solutions Ltd

Each supplier can have its own purchase UOM, quotation reference, price, validity date and lead time.

## Validation
- Frontend production build: `tsc -b && vite build` passed.
- Backend Python compileall passed.
- Vercel build script shell syntax passed.
- Regression test added for multiple active suppliers on the same article.
