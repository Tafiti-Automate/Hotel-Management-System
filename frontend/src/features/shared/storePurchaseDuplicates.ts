type StorePurchaseRecord = Record<string, unknown>

const DUPLICATE_BLOCKING_STATUSES = new Set([
  'approved',
  'partially_ordered',
  'ordered',
  'partially_received',
])

const id = (value: unknown) => String(value || '')

/** Mirror the server duplicate guard so Store Keepers can review before posting. */
export function findOpenStorePurchaseRequest(
  requests: StorePurchaseRecord[],
  lines: StorePurchaseRecord[],
  storeId: string,
  itemId: string,
): StorePurchaseRecord | null {
  const requestById = new Map(requests.map((request) => [id(request.id), request]))
  const duplicateLine = lines.find((line) => {
    const request = requestById.get(id(line.requisition))
    return id(line.item) === itemId
      && id(line.destination_store) === storeId
      && Boolean(request)
      && DUPLICATE_BLOCKING_STATUSES.has(id(request?.status).toLowerCase())
  })

  return duplicateLine ? requestById.get(id(duplicateLine.requisition)) || null : null
}
