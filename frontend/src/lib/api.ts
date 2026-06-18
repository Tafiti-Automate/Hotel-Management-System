import { itemStatus, type EntityKey, type Line, type Row } from './data'

type ApiRecord = Record<string, unknown>
type ApiListResult = { rows: ApiRecord[]; error: string | null }

export type ApiStatus = 'idle' | 'loading' | 'live' | 'offline'

export interface BackendDataResult {
  data: Partial<Record<EntityKey, Row[]>>
  warnings: string[]
}

const endpoints = {
  categories: 'categories',
  units: 'units',
  items: 'items',
  stores: 'stores',
  balances: 'inventory-balances',
  prices: 'supplier-item-prices',
  vendors: 'vendors',
  ledgers: 'stock-ledger',
  batches: 'inventory-batches',
  requisitions: 'requisitions',
  reqItems: 'requisition-items',
  orders: 'purchase-orders',
  orderItems: 'purchase-order-items',
  grns: 'grns',
  departments: 'departments',
  employees: 'employees',
  branches: 'branches',
} as const

const entityEndpoints: Partial<Record<EntityKey, string>> = {
  categories: 'categories',
  uoms: 'units',
  items: 'items',
  locations: 'stores',
  suppliers: 'vendors',
}

function apiRoot(): string {
  return (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '')
}

