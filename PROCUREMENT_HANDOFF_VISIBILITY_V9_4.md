# Procurement Handoff Visibility V9.4

## Problem
A Store Keeper hand-off was created correctly, but Procurement users could believe it had disappeared because:

- new hand-offs were placed under the `Supplier Allocation` queue rather than a clearly named incoming-requisition queue;
- the queue displayed the generated Procurement Requisition number instead of the originating Department/Store Requisition reference (`R-xxxxx`);
- `Procurement Officer` did not have the same Purchase Requisition visibility/action rules as `Procurement Manager` in several backend paths.

## Changes

- Renamed the first Procurement queue to **New Store Requisitions**.
- Added `source_store_requisition_no` to the Purchase Requisition API serializer.
- Procurement queue rows now show the original `R-xxxxx` reference as the primary reference.
- Supplier-allocation detail and LPO preparation now retain the same source `R-xxxxx` reference.
- Empty Prepare LPO state now tells the user to complete supplier allocation first.
- Added Procurement Officer to Procurement requisition visibility and commercial control role checks.
- Procurement Officers can allocate supplier lines and prepare LPOs under the same fixed role template as Procurement Managers.
- Store Keeper hand-off notifications now go to both Procurement Manager and Procurement Officer.

## Expected client flow

Store Keeper forwards `R-00100` -> Procurement opens **New Store Requisitions** -> `R-00100` is visible -> Procurement selects supplier/current price per line -> requisition moves to **Prepare LPO** -> LPO is created -> Finance -> GM -> Procurement prints/sends.

No database migration is required.
