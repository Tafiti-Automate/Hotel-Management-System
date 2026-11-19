# Multiple GRNs for the same supplier or Article

Physical receiving must be independent of supplier invoice matching.
A supplier may deliver an approved LPO in several shipments, or the hotel
may issue another LPO for the same Article. Each physically different delivery
gets its own GRN, counted and locked independently. The approved LPO
outstanding quantity is still enforced, and re-posting to store stock is blocked.

- **Supplier invoice number**: optional at physical receiving if a supplier
  delivery note exists. An invoice may be associated with multiple GRNs.
- **Supplier delivery note number**: optional if the invoice is new, but
  essential when reusing an invoice number already recorded for the supplier.
  A supplier delivery note cannot be reused on another GRN for that supplier.
- **Neither reference available**: do not fabricate invoice or delivery note
  numbers. The receiving API requires at least one genuine reference and
  explains the missing evidence.
- **Previously-used invoice alone**: blocked with instructions to enter a
  genuine unique delivery note or open the original GRN.
- **Subsequent delivery with a distinct note**: permitted for another GRN if
  the LPO is issued or partially received and quantities remain outstanding.
- **Full LPO already received**: no further receipt under that LPO. Create
  a separate approved LPO for any new requirement.

These are receiving-document controls, not supplier invoice matching/settlement:
Accounts must still reconcile any single supplier invoice against its linked
GRNs once, not create a new payable for each GRN.

Blind-count protection remains unchanged: ordered quantities remain hidden
until a physical count is saved and locked. Receiving does not automatically
post stock on hand.
