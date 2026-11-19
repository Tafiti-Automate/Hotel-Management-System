# Client feedback — physical stocktake before stocktake variances

The system now offers a physical stocktake start panel where a Store Keeper chooses a store and creates a dated count session linked to that store. The stocktake is populated with current InventoryBalance articles.

Physical quantities initially remain **blank** (null) and cannot be silently copied from system quantities. Zero must be explicitly entered for a physically missing item. After entering the values, the counter syncs and submits the count.

Submitted (or approved/applied) sessions become visible under Stocktake Variances to Cost Controller and Financial Manager. Store Keepers do not see theoretical quantities or variance while entering physical counts. Actual stock balances are untouched by counting or submission and change only through the existing authorization and approval process.

The Store Inventory screen creates and populates the same stocktake; it is not a separate counting ledger.

Database migration inventory/0035 changes StockCountItem.physical_quantity to nullable. Existing recorded numbers remain untouched, but legacy draft rows populated under the old implementation may have physical values copied from the system. Those historical draft counts must be manually reviewed before submission, since the migration cannot distinguish copied defaults from genuine physical counts.
