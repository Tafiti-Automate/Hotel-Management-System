# Oracle parity increment — Daily Market Lists and four-quadrant Menu Engineering

**Working branch:** `back$front`  
**Status:** Implemented in source; subject to CI, restored PostgreSQL staging UAT, and client sign-off.

## Controlled Daily Market Lists

The Department Head now has a **Daily Market Lists** screen and a dedicated
`GET/POST /api/v1/requisitions/market-lists/` endpoint. Each list contains
positive four-decimal quantities and active traceable (batch, expiry or HACCP)
Articles. Its business date, requester, department, branch and document number
are server-owned. No supplier names, costs, discounts or price estimates
appear in the Department Head's Market List response.

The system creates a typed `PurchaseRequisition` draft with
`procurement_source=market_list`, reusing the existing PR item register,
approval history, hard budget checks, Finance approval matrix and
PR→LPO procurement pipeline. There is **no separate bypass** for purchasing,
receiving, Stores or Accounts Payable.

The originating Head can call
`POST /api/v1/requisitions/{id}/submit-market-list/` only for a draft
created on the current business date. Before submission, the backend derives
each Article's unit estimate from an active Cost-Control-published
`SupplierItemPrice` whose currency, effective date, quotation validity and
unit conversion are current. Missing current prices block submission; a zero
budget commitment can never submit successfully. Submission then calls the
existing requisition approval matrix and budget controls, and produces history.

**Limitations:** The screen creates and submits lists; revisions of already
created draft lines and archival/carry-forward of unused perishables are
separate enhancements. Market List approval does **not** select the supplier
or issue a PO automatically. Article master traceability flags must be
configured to qualify a product as perishable. Existing default Django role
permissions are unchanged. Apply the pending `0036` choices migration only
after an approved database backup and restored staging verification.

## Menu Engineering Matrix

The existing backend `menuEngineering` report now classifies recipes using
four quadrants:

- **Star:** above/equal average popularity and above/equal average
  unit contribution.
- **Plowhorse:** high popularity, below-average unit contribution.
- **Puzzle:** below-average popularity, high unit contribution.
- **Dog:** below-average popularity and unit contribution.
- **Unclassified:** historical cost unknown, no positive sales or no
  positive quantities. Excluded from both thresholds.

Popularity is the number of portions sold in the selected date/outlet scope;
unit contribution is `(posted POS net sales - historical frozen recipe COGS) /
sold portions`. Thresholds are arithmetic averages of *eligible recipes* in
the role-scoped period. The report includes classification, gross contribution
per portion, margin, count and suggested action; the classification is a
decision aid, **not a GL entry**. It does not infer missing costs.

## Evidence required before parity sign-off

1. Run automated tests and migration checks on the exact branch commit.
2. Apply `0036` to an approved **restored staging PostgreSQL** environment
   after backup; ensure no historical PR status or value is changed.
3. Create a three-item daily perishable Market List as a real Department Head.
   Demonstrate quantity-only UI, no supplier-price leakage, HOD-only submission,
   missing-price rejection, independently approved catalogue quote, budget cap,
   Finance approval and source PR→LPO linkage.
4. Verify cross-branch denial and that Receiving / IT / Store Keeper cannot
   create or submit Market Lists.
5. Record four known POS recipe examples with independent frozen COGS and
   prove Star, Plowhorse, Puzzle, Dog and missing-cost classification.
6. Complete GL/GRNI, Banquet/BEO, cross-property transfers, unified frontend
   visual audit and ten-role staging acceptance in subsequent increments.

**Not done in this increment:** external accounting journal posting, true
GRNI month-end accruals, banquet planning or production deployment acceptance.