function endpointUrl(path: string): string {
  if (/^https?:\/\//.test(path) || path.startsWith('/api/')) return path

  const [base, query] = path.split('?')
  const cleanPath = base.replace(/^\/+|\/+$/g, '')
  const url = `${apiRoot()}/${cleanPath}/`
  return query ? `${url}?${query}` : url
}

function nextUrl(next: unknown): string | null {
  if (typeof next !== 'string' || !next) return null
  if (!apiRoot().startsWith('/') || !/^https?:\/\//.test(next)) return next
  const parsed = new URL(next)
  return `${parsed.pathname}${parsed.search}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function readList(path: string): Promise<ApiRecord[]> {
  const rows: ApiRecord[] = []
  let url: string | null = endpointUrl(path)
  let pages = 0

  while (url && pages < 20) {
    pages += 1
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) {
      throw new Error(`GET ${path} failed with ${response.status}`)
    }

    const body = await response.json()
    if (Array.isArray(body)) return body as ApiRecord[]

    if (Array.isArray(body.results)) rows.push(...(body.results as ApiRecord[]))
    else if (body && typeof body === 'object') rows.push(body as ApiRecord)
    url = nextUrl((body as ApiRecord).next)
  }

  return rows
}

async function safeRead(path: string): Promise<ApiListResult> {
  try {
    return { rows: await readList(path), error: null }
  } catch (error) {
    return { rows: [], error: errorMessage(error) }
  }
}

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function idOf(record: ApiRecord | undefined): string {
  return text(record?.id)
}

function shortId(value: unknown): string {
  const raw = text(value)
  return raw ? raw.slice(0, 8).toUpperCase() : ''
}

function dateOnly(value: unknown): string {
  return text(value).slice(0, 10)
}

function titleCaseStatus(value: unknown): string {
  const raw = text(value, 'active').replace(/_/g, ' ')
  return raw.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function requisitionStatus(value: unknown): string {
  const raw = text(value).toLowerCase()
  if (['submitted', 'hod_approved', 'procurement_approved', 'finance_approved', 'director_approved'].includes(raw)) {
    return 'Pending'
  }
  return titleCaseStatus(raw)
}

function purchaseOrderStatus(value: unknown): string {
  const raw = text(value).toLowerCase()
  if (raw === 'issued') return 'Awaiting GRN'
  if (raw === 'partially_received') return 'In transit'
  if (raw === 'received') return 'Completed'
  return titleCaseStatus(raw)
}

function activeStatus(value: unknown): string {
  return bool(value) ? 'Active' : 'Inactive'
}

function makeCode(name: unknown, fallback: string): string {
  const code = text(name)
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 3)
    .toUpperCase()
  return code || fallback
}

function mapById(rows: ApiRecord[], nameKey = 'name'): Map<string, string> {
  const out = new Map<string, string>()
  rows.forEach((row) => out.set(idOf(row), text(row[nameKey], idOf(row))))
  return out
}

function groupBy(rows: ApiRecord[], field: string): Map<string, ApiRecord[]> {
  const out = new Map<string, ApiRecord[]>()
  rows.forEach((row) => {
    const key = text(row[field])
    if (!key) return
    out.set(key, [...(out.get(key) || []), row])
  })
  return out
}

function firstBy(rows: ApiRecord[], field: string): Map<string, ApiRecord> {
  const out = new Map<string, ApiRecord>()
  rows.forEach((row) => {
    const key = text(row[field])
    if (key && !out.has(key)) out.set(key, row)
  })
  return out
}

function countBy(rows: ApiRecord[], field: string): Map<string, number> {
  const out = new Map<string, number>()
  rows.forEach((row) => {
    const key = text(row[field])
    if (key) out.set(key, (out.get(key) || 0) + 1)
  })
  return out
}

function expiryStatus(expiryDate: unknown, depleted: unknown): string {
  if (bool(depleted)) return 'Depleted'
  const raw = text(expiryDate)
  if (!raw) return 'Fresh'
  const expiry = new Date(raw).getTime()
  const ninetyDays = 90 * 24 * 60 * 60 * 1000
  if (Number.isFinite(expiry) && expiry - Date.now() <= ninetyDays) return 'Expiring'
  return 'Fresh'
}

function itemLines(rows: ApiRecord[], itemNames: Map<string, string>, itemUnits: Map<string, string>, priceByItem: Map<string, number>): Line[] {
  return rows.map((row) => {
    const itemId = text(row.item)
    const qty = num(row.quantity ?? row.quantity_received ?? row.quantity_requested)
    const unitCost = num(row.unit_cost, priceByItem.get(itemId) || 0)
    return {
      item: itemNames.get(itemId) || shortId(itemId),
      qty,
      uom: itemUnits.get(itemId) || 'Unit',
      unitCost,
    }
  })
}

function findDataId(data: Record<EntityKey, Row[]>, entity: EntityKey, value: unknown): string {
  const display = text(value)
  const row = data[entity].find((candidate) =>
    text(candidate.id) === display ||
    text(candidate.name) === display ||
    text(candidate.abbr) === display ||
    text(candidate.code) === display
  )
  return text(row?.id)
}

function slug(value: unknown): string {
  return text(value, 'record').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'record'
}

function toBackendPayload(entity: EntityKey, values: Row, data: Record<EntityKey, Row[]>, isUpdate: boolean): Row {
  if (entity === 'categories') {
    return {
      name: text(values.name),
      description: text(values.description),
    }
  }

  if (entity === 'uoms') {
    return {
      name: text(values.name),
      abbreviation: text(values.abbr || values.code, makeCode(values.name, 'UOM')),
      is_active: true,
    }
  }

  if (entity === 'locations') {
    return {
      name: text(values.name),
      address: text(values.address || values.branch),
      is_active: text(values.status, 'Active') !== 'Inactive',
    }
  }

  if (entity === 'suppliers') {
    const base: Row = {
      name: text(values.name),
      phone: text(values.phone, '+256000000000'),
      contact_person: text(values.contact),
      is_active: text(values.status, 'Active') === 'Active',
    }
    if (!isUpdate) {
      const suffix = `${slug(values.name)}-${Date.now()}`
      base.email = text(values.email, `${suffix}@example.local`)
      base.address = text(values.address, 'Not provided')
      base.tin_number = text(values.tin_number, `TIN-${suffix}`)
      base.registration_number = text(values.registration_number, `REG-${suffix}`)
    }
    return base
  }

  if (entity === 'items') {
    const categoryId = findDataId(data, 'categories', values.category)
    if (!categoryId) throw new Error('Choose a backend category before saving this item.')

    const unitId = findDataId(data, 'uoms', values.uom)
    return {
      category: categoryId,
      name: text(values.name),
      sku: text(values.sku),
      unit: text(values.uom, 'Unit'),
      base_unit: unitId || null,
      reorder_level: num(values.reorder),
      is_active: true,
    }
  }

  throw new Error(`Backend saving is not configured for ${entity}.`)
}

async function sendJson(path: string, method: string, body?: Row): Promise<unknown> {
  const response = await fetch(endpointUrl(path), {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`${method} ${path} failed with ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`)
  }

  if (response.status === 204) return null
  return response.json()
}

export async function fetchBackendData(): Promise<BackendDataResult> {
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, endpoint]) => [key, await safeRead(endpoint)] as const),
  )

  const loaded = Object.fromEntries(entries) as Record<keyof typeof endpoints, ApiListResult>
  const successful = entries.filter(([, result]) => !result.error)
  if (successful.length === 0) {
    throw new Error(loaded.categories.error || 'Backend API is unavailable.')
  }

  const raw = Object.fromEntries(entries.map(([key, result]) => [key, result.rows])) as Record<keyof typeof endpoints, ApiRecord[]>
  const categoryNames = mapById(raw.categories)
  const unitNames = mapById(raw.units)
  const storeNames = mapById(raw.stores)
  const supplierNames = mapById(raw.vendors)
  const departmentNames = mapById(raw.departments)
  const branchNames = mapById(raw.branches)
  const employeeNames = new Map(raw.employees.map((row) => [idOf(row), text(row.designation, shortId(row.id))]))

  const balanceByItem = firstBy(raw.balances, 'item')
  const balancesByStore = countBy(raw.balances, 'store')
  const itemsByCategory = countBy(raw.items, 'category')
  const itemsByUnit = countBy(raw.items, 'base_unit')
  const priceByItem = firstBy(raw.prices, 'item')
  const itemPrice = new Map(Array.from(priceByItem.entries()).map(([itemId, row]) => [itemId, num(row.unit_price)]))

  const itemNames = mapById(raw.items)
  const itemUnits = new Map(raw.items.map((row) => {
    const itemId = idOf(row)
    const unit = unitNames.get(text(row.base_unit)) || text(row.unit, 'Unit')
    return [itemId, unit]
  }))

  const data: Partial<Record<EntityKey, Row[]>> = {
    categories: raw.categories.map((row) => ({
      id: idOf(row),
      name: text(row.name),
      code: makeCode(row.name, 'CAT'),
      parent: '—',
      itemsCount: itemsByCategory.get(idOf(row)) || 0,
      status: 'Active',
    })),
    uoms: raw.units.map((row) => ({
      id: idOf(row),
      name: text(row.name),
      abbr: text(row.abbreviation),
      code: makeCode(row.abbreviation || row.name, 'UOM'),
      itemsCount: itemsByUnit.get(idOf(row)) || 0,
    })),
    locations: raw.stores.map((row) => ({
      id: idOf(row),
      name: text(row.name),
      branch: branchNames.get(text(row.branch)) || 'Main Property',
      type: bool(row.is_default) ? 'Default' : 'Store',
      itemsCount: balancesByStore.get(idOf(row)) || 0,
      status: activeStatus(row.is_active),
    })),
    suppliers: raw.vendors.map((row) => ({
      id: idOf(row),
      name: text(row.name),
      contact: text(row.contact_person),
      phone: text(row.phone),
      category: 'Vendor',
      rating: 4,
      status: activeStatus(row.is_active),
    })),
  }

  data.items = raw.items.map((row, index) => {
    const itemId = idOf(row)
    const balance = balanceByItem.get(itemId)
    const onHand = num(balance?.quantity_in_stock)
    const reorder = num(balance?.reorder_level, num(row.reorder_level))
    const mapped: Row = {
      id: itemId,
      name: text(row.name),
      sku: text(row.sku, `ITM-${String(index + 1).padStart(3, '0')}`),
      category: categoryNames.get(text(row.category)) || shortId(row.category),
      uom: unitNames.get(text(row.base_unit)) || text(row.unit),
      store: storeNames.get(text(balance?.store)) || '',
      onHand,
      reorder,
      unitCost: itemPrice.get(itemId) || 0,
      status: '',
    }
    mapped.status = itemStatus(mapped)
    return mapped
  })

  data.balances = raw.balances.map((row) => {
    const itemId = text(row.item)
    const onHand = num(row.quantity_in_stock)
    return {
      id: idOf(row),
      item: itemNames.get(itemId) || shortId(itemId),
      store: storeNames.get(text(row.store)) || shortId(row.store),
      onHand,
      reserved: 0,
      available: onHand,
      value: onHand * (itemPrice.get(itemId) || 0),
    }
  })

  data.ledgers = raw.ledgers.map((row) => {
    const quantityIn = num(row.quantity_in)
    const quantityOut = num(row.quantity_out)
    return {
      id: idOf(row),
      date: dateOnly(row.created_at),
      item: itemNames.get(text(row.item)) || shortId(row.item),
      type: quantityIn > 0 ? 'In' : 'Out',
      qty: quantityIn || quantityOut,
      ref: `${titleCaseStatus(row.reference_type)} ${shortId(row.reference_id)}`,
      balance: num(row.net_quantity),
    }
  })

  data.batches = raw.batches.map((row) => ({
    id: idOf(row),
    batch: `BAT-${shortId(row.id)}`,
    item: itemNames.get(text(row.item)) || shortId(row.item),
    qty: num(row.remaining_quantity, num(row.quantity)),
    expiry: dateOnly(row.expiry_date),
    store: storeNames.get(text(row.store)) || shortId(row.store),
    status: expiryStatus(row.expiry_date, row.is_depleted),
  }))

  const reqItemsByRequisition = groupBy(raw.reqItems, 'requisition')
  data.requisitions = raw.requisitions.map((row) => {
    const lines = itemLines(reqItemsByRequisition.get(idOf(row)) || [], itemNames, itemUnits, itemPrice)
    const total = lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0)
    return {
      id: idOf(row),
      date: dateOnly(row.created_at || row.expected_date),
      dept: departmentNames.get(text(row.department)) || titleCaseStatus(row.request_type),
      requester: employeeNames.get(text(row.requester)) || shortId(row.requester),
      status: requisitionStatus(row.status),
      lines,
      count: lines.length,
      total,
    }
  })

  const orderItemsByOrder = groupBy(raw.orderItems, 'purchase_order')
  data.orders = raw.orders.map((row) => {
    const lines = itemLines(orderItemsByOrder.get(idOf(row)) || [], itemNames, itemUnits, itemPrice)
    const total = num(row.total_amount, lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0))
    return {
      id: text(row.po_number, idOf(row)),
      apiId: idOf(row),
      supplier: supplierNames.get(text(row.supplier)) || shortId(row.supplier),
      date: dateOnly(row.created_at || row.expected_date),
      status: purchaseOrderStatus(row.status),
      lines,
      count: lines.length,
      total,
    }
  })

  const orderById = new Map(raw.orders.map((row) => [idOf(row), row]))
  data.grns = raw.grns.map((row) => {
    const order = orderById.get(text(row.purchase_order))
    return {
      id: idOf(row),
      po: order ? text(order.po_number, idOf(order)) : shortId(row.purchase_order),
      supplier: order ? supplierNames.get(text(order.supplier)) || shortId(order.supplier) : '',
      date: dateOnly(row.received_date || row.created_at),
      status: 'Received',
    }
  })

  return {
    data,
    warnings: entries.map(([, result]) => result.error).filter((error): error is string => Boolean(error)),
  }
}

export async function saveBackendRecord(entity: EntityKey, id: string | null, values: Row, data: Record<EntityKey, Row[]>): Promise<void> {
  const endpoint = entityEndpoints[entity]
  if (!endpoint) return

  const payload = toBackendPayload(entity, values, data, Boolean(id))
  await sendJson(id ? `${endpoint}/${id}` : endpoint, id ? 'PATCH' : 'POST', payload)
}

export async function deleteBackendRecord(entity: EntityKey, id: string): Promise<void> {
  const endpoint = entityEndpoints[entity]
  if (!endpoint) return

  await sendJson(`${endpoint}/${id}`, 'DELETE')
}

export async function decideRequisition(requisitionId: string, decision: 'approve' | 'reject'): Promise<void> {
  const approvals = await readList(`approvals?requisition=${encodeURIComponent(requisitionId)}&status=pending`)
  const approval = approvals.sort((a, b) => num(a.stage) - num(b.stage))[0]
  if (!approval) throw new Error('No pending approval workflow was found for this requisition.')

  await sendJson(`approvals/${idOf(approval)}/${decision}`, 'POST', { comments: '' })
}
