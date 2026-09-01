# Inventory Catalogue Hierarchy Fix

The inventory catalogue now enforces a three-level business hierarchy:

**Major Group → Item Group → Item**

Examples applied by migration `inventory.0025_enforce_catalogue_item_groups`:

- Beverages → Soft Drinks → Mineral Water 500ml
- Food Supplies → Rice & Grains → Long Grain Rice
- Housekeeping Supplies → Cleaning & Hygiene → Liquid Hand Soap
- Stationery → Paper Products → A4 Printing Paper

## Controls

- Major Groups are top-level `Category` records with no parent.
- Item Groups are `Category` records whose `parent` is the Major Group.
- The item form requires the Major Group first, then only shows Item Groups belonging to it.
- The API rejects an item if its selected category is a Major Group.
- CSV/Excel import requires both `major_group` and `item_group` and attaches each item to the Item Group.
- The catalogue explorer no longer exposes an `Unassigned Items` folder.
- Legacy items attached directly to a Major Group are repaired by migration. Known operational articles are moved to their approved Item Groups; any other legacy direct assignment is retained under an automatically created `Other <Major Group>` child group so no stock record is lost.

Vercel runs Django migrations from `vercel_build.sh`, so this repair is applied during a normal backend deployment.
