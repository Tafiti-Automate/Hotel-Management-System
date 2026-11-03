type RecordValue = Record<string, unknown>

export function isTransportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch|networkerror|load failed|server took too long/i.test(message)
}

function sameText(left: unknown, right: unknown): boolean {
  return String(left ?? '').trim() === String(right ?? '').trim()
}

function sameNumber(left: unknown, right: unknown): boolean {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  return Number.isFinite(leftNumber)
    && Number.isFinite(rightNumber)
    && leftNumber === rightNumber
}

/**
 * Confirm that a quotation returned after a lost POST response contains the
 * exact values the browser attempted to save. Supplier + article alone is not
 * enough because an older quotation may already occupy that unique pair.
 */
export function supplierQuotationMatches(
  payload: RecordValue,
  candidate: RecordValue,
): boolean {
  const textFields = [
    'supplier',
    'item',
    'unit',
    'supplier_sku',
    'currency',
    'effective_from',
    'last_quoted_at',
    'quotation_reference',
    'quotation_valid_until',
  ]
  const numberFields = [
    'unit_price',
    'minimum_order_quantity',
    'lead_time_days',
  ]

  return textFields.every((field) => sameText(payload[field], candidate[field]))
    && numberFields.every((field) => sameNumber(payload[field], candidate[field]))
    && Boolean(payload.is_active) === Boolean(candidate.is_active)
}
