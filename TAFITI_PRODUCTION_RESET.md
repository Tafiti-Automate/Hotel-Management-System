# Tafiti Hotel production clean reset

This project contains a guarded production reseed for a clean procurement workflow test.

## What is preserved

The reset preserves every existing Django user account with the same:

- primary key
- username / employee code
- password hash
- email / name / phone / active flags
- group memberships
- direct user permissions

Existing employee profile context is rebuilt onto the new Main Branch while preserving the employee's department name, designation, gender, contact, address, join date, and photo reference.

The reset clears operational/master/transaction records and recreates only the small Tafiti procurement baseline described below.

## New clean baseline

### Hotel and location

- Hotel: **Tafiti Hotel**
- Branch: **Main Branch** (`MAIN`)
- Store: **Main Store**
- Currency: UGX
- Time zone: Africa/Kampala

There is exactly one branch and one store.

### Four articles

| SKU | Article | Category | Base UOM | Purchase UOM | Conversion |
|---|---|---|---|---|---|
| TAF-RICE-25 | Long Grain Rice | Food Supplies | Kilogram | Sack | 1 Sack = 25 kg |
| TAF-WATER-500 | Mineral Water 500ml | Beverages | Bottle | Carton | 1 Carton = 24 bottles |
| TAF-SOAP-5L | Liquid Hand Soap | Housekeeping Supplies | Litre | Jerrycan | 1 Jerrycan = 5 litres |
| TAF-PAPER-A4 | A4 Printing Paper 80gsm | Stationery | Ream | Carton | 1 Carton = 5 reams |

Opening stock is **0** for all four articles. This makes the first GRN visibly create stock during workflow testing.

### Five suppliers

| Supplier | Email | Main supplied articles |
|---|---|---|
| Tafiti Food & Beverage Supplies Ltd | mugishawarid@gmail.com | Rice, Water |
| Prime Housekeeping & Office Supplies Ltd | kjapher38@gmail.com | Soap, A4 Paper |
| Kampala Institutional Traders Ltd | wmugisha@kcca.go.ug | Water, A4 Paper |
| East Africa Hospitality Supplies Ltd | watumwaizaac32@gmail.com | Rice, Soap |
| Reliable General Supplies Ltd | mugishawarid@gmail.com | Water, A4 Paper |

The supplied email list is deliberately rotated across all five suppliers; therefore supplier email is no longer a unique database field. TIN and registration number remain unique.

Each article has at least two valid suppliers so Procurement can genuinely compare/allocate suppliers during testing.

## Production safety

The command is destructive to operational data. It will not run in production unless:

1. `--execute` is supplied.
2. The exact confirmation phrase is supplied.
3. A backup path is supplied **or** an external database-provider backup is explicitly acknowledged.
4. At least one user account and one recovery superuser exist.

The Vercel deployment hook additionally requires three environment variables.

## Recommended Vercel / Neon procedure

### 1. Create a Neon backup/snapshot first

Create a database snapshot/branch in Neon before triggering the reset.

### 2. Add these temporary Vercel backend environment variables

```text
TAFITI_PRODUCTION_RESEED_KEY=tafiti-clean-v1
TAFITI_PRODUCTION_RESEED_CONFIRM=RESET-TAFITI-PRODUCTION
TAFITI_EXTERNAL_BACKUP_CONFIRMED=YES
```

`TAFITI_PRODUCTION_RESEED_KEY` is an idempotency key. The completed key is recorded in the database so an accidental rebuild with the same key will not wipe the database again.

### 3. Deploy the backend

The build performs migrations first and then runs:

```bash
python manage.py reseed_operational_data \
  --hotel-name "Tafiti Hotel" \
  --execute \
  --confirm RESEED-OPERATIONAL-DATA \
  --external-backup-confirmed \
  --once-key "tafiti-clean-v1" \
  --settings=core.settings.prod
```

### 4. Remove the three temporary reset environment variables

After the deployment succeeds, remove:

```text
TAFITI_PRODUCTION_RESEED_KEY
TAFITI_PRODUCTION_RESEED_CONFIRM
TAFITI_EXTERNAL_BACKUP_CONFIRMED
```

This prevents the destructive deployment path from being selected on future normal deployments.

## Historical/demo data

`seed_historical_operations` is no longer run on every Vercel deployment. A clean reset therefore remains clean.

If historical presentation data is deliberately needed later, set:

```text
SEED_HISTORICAL_OPERATIONS=1
```

For normal workflow testing, leave it unset.

## Local rehearsal

Dry run:

```bash
python manage.py reseed_operational_data
```

Local destructive rehearsal:

```bash
python manage.py reseed_operational_data \
  --execute \
  --confirm RESEED-OPERATIONAL-DATA \
  --allow-non-production \
  --skip-backup
```

## Recommended clean workflow test

1. Requester creates one requisition with multiple items.
2. Department Head reviews and may reduce quantities.
3. Store Keeper chooses Main Store and forwards quantities.
4. Procurement compares the seeded supplier quotations per article and allocates suppliers.
5. Procurement creates LPO(s), grouped by supplier.
6. Financial Manager reviews/reduces/approves.
7. General Manager makes the final decision.
8. Procurement prints the ORIGINAL and emails the supplier.
9. Receiving Clerk records actual delivery and posts the GRN.
10. Verify Main Store stock increased from the zero opening balance.

This dataset intentionally contains no old requisitions, LPOs, GRNs, invoices, sales, notifications, audit history (other than the reset marker), or historical demo operations.
