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
  reorderRules: 'reorder-rules',
  storeRequisitions: 'store-requisitions',
  storeReqItems: 'store-requisition-items',
  stockIssues: 'stock-issues',
  stockIssueItems: 'stock-issue-items',
  storeReturns: 'store-returns',
  requisitions: 'requisitions',
  reqItems: 'requisition-items',
  approvals: 'approvals',
  orders: 'purchase-orders',
  orderItems: 'purchase-order-items',
  grns: 'grns',
  inspections: 'goods-inspections',
  supplierReturns: 'supplier-returns',
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
  supplierItems: 'supplier-item-prices',
  requisitions: 'requisitions',
  reorderRules: 'reorder-rules',
  storeRequisitions: 'store-requisitions',
  departments: 'departments',
  employees: 'employees',
}

function apiRoot(): string {
  return (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '')
}

// ---- Auth (DRF token) ----------------------------------------------------

export interface AuthUser {
  id: string
  name: string
  role: string
  username: string
  branch_id?: string
  branch_name?: string
  is_staff?: boolean
  is_superuser?: boolean
  permissions?: string[]
}

export interface HotelRecord {
  id: string
  name: string
  legal_name: string
  business_type: 'single' | 'group'
  registration_number: string
  tax_identification_number: string
  email: string
  phone: string
  alternate_phone: string
  website: string
  logo: string | null
  address: string
  city: string
  country: string
  currency: string
  timezone: string
  is_active: boolean
  branch_count: number
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface NotificationRecord {
  id: string
  employee: string
  title: string
  message: string
  is_read: boolean
  created_at: string
  updated_at: string
}

export interface AccountRecord {
  id: string
  username: string
  email: string
  first_name: string
  last_name: string
  employee_code: string
  phone: string
  is_active: boolean
  is_staff: boolean
  date_joined: string
  last_login: string | null
  role_name: string
}

export interface RoleRecord {
  id: string
  name: string
  permission_ids: number[]
  user_count: number
}

export interface PermissionRecord {
  id: number
  name: string
  codename: string
  app_label: string
  model: string
}

export type HotelInput = Omit<
  HotelRecord,
  'id' | 'logo' | 'branch_count' | 'created_at' | 'updated_at' | 'created_by'
>

const TOKEN_KEY = 'hms_token'
const USER_KEY = 'hms_user'

function readAuthValue(key: string): string | null {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeAuthValue(key: string, value: string | null, remember = true): void {
  try {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
    if (value) {
      const storage = remember ? localStorage : sessionStorage
      storage.setItem(key, value)
    }
  } catch {
    /* storage unavailable */
  }
}

export function getToken(): string | null {
  return readAuthValue(TOKEN_KEY)
}

function setToken(value: string | null, remember = true): void {
  writeAuthValue(TOKEN_KEY, value, remember)
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = readAuthValue(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

function setStoredUser(user: AuthUser | null, remember = true): void {
  writeAuthValue(USER_KEY, user ? JSON.stringify(user) : null, remember)
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Token ${token}` } : {}
}

export async function login(username: string, password: string, remember = true): Promise<AuthUser> {
  const response = await fetch(`${apiRoot()}/auth/login/`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) {
    let detail = `Login failed (${response.status})`
    try {
      const body = await response.json()
      if (body && typeof body.detail === 'string') detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail)
  }

  const body = (await response.json()) as { token: string; user: AuthUser }
  setToken(body.token, remember)
  setStoredUser(body.user, remember)
  return body.user
}

export async function logout(): Promise<void> {
  const headers = { Accept: 'application/json', ...authHeaders() }
  // End the browser session immediately even if the network request is slow.
  setToken(null)
  setStoredUser(null)
  try {
    await fetch(`${apiRoot()}/auth/logout/`, {
      method: 'POST',
      headers,
    })
  } catch {
    /* best-effort server-side invalidation */
  }
}

// --------------------------------------------------------------------------

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
    const response = await fetch(url, { headers: { Accept: 'application/json', ...authHeaders() } })
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

export async function fetchNotifications(): Promise<NotificationRecord[]> {
  return (await readList('notifications?ordering=is_read,-created_at')) as unknown as NotificationRecord[]
}

async function postNotificationAction(path: string): Promise<Response> {
  const response = await fetch(endpointUrl(path), {
    method: 'POST',
    headers: { Accept: 'application/json', ...authHeaders() },
  })
  if (!response.ok) {
    throw new Error(`POST ${path} failed with ${response.status}`)
  }
  return response
}

export async function markNotificationRead(id: string): Promise<NotificationRecord> {
  const response = await postNotificationAction(`notifications/${id}/mark-read`)
  return response.json() as Promise<NotificationRecord>
}

export async function markAllNotificationsRead(): Promise<number> {
  const response = await postNotificationAction('notifications/mark-all-read')
  const body = (await response.json()) as { updated?: number }
  return Number(body.updated || 0)
}

export async function fetchAccounts(): Promise<AccountRecord[]> {
  return (await readList('users?ordering=username')) as unknown as AccountRecord[]
}

export async function fetchRoles(): Promise<RoleRecord[]> {
  return (await readList('roles?ordering=name')) as unknown as RoleRecord[]
}

export async function fetchPermissions(): Promise<PermissionRecord[]> {
  return (await readList('permissions')) as unknown as PermissionRecord[]
}

async function saveAccessRecord<T>(path: string, id: string | null, values: Record<string, unknown>): Promise<T> {
  const method = id ? 'PATCH' : 'POST'
  const response = await fetch(endpointUrl(id ? `${path}/${id}` : path), {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(values),
  })
  if (!response.ok) {
    let body: unknown = null
    try { body = await response.json() } catch { /* non-JSON response */ }
    throw new Error(apiErrorDetail(body, `${method} ${path} failed with ${response.status}`))
  }
  return response.json() as Promise<T>
}

export function saveAccount(id: string | null, values: Record<string, unknown>): Promise<AccountRecord> {
  return saveAccessRecord<AccountRecord>('users', id, values)
}

export function saveRole(id: string | null, values: Record<string, unknown>): Promise<RoleRecord> {
  return saveAccessRecord<RoleRecord>('roles', id, values)
}

function apiErrorDetail(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback
  const record = body as Record<string, unknown>
  if (typeof record.detail === 'string') {
    const blockers = Array.isArray(record.blockers)
      ? record.blockers.filter((item): item is string => typeof item === 'string')
      : []
    return [record.detail, ...blockers].join('\n')
  }

  const messages = Object.entries(record).flatMap(([field, value]) => {
    const items = Array.isArray(value) ? value : [value]
    return items
      .filter((item): item is string => typeof item === 'string')
      .map((item) => `${field.replace(/_/g, ' ')}: ${item}`)
  })
  return messages.join(' ') || fallback
}

export async function fetchHotels(): Promise<HotelRecord[]> {
  return (await readList('hotels')) as unknown as HotelRecord[]
}

export async function saveHotel(id: string | null, values: HotelInput, logo?: File | null): Promise<HotelRecord> {
  const form = new FormData()
  Object.entries(values).forEach(([key, value]) => {
    form.append(key, typeof value === 'boolean' ? String(value) : value)
  })
  if (logo) form.append('logo', logo)

  const method = id ? 'PATCH' : 'POST'
  const response = await fetch(endpointUrl(id ? `hotels/${id}` : 'hotels'), {
    method,
    headers: { Accept: 'application/json', ...authHeaders() },
    body: form,
  })

  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      /* non-JSON error body */
    }
    throw new Error(apiErrorDetail(body, `${method} hotels failed with ${response.status}`))
  }

  return response.json() as Promise<HotelRecord>
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

function toBackendBusinessType(value: unknown): string {
  const raw = text(value).toLowerCase()
  if (raw.includes('resale') || raw.includes('revenue')) return 'resale_revenue'
  if (raw.includes('asset')) return 'fixed_asset'
  if (raw.includes('service')) return 'service'
  return raw || 'consumable_expense'
}

function fromBackendBusinessType(value: unknown): string {
  const raw = text(value, 'consumable_expense')
  if (raw === 'resale_revenue') return 'Resale / Revenue Item'
  if (raw === 'fixed_asset') return 'Fixed Asset'
  if (raw === 'service') return 'Service'
  return 'Consumable / Operating Expense'
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
      uom: itemUnits.get(itemId) || '',
      unitCost,
    }
  })
}

function findDataId(data: Record<EntityKey, Row[]>, entity: EntityKey, value: unknown): string {
  const display = text(value)
  const row = (data[entity] || []).find((candidate) =>
    text(candidate.id) === display ||
    text(candidate.name) === display ||
    text(candidate.abbr) === display ||
    text(candidate.code) === display
  )
  return text(row?.id)
}

function toBackendPayload(entity: EntityKey, values: Row, data: Record<EntityKey, Row[]>): Row {
  if (entity === 'categories') {
    const parentId = findDataId(data, 'categories', values.parent)
    return {
      name: text(values.name),
      code: text(values.code),
      parent: parentId || null,
      description: text(values.description),
      is_active: text(values.status, 'Active') !== 'Inactive',
    }
  }

  if (entity === 'uoms') {
    return {
      name: text(values.name),
      abbreviation: text(values.abbr),
      is_active: true,
    }
  }

  if (entity === 'locations') {
    const branchId = findDataId(data, 'branches', values.branch)
    if (!branchId) throw new Error('Choose a backend branch before saving this store location.')
    return {
      name: text(values.name),
      branch: branchId,
      address: text(values.address),
      is_active: text(values.status, 'Active') !== 'Inactive',
    }
  }

  if (entity === 'suppliers') {
    return {
      name: text(values.name),
      phone: text(values.phone),
      contact_person: text(values.contact),
      email: text(values.email),
      address: text(values.address),
      tin_number: text(values.tinNumber),
      registration_number: text(values.registrationNumber),
      payment_terms: text(values.paymentTerms),
      is_active: text(values.status, 'Active') === 'Active',
    }
  }

  if (entity === 'departments') {
    return {
      name: text(values.name),
      description: text(values.description),
      is_active: text(values.status, 'Active') !== 'Inactive',
    }
  }

  if (entity === 'employees') {
    const departmentId = findDataId(data, 'departments', values.department)
    const branchId = findDataId(data, 'branches', values.branch)
    if (!departmentId) throw new Error('Choose a backend department before registering this employee.')
    const payload: Row = {
      first_name: text(values.firstName),
      last_name: text(values.lastName),
      employee_code: text(values.employeeCode),
      email: text(values.email),
      user_phone: text(values.contact),
      department: departmentId,
      branch: branchId || null,
      designation: text(values.designation),
      gender: text(values.gender),
      contact: text(values.contact),
      address: text(values.address),
      date_joined: text(values.dateJoined) || null,
      is_active: text(values.status, 'Active') !== 'Inactive',
    }
    if (text(values.password)) payload.password = text(values.password)
    return payload
  }

  if (entity === 'supplierItems') {
    const supplierId = findDataId(data, 'suppliers', values.supplier)
    const itemId = findDataId(data, 'items', values.article)
    const unitId = findDataId(data, 'uoms', values.unit)
    if (!supplierId) throw new Error('Choose a supplier before attaching an article.')
    if (!itemId) throw new Error('Choose an article for this supplier.')
    return {
      supplier: supplierId,
      item: itemId,
      unit: unitId || null,
      supplier_sku: text(values.supplierSku),
      unit_price: num(values.price),
      minimum_order_quantity: num(values.minimumOrder) || 1,
      lead_time_days: num(values.leadTime),
      last_quoted_at: text(values.lastQuoted) || null,
      is_preferred: text(values.preferred, 'No') === 'Yes',
      is_active: text(values.status, 'Active') !== 'Inactive',
    }
  }

  if (entity === 'requisitions') {
    const requestType = text(values.request_type, 'department')
    const supplierId = findDataId(data, 'suppliers', values.preferred_supplier || values.supplier)

    const payload: Row = {
      request_type: requestType,
      reason: text(values.reason, 'Purchase request'),
      expected_date: text(values.expected_date) || null,
      control_notes: text(values.control_notes),
    }
    const currency = text(values.currency)
    if (currency) payload.currency = currency.toUpperCase()
    if (supplierId) payload.preferred_supplier = supplierId
    return payload
  }

  if (entity === 'items') {
    const categoryId = findDataId(data, 'categories', values.category)
    if (!categoryId) throw new Error('Choose a backend category before saving this item.')

    const unitId = findDataId(data, 'uoms', values.uom)
    return {
      category: categoryId,
      name: text(values.name),
      sku: text(values.sku),
      unit: text(values.uom),
      base_unit: unitId || null,
      reorder_level: num(values.reorder),
      business_type: toBackendBusinessType(values.businessType),
      is_active: true,
    }
  }

  if (entity === 'reorderRules') {
    const itemId = findDataId(data, 'items', values.item)
    if (!itemId) throw new Error('Choose an item before saving this reorder rule.')
    const storeId = findDataId(data, 'locations', values.store)
    const supplierId = findDataId(data, 'suppliers', values.supplier)
    return {
      item: itemId,
      store: storeId || null,
      minimum_level: num(values.minimum),
      reorder_quantity: num(values.reorderQty),
      preferred_supplier: supplierId || null,
      is_active: text(values.status, 'Active') !== 'Inactive',
    }
  }

  if (entity === 'storeRequisitions') {
    const departmentId = findDataId(data, 'departments', values.department)
    const storeId = findDataId(data, 'locations', values.store)
    const requesterId = findDataId(data, 'employees', values.requester)
    if (!departmentId) throw new Error('Choose a department before saving this store requisition.')
    if (!storeId) throw new Error('Choose a store before saving this store requisition.')
    if (!requesterId) throw new Error('Choose a requester before saving this store requisition.')
    return {
      department: departmentId,
      store: storeId,
      requested_by: requesterId,
      required_date: text(values.required_date) || null,
      purpose: text(values.purpose, 'Department stock request'),
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
      ...authHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      /* non-JSON response */
    }
    throw new Error(apiErrorDetail(body, `The operation could not be completed (${response.status}).`))
  }

  if (response.status === 204) return null
  return response.json()
}

export async function readBackendRecords(path: string): Promise<Row[]> {
  return (await readList(path)) as Row[]
}

export async function createBackendRecord(path: string, body: Row): Promise<Row> {
  return (await sendJson(path, 'POST', body)) as Row
}

export async function updateBackendRecord(path: string, id: string, body: Row): Promise<Row> {
  return (await sendJson(`${path}/${id}`, 'PATCH', body)) as Row
}

export async function runBackendAction(path: string, id: string, action: string, body: Row = {}): Promise<Row> {
  return (await sendJson(`${path}/${id}/${action}`, 'POST', body)) as Row
}

export async function fetchBackendData(): Promise<BackendDataResult> {
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, endpoint]) => [key, await safeRead(endpoint)] as const),
  )

  const errors = entries
    .filter(([, result]) => result.error)
    .map(([key, result]) => `${key}: ${result.error}`)
  if (errors.length === entries.length) {
    if (errors.every((error) => /\b401\b/.test(error))) {
      throw new Error('Your sign-in session is no longer valid (401).')
    }
    throw new Error(`Backend data could not be fully loaded. ${errors.join(' ')}`)
  }

  const raw = Object.fromEntries(entries.map(([key, result]) => [key, result.rows])) as Record<keyof typeof endpoints, ApiRecord[]>
  const categoryNames = mapById(raw.categories)
  const unitNames = mapById(raw.units)
  const storeNames = mapById(raw.stores)
  const supplierNames = mapById(raw.vendors)
  const departmentNames = mapById(raw.departments)
  const branchNames = mapById(raw.branches)
  const employeeNames = new Map(raw.employees.map((row) => {
    const fullName = `${text(row.first_name)} ${text(row.last_name)}`.trim()
    return [idOf(row), fullName || text(row.designation, shortId(row.id))]
  }))
  const employeeBranches = new Map(raw.employees.map((row) => [idOf(row), text(row.branch)]))
  const storeBranches = new Map(raw.stores.map((row) => [idOf(row), text(row.branch)]))

  const balanceByItem = firstBy(raw.balances, 'item')
  const balancesByStore = countBy(raw.balances, 'store')
  const itemsByUnit = countBy(raw.items, 'base_unit')
  const priceByItem = firstBy(raw.prices, 'item')
  const itemPrice = new Map(Array.from(priceByItem.entries()).map(([itemId, row]) => [itemId, num(row.unit_price)]))

  const itemNames = mapById(raw.items)
  const itemUnits = new Map(raw.items.map((row) => {
    const itemId = idOf(row)
    const unit = unitNames.get(text(row.base_unit)) || text(row.unit)
    return [itemId, unit]
  }))

  const data: Partial<Record<EntityKey, Row[]>> = {
    branches: raw.branches.map((row) => ({
      id: idOf(row),
      name: text(row.name),
      code: text(row.branch_code),
      status: activeStatus(row.is_active),
    })),
    departments: raw.departments.map((row) => ({
      id: idOf(row),
      name: text(row.name, shortId(row.id)),
      description: text(row.description),
      employeeCount: raw.employees.filter((employee) => text(employee.department) === idOf(row)).length,
      status: activeStatus(row.is_active),
    })),
    employees: raw.employees.map((row) => ({
      id: idOf(row),
      name: `${text(row.first_name)} ${text(row.last_name)}`.trim() || text(row.designation, shortId(row.id)),
      firstName: text(row.first_name),
      lastName: text(row.last_name),
      employeeCode: text(row.employee_code),
      email: text(row.email),
      department: text(row.department_name) || departmentNames.get(text(row.department)) || shortId(row.department),
      branch: text(row.branch_name) || branchNames.get(text(row.branch)) || '',
      branchId: text(row.branch),
      designation: text(row.designation),
      gender: text(row.gender),
      contact: text(row.contact) || text(row.user_phone),
      address: text(row.address),
      dateJoined: text(row.date_joined),
      status: activeStatus(row.is_active),
    })),
    categories: raw.categories.map((row) => ({
      id: idOf(row),
      name: text(row.name),
      code: text(row.code),
      parent: text(row.parent_name) || categoryNames.get(text(row.parent)) || '—',
      description: text(row.description),
      childrenCount: num(row.children_count),
      itemsCount: num(row.item_count),
      status: activeStatus(row.is_active),
    })),
    uoms: raw.units.map((row) => ({
      id: idOf(row),
      name: text(row.name),
      abbr: text(row.abbreviation),
      itemsCount: itemsByUnit.get(idOf(row)) || 0,
    })),
    locations: raw.stores.map((row) => ({
      id: idOf(row),
      name: text(row.name),
      branch: branchNames.get(text(row.branch)) || '',
      branchId: text(row.branch),
      type: bool(row.is_default) ? 'Default' : 'Store',
      itemsCount: balancesByStore.get(idOf(row)) || 0,
      status: activeStatus(row.is_active),
    })),
    suppliers: raw.vendors.map((row) => ({
      id: idOf(row),
      name: text(row.name),
      contact: text(row.contact_person),
      phone: text(row.phone),
      email: text(row.email),
      address: text(row.address),
      tinNumber: text(row.tin_number),
      registrationNumber: text(row.registration_number),
      paymentTerms: text(row.payment_terms),
      status: activeStatus(row.is_active),
    })),
    supplierItems: raw.prices.map((row) => ({
      id: idOf(row),
      supplier: text(row.supplier_name) || supplierNames.get(text(row.supplier)) || shortId(row.supplier),
      article: text(row.item_name) || itemNames.get(text(row.item)) || shortId(row.item),
      articleSku: text(row.item_sku),
      supplierSku: text(row.supplier_sku),
      unit: text(row.unit_name) || unitNames.get(text(row.unit)) || '',
      price: num(row.unit_price),
      minimumOrder: num(row.minimum_order_quantity),
      leadTime: num(row.lead_time_days),
      lastQuoted: text(row.last_quoted_at),
      preferred: bool(row.is_preferred) ? 'Preferred' : 'Alternative',
      status: activeStatus(row.is_active),
    })),
  }

  data.items = raw.items.map((row) => {
    const itemId = idOf(row)
    const balance = balanceByItem.get(itemId)
    const onHand = num(balance?.quantity_in_stock)
    const reorder = num(balance?.reorder_level, num(row.reorder_level))
    const mapped: Row = {
      id: itemId,
      name: text(row.name),
      sku: text(row.sku),
      category: categoryNames.get(text(row.category)) || shortId(row.category),
      businessType: fromBackendBusinessType(row.business_type),
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
      category: categoryNames.get(text(raw.items.find((item) => idOf(item) === itemId)?.category)) || '',
      store: storeNames.get(text(row.store)) || shortId(row.store),
      onHand,
      reserved: num(row.quantity_reserved),
      available: num(row.available_quantity, onHand - num(row.quantity_reserved)),
      value: onHand * (itemPrice.get(itemId) || 0),
      branchId: storeBranches.get(text(row.store)) || '',
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
      branchId: storeBranches.get(text(row.store)) || '',
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
    branchId: storeBranches.get(text(row.store)) || '',
  }))

  data.reorderRules = raw.reorderRules.map((row) => {
    const itemId = text(row.item)
    const storeId = text(row.store)
    const balance = raw.balances.find((b) => text(b.item) === itemId && (!storeId || text(b.store) === storeId))
    const onHand = num(balance?.quantity_in_stock)
    const minimum = num(row.minimum_level)
    return {
      id: idOf(row),
      item: itemNames.get(itemId) || shortId(itemId),
      store: storeNames.get(storeId) || '',
      minimum,
      onHand,
      reorderQty: num(row.reorder_quantity),
      supplier: supplierNames.get(text(row.preferred_supplier)) || '',
      status: bool(row.is_active) ? (onHand <= minimum ? 'Low' : 'Active') : 'Inactive',
      branchId: storeBranches.get(storeId) || '',
    }
  })

  data.storeRequisitions = raw.storeRequisitions.map((row) => ({
    id: text(row.requisition_no, idOf(row)),
    apiId: idOf(row),
    department: departmentNames.get(text(row.department)) || shortId(row.department),
    store: storeNames.get(text(row.store)) || shortId(row.store),
    requester: employeeNames.get(text(row.requested_by)) || shortId(row.requested_by),
    required_date: dateOnly(row.required_date),
    purpose: text(row.purpose),
    count: (raw.storeReqItems || []).filter((item) => text(item.requisition) === idOf(row)).length,
    status: titleCaseStatus(row.status),
    branchId: storeBranches.get(text(row.store)) || '',
  }))

  data.stockIssues = raw.stockIssues.map((row) => ({
    id: text(row.issue_no, idOf(row)),
    apiId: idOf(row),
    request: shortId(row.requisition),
    store: storeNames.get(text(row.store)) || shortId(row.store),
    issuedBy: employeeNames.get(text(row.issued_by)) || shortId(row.issued_by),
    count: (raw.stockIssueItems || []).filter((item) => text(item.issue) === idOf(row)).length,
    status: bool(row.inventory_changes_applied) ? 'Applied' : 'Pending',
    branchId: storeBranches.get(text(row.store)) || '',
  }))

  data.storeReturns = raw.storeReturns.map((row) => ({
    id: text(row.return_no, idOf(row)),
    apiId: idOf(row),
    department: departmentNames.get(text(row.department)) || shortId(row.department),
    store: storeNames.get(text(row.store)) || shortId(row.store),
    receivedBy: employeeNames.get(text(row.received_by)) || shortId(row.received_by),
    date: dateOnly(row.return_date),
    status: bool(row.inventory_changes_applied) ? 'Applied' : 'Pending',
    branchId: storeBranches.get(text(row.store)) || '',
  }))

  const reqItemsByRequisition = groupBy(raw.reqItems, 'requisition')
  data.requisitions = raw.requisitions.map((row) => {
    const lines = itemLines(reqItemsByRequisition.get(idOf(row)) || [], itemNames, itemUnits, itemPrice)
    const total = lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0)
    const approvalSteps = Array.isArray(row.approval_steps)
      ? row.approval_steps.map((step) => {
          const record = step as ApiRecord
          return {
            stage: num(record.stage),
            stageName: text(record.stage_name, `Stage ${text(record.stage)}`),
            approverName: text(record.approver_name, 'Unassigned approver'),
            status: text(record.status, 'pending'),
            comments: text(record.comments),
            decidedAt: text(record.decided_at),
            isActionable: bool(record.is_actionable),
          }
        })
      : []
    const awaitingApproval = approvalSteps.find((step) => step.isActionable)
    return {
      id: text(row.requisition_number, idOf(row)),
      apiId: idOf(row),
      date: dateOnly(row.created_at || row.expected_date),
      request_type: text(row.request_type, 'department'),
      branch: branchNames.get(text(row.branch)) || '',
      dept: departmentNames.get(text(row.department)) || titleCaseStatus(row.request_type),
      department: departmentNames.get(text(row.department)) || '',
      requester: employeeNames.get(text(row.requester)) || shortId(row.requester),
      preferred_supplier: supplierNames.get(text(row.preferred_supplier)) || '',
      expected_date: dateOnly(row.expected_date),
      reason: text(row.reason),
      control_notes: text(row.control_notes),
      currency: text(row.currency, 'UGX'),
      status: requisitionStatus(row.status),
      statusCode: text(row.status),
      approvalSteps,
      awaitingApproval,
      approvalActionable: raw.approvals.some(
        (approval) =>
          text(approval.requisition) === idOf(row)
          && text(approval.status) === 'pending'
          && bool(approval.is_actionable),
      ),
      lines,
      count: lines.length,
      total,
      branchId: text(row.branch) || employeeBranches.get(text(row.requester)) || '',
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
      branchId: storeBranches.get(text(row.store)) || employeeBranches.get(text(row.ordered_by)) || '',
    }
  })

  const orderById = new Map(raw.orders.map((row) => [idOf(row), row]))
  data.grns = raw.grns.map((row) => {
    const order = orderById.get(text(row.purchase_order))
    return {
      id: text(row.grn_number, idOf(row)),
      apiId: idOf(row),
      po: order ? text(order.po_number, idOf(order)) : shortId(row.purchase_order),
      supplier: order ? supplierNames.get(text(order.supplier)) || shortId(order.supplier) : '',
      date: dateOnly(row.received_date || row.created_at),
      status: 'Received',
      branchId: order ? storeBranches.get(text(order.store)) || '' : '',
    }
  })

  data.inspections = raw.inspections.map((row) => ({
    id: idOf(row),
    grn: shortId(row.goods_receipt),
    inspector: employeeNames.get(text(row.inspected_by)) || shortId(row.inspected_by),
    date: dateOnly(row.inspection_date),
    deliveryNote: text(row.delivery_note_no),
    status: titleCaseStatus(row.status),
    branchId: (() => {
      const receipt = raw.grns.find((grn) => idOf(grn) === text(row.goods_receipt))
      const order = receipt ? orderById.get(text(receipt.purchase_order)) : undefined
      return order ? storeBranches.get(text(order.store)) || '' : ''
    })(),
  }))

  data.supplierReturns = raw.supplierReturns.map((row) => ({
    id: text(row.return_no, idOf(row)),
    apiId: idOf(row),
    supplier: supplierNames.get(text(row.supplier)) || shortId(row.supplier),
    store: storeNames.get(text(row.store)) || shortId(row.store),
    returnedBy: employeeNames.get(text(row.returned_by)) || shortId(row.returned_by),
    date: dateOnly(row.return_date),
    status: titleCaseStatus(row.status),
    branchId: storeBranches.get(text(row.store)) || '',
  }))

  return {
    data,
    warnings: entries.map(([, result]) => result.error).filter((error): error is string => Boolean(error)),
  }
}

export async function saveBackendRecord(entity: EntityKey, id: string | null, values: Row, data: Record<EntityKey, Row[]>): Promise<Row> {
  const endpoint = entityEndpoints[entity]
  if (!endpoint) throw new Error(`Backend saving is not configured for ${entity}.`)

  const payload = toBackendPayload(entity, values, data)
  return (await sendJson(id ? `${endpoint}/${id}` : endpoint, id ? 'PATCH' : 'POST', payload)) as Row
}

export async function deleteBackendRecord(entity: EntityKey, id: string): Promise<void> {
  const endpoint = entityEndpoints[entity]
  if (!endpoint) throw new Error(`Backend deletion is not configured for ${entity}.`)

  await sendJson(`${endpoint}/${id}`, 'DELETE')
}

export async function deleteBackendPath(path: string, id: string): Promise<void> {
  await sendJson(`${path}/${id}`, 'DELETE')
}

export async function uploadProcurementAttachment(
  documentType: string,
  documentId: string,
  category: string,
  file: File,
): Promise<Row> {
  const form = new FormData()
  form.append('document_type', documentType)
  form.append('document_id', documentId)
  form.append('category', category)
  form.append('file', file)
  const response = await fetch(endpointUrl('procurement-attachments'), {
    method: 'POST',
    headers: { Accept: 'application/json', ...authHeaders() },
    body: form,
  })
  if (!response.ok) {
    let body: unknown = null
    try { body = await response.json() } catch { /* non-JSON response */ }
    throw new Error(apiErrorDetail(body, `Upload failed (${response.status}).`))
  }
  return response.json() as Promise<Row>
}

export async function downloadProcurementAttachment(id: string, originalName: string): Promise<void> {
  const response = await fetch(endpointUrl(`procurement-attachments/${id}/download`), {
    headers: { Accept: '*/*', ...authHeaders() },
  })
  if (!response.ok) {
    let body: unknown = null
    try { body = await response.json() } catch { /* non-JSON response */ }
    throw new Error(apiErrorDetail(body, `Download failed (${response.status}).`))
  }

  const blobUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = originalName || 'supporting-document'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000)
}

export async function decideRequisition(
  requisitionId: string,
  decision: 'approve' | 'reject' | 'return-for-correction',
  comments = '',
): Promise<void> {
  const approvals = await readList(`approvals?requisition=${encodeURIComponent(requisitionId)}&status=pending`)
  const approval = approvals.sort((a, b) => num(a.stage) - num(b.stage))[0]
  if (!approval) throw new Error('No pending approval workflow was found for this requisition.')

  await sendJson(`approvals/${idOf(approval)}/${decision}`, 'POST', { comments })
}
