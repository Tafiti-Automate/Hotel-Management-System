# Store Keeper Purchase Requests

## Purpose

Store Keepers can raise replenishment purchase requests directly for stores assigned to them without using the Department Request workflow.

## Workflow

Store Keeper → Procurement → LPO Level 1 → Financial Manager → General Manager → Supplier → Receiving / GRN → Inventory Posting

The Store Keeper enters only:

- assigned destination store;
- required date;
- business reason;
- Article(s);
- requested quantity; and
- optional line notes/specification.

The Store Keeper cannot select suppliers or enter/edit prices. Reference costs, where available, are taken server-side from active Cost Controller quotation data and are not exposed to the Store Keeper. Procurement selects vetted supplier quotations before the LPO is created.

## Controls

- Requests can only target stores actively assigned to the authenticated Store Keeper.
- At least one Article with a positive quantity is required.
- Duplicate Articles cannot be entered on the same request.
- A second open Store Purchase Request for the same Article and store is blocked until the first is completed or cancelled.
- Creation is serialized per store to reduce duplicate-request races.
- The request is audit-recorded and Procurement is notified.
- A Store Keeper may cancel their own request only before Procurement has created an LPO.
- Commercial supplier/price fields remain hidden from Store Keeper responses.

## Deployment

Run migrations after deployment:

```bash
cd hotel_erp_backend
python manage.py migrate
```

Migration `0030_store_purchase_request_source.py` adds the `store_purchase` procurement-source choice.
