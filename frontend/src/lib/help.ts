const help: Record<string, string> = {
  'article sku': 'The hotel’s unique internal code for this Article.',
  'supplier ref.': 'The supplier’s own catalogue or product reference for this Article.',
  'supplier catalogue reference': 'The supplier’s own catalogue or product reference for this Article.',
  'purchase unit': 'The unit in which this supplier sells the Article, such as a carton, case or bag.',
  'quoted price': 'The supplier’s most recently recorded price for one purchase unit.',
  'minimum': 'The smallest quantity the supplier permits in one order.',
  'minimum order quantity': 'The smallest quantity the supplier permits in one order.',
  'lead days': 'Expected calendar days from issuing the LPO until the supplier delivers the Article.',
  'lead time in days': 'Expected calendar days from issuing the LPO until the supplier delivers the Article.',
  'preference': 'Preferred means this is the primary supplier option for the Article; Alternative is a backup.',
  'preferred supplier': 'The supplier normally considered first for this Article or requisition.',
  'lpo': 'Local Purchase Order: the formal order issued to a supplier after approval.',
  'draft lpo': 'An LPO that can still be edited and has not yet been sent to the supplier.',
  'issued lpo': 'An LPO that has been formally sent to the supplier and can now receive goods.',
  'grn': 'Goods Received Note: evidence of goods delivered against an issued LPO.',
  'three-way match': 'Compares the LPO, accepted GRN quantities and supplier invoice before payment approval.',
  'reserved': 'Stock approved for a department request and temporarily unavailable to other operations.',
  'available': 'On-hand stock minus quantities reserved for approved requests.',
  'fefo': 'First Expiry, First Out: batches expiring soonest are issued first.',
  'fifo': 'First In, First Out: the oldest received batch is issued first when expiry dates do not decide priority.',
  'variance': 'The difference between the system quantity and the physically counted quantity.',
  'physical quantity': 'The quantity staff actually counted in the store.',
  'system quantity': 'The stock quantity recorded by the system before the physical count.',
  'post issue': 'Finalizes the issue, reduces stock, consumes batches and allocates the cost to the department.',
  'post accepted goods': 'Adds only inspection-accepted quantities to inventory.',
  'apply variance': 'Updates inventory to the approved physical count and records the difference in the stock ledger.',
  'apply inventory return': 'Finalizes the return and removes the returned quantity from hotel stock.',
  'expected date': 'The date by which the requesting department expects the goods to be available.',
  'unit cost': 'Cost of one selected unit of the Article.',
}

export function helpText(label: string): string | undefined {
  const normalized = label.trim().toLowerCase()
  return help[normalized]
}
