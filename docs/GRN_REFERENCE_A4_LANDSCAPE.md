# GRN printout — Lake Victoria Serena specimen format

Reference: the November 18 client photograph of an A4 landscape
**Goods Received Note (PURCHASE ORDER RECEIVING)**.

## Implemented print template

Shared React component: `frontend/src/components/GrnReferenceDocument.tsx`  
Print CSS: `frontend/src/grn-reference-exact.css`, imported **last**
by `frontend/app/layout.tsx` to override enterprise theme print rules.

The black-on-white, Times New Roman, A4 landscape document follows the
supplied paper layout:

1. Thin rectangular hotel-name strip across the top, centered hotel name.
2. Centered **Goods Received Note** and **(PURCHASE ORDER RECEIVING)**.
3. Supplier block at upper left: registered name, address, telephone, email,
   TIN; all drawn from the current supplier record.
4. Five-row, bordered information box at upper right: GRN No., LPO No.,
   Delivery Date, Delivery Note No., Delivery Location.
5. Straight ruled table with columns **Status | Article | Ordered | Unit |
   Delivered | Unit Price | Nett | VAT % | Amount**, without a heavy
   data-grid border.
6. Generous blank receipt/signing area, bottom right **Nett Total,
   VAT Total, Total Amount**, and signature dotted line.
7. Low-profile footer: printed receiving user, partial-delivery status
   legend (where applicable), date/time.

**The sample's supplier, document numbers and amounts are NOT hardcoded.**
The same template is rendered in the Procurement GRN history print view
(`ProcurementWorkbench`) and in the real Receiving Clerk's
`ReceivingClerkWorkspaceV2` GRN preview. Both offer `Print GRN` and
browser **Print to PDF** on A4 landscape.

**Blind-receiving protection**: a clerk sees ordered quantities only after
the count is saved and locked, and may then print those quantities from the
`blind-reconciliation` response. The server never supplies supplier
unit costs to a clerk, so their print retains the exact column labels but
renders commercial amounts as **—**. Procurement/Finance/approved commercial
staff may print a priced copy if the permitted API exposes unit costs.
Unknown historical ordered quantities are also shown as **—** rather than
being fabricated from delivered quantities.

**Price/tax note**: the printed GRN reuses the existing application's
18% default VAT calculation when no item/receipt rate is present. The
layout change is not a new tax engine or an accounting posting. Finance must
verify the legal and article-specific VAT classification against actual LPO
and supplier invoice records before using monetary totals as tax evidence.

## Acceptance

- Open a GRN through either workspace, print on A4 landscape at 100% scale,
  with browser headers/footers disabled.
- Compare the positions of the supplier, five-row detail box, table, totals,
  signature and footer to the supplied photograph.
- Verify populated, non-empty supplier and property records.
- Verify a one-line delivery, many-line delivery, partial delivery, and
  registered non-expiring Articles.
- Confirm the Receiving Clerk's saved count is locked and any pricing is
  masked, including in the print preview.
- Check print-to-PDF visual rendering and printer compatibility on a real
  hotel workstation before signing off.

This increment changes **presentation and print only**. It does not change
GRN posting, supplier returns, inventory balances or three-way matching.
