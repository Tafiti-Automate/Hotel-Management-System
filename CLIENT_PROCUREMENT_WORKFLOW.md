# Client Procurement Workflow — Confirmed Business Process

**Master data:** Management vets suppliers outside the system. The Cost Controller registers approved suppliers, their contact/TIN/address details, supplied items, quotation evidence, quoted prices, units, and item/unit conversions.

**Demand:** A department raises a requisition for an item and quantity. It does not see supplier or price information.

**Stores:** The Store Keeper receives the department demand and creates/forwards the store requisition with item, quantity and destination store. The Store Keeper does not select suppliers and does not see prices.

**Procurement:** The Procurement Manager receives the requisition, may reduce quantity, selects the suitable registered supplier, confirms/updates the supplier-item price, and prepares the LPO.

**Approval:** The LPO goes first to the Financial Manager, who can approve, reject with reason, or reduce quantity. After Finance approval it goes to the General Manager/Director for final approval or rejection. A final rejection stops supplier issue. Final approval returns the LPO to Procurement.

**Issue:** Procurement performs controlled printing. The first print is ORIGINAL and all later prints are COPY. Procurement may email the approved LPO to the supplier. Lead time starts from the initial successful supplier issue/send timestamp.

**Receiving:** The Receiving Clerk sees issued LPOs and records the supplier invoice/delivery details and the quantity physically received. Receipt quantity is a GRN value and never overwrites the LPO quantity. Partial receipts keep an outstanding balance and over-receipt is blocked.

**Business references:** Requisition, LPO/PO and GRN numbers are numeric client-facing references.
