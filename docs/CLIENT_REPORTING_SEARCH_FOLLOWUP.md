# Client reporting and search — follow-up

- Shared enterprise tables have explicit Search/Clear controls with keyboard submission.
- Shared selectors in Inventory, Procurement and Finance workbenches and recipe creation use searchable native selects. Filtering never discards the current selection; required/disabled semantics remain native.
- Cost of Sales by Location uses posted POS recipe net sales and captured historical COGS, with line-level detail and scoped aggregation. Missing costs suppress the affected total, not replace it with zero. This is not full hotel cost of sales.
- Warehouse and Major Group reports provide article positions, quantities in their own units, and valuation; mixed UOM quantities are no longer totaled. Recorded inventory WAC takes precedence over legacy batch-only cost.
- Date filtering handles date-only and timestamp fields. Administrator branch/store criteria intersect rather than one overriding the other.
- Added regression cases for WAC and unvalued POS sales. Full CI, visual acceptance, remaining report-specific summaries and module-specific search audit remain necessary.
- Department-specific GL mappings and the actual export treatment of signed transit pickups, direct receipts and return reversals require a controlled accounting design and tests. No new GL entries or production account codes are invented in this change.
