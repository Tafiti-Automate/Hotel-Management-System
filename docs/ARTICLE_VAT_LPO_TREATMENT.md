# Article VAT selection and LPO tax control

Article Master now explicitly offers **VAT applicable** or **No VAT**.
The selection is persisted as `Item.vat_applicable`, exposed via API,
and included in item imports. New Articles without a VAT selection cannot
be saved through the frontend form. API/legacy imports default to no VAT
rather than assuming every item attracts 18%.

When a *draft* LPO Article line is saved, it captures the configured
VAT rate for VAT-applicable Articles, or 0% for non-VAT Articles.
The line-level snapshot is immutable once the LPO leaves draft.
LPO PDF lines show their respective VAT percentages, and VAT total is
the sum of actual taxable lines only. Both API and PDF expose the same
net/VAT/gross totals.

Legacy approved/issued LPOs are backfilled with the previous configured
universal VAT rate to preserve historical approved documents. Do not
silently modify or overwrite LPO 000127 or any previous signed PDF.
Finance must verify classification and use controlled correction/reissue
for any approved document with incorrectly applied VAT.

**Operational readiness**: review the VAT applicability of existing Article
master records before new purchasing; the migration cannot infer which
specific goods legally attract VAT. The user-selected classification should
be verified by an authorized Finance/Tax team, not guessed from a name.
