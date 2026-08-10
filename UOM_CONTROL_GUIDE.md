# Unit of Measure Control Guide

## The rule

Every Article has one **base stock unit**: the smallest unit that Stores counts,
reserves, issues and values. Every larger purchase, issue or alternate unit must
have an Article-specific conversion.

Example:

| Definition | Value |
|---|---:|
| Article | Bottled Water 500 ml |
| Base stock unit | Bottle |
| Purchase unit | Carton |
| Conversion | 1 carton = 12 bottles |
| Supplier price | UGX 24,000 per carton |
| Normalized inventory cost | UGX 2,000 per bottle |

Buying 10 cartons therefore creates an LPO quantity of 10 cartons, an LPO value
of UGX 240,000, and a stock receipt of 120 bottles at UGX 2,000 per bottle.

## Setup order

1. Create shared unit names under **Settings → Units**: Piece, Bottle, Carton,
   Pallet, Kilogram, Litre and any others that are genuinely used.
2. Create the Article and select its **Base stock unit**. Prefer the smallest
   practical counting unit.
3. Open **Article unit conversions**.
4. Choose the Article, the role and the larger unit.
5. Enter the exact number of base units contained in one selected unit.
6. Add the supplier catalogue price using only the base unit or an active
   configured purchase/alternate unit.

Do not create a generic rule such as “every carton contains 12.” Conversion is
Article-specific: a water carton may contain 24 bottles while a detergent carton
contains 6 containers.

## System controls

- A non-base conversion must be greater than one. If a selected unit is smaller
  than the current base, change the Article design so the smaller unit becomes
  the base before transactions exist.
- Unconfigured or inactive units are rejected; the system does not assume a
  conversion factor of one.
- Supplier catalogue units are limited to the Article's base unit and configured
  purchase/alternate units.
- Quotation, LPO and receipt forms display the selected-unit-to-base-unit math.
- Purchase prices are per selected purchase unit. Stock quantities and batch
  costs are normalized to the base unit.
- A conversion used by a transaction cannot be edited, deactivated or deleted.
  This protects historical quantity and valuation evidence.
- An Article's base unit cannot change after conversions, stock or relevant
  transactions exist.

## Receiving check

Before posting a GRN, compare three values on screen:

1. Supplier delivery quantity and purchase unit.
2. Conversion factor.
3. Resulting base stock quantity and cost.

For example, `5 cartons × 12 = 60 bottles`. If the physical delivery contains
only 50 bottles, do not change the conversion to 10. Record the actual delivered
or accepted quantity and investigate the supplier shortage. A conversion
describes the package definition; it is not a correction tool for damaged or
short deliveries.

## Production status

The controls compile and the backend automated suites pass locally. They remain
`IMPLEMENTED–UNVERIFIED` until the current branch is deployed and the complete
base-unit → carton quotation → LPO → partial GRN → stock → invoice match journey
is exercised against the production database.
