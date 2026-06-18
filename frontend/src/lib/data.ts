// Entity configuration and report definitions for the stock-management UI.

export type Row = Record<string, any>

export type EntityKey =
  | 'items' | 'categories' | 'uoms' | 'locations' | 'suppliers'
  | 'balances' | 'ledgers' | 'batches'
  | 'requisitions' | 'orders' | 'grns'

export interface Line { item: string; qty: number; uom: string; unitCost: number }

export interface ColumnDef {
  key: string
  label: string
  w: string
  kind: 'bold' | 'mono' | 'text' | 'num' | 'money' | 'money2' | 'status' | 'rating'
  align?: 'right'
}

export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  opts?: string
}

export interface EntityConfig {
  title: string
  sub: string
  icon: string
  add?: string
  singular?: string
  prefix?: string
  editable?: boolean
  detail?: boolean
  cols: ColumnDef[]
  fields?: FieldDef[]
}

export interface ReportCard {
  id: string
  title: string
  desc: string
  icon: string
  grp: string
}

export const branches = ['Backend Property']

export const cfg: Record<string, EntityConfig> = {
  items: {
    title: 'Items', sub: 'All stock items across stores', icon: 'inventory_2', add: 'Add item', singular: 'Item', prefix: 'ITM-', editable: true,
    cols: [
      { key: 'name', label: 'Item', w: 'minmax(0,1.7fr)', kind: 'bold' },
      { key: 'sku', label: 'SKU', w: '1fr', kind: 'mono' },
      { key: 'category', label: 'Category', w: '1.2fr', kind: 'text' },
      { key: 'store', label: 'Store', w: '1.2fr', kind: 'text' },
      { key: 'onHand', label: 'On hand', w: '90px', kind: 'num', align: 'right' },
      { key: 'reorder', label: 'Reorder', w: '90px', kind: 'num', align: 'right' },
      { key: 'unitCost', label: 'Unit cost', w: '100px', kind: 'money2', align: 'right' },
      { key: 'status', label: 'Status', w: '104px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Item name', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'category', label: 'Category', type: 'select', opts: 'categories' },
      { key: 'uom', label: 'Unit of measure', type: 'select', opts: 'uoms' },
      { key: 'store', label: 'Store location', type: 'select', opts: 'locations' },
      { key: 'onHand', label: 'On hand qty', type: 'number' },
      { key: 'reorder', label: 'Reorder level', type: 'number' },
      { key: 'unitCost', label: 'Unit cost ($)', type: 'number' },
    ],
  },
  categories: {
    title: 'Categories', sub: 'Item categories and groupings', icon: 'category', add: 'Add category', singular: 'Category', prefix: 'CAT-', editable: true,
    cols: [
      { key: 'name', label: 'Category', w: 'minmax(0,1.8fr)', kind: 'bold' },
      { key: 'code', label: 'Code', w: '1fr', kind: 'mono' },
      { key: 'parent', label: 'Parent', w: '1.2fr', kind: 'text' },
      { key: 'itemsCount', label: 'Items', w: '90px', kind: 'num', align: 'right' },
      { key: 'status', label: 'Status', w: '110px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Category name', type: 'text' },
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', opts: 'genStatus' },
    ],
  },
  uoms: {
    title: 'Units of Measure', sub: 'Measurement units used for items', icon: 'straighten', add: 'Add unit', singular: 'Unit', prefix: 'UOM-', editable: true,
    cols: [
      { key: 'name', label: 'Unit', w: 'minmax(0,1.6fr)', kind: 'bold' },
      { key: 'abbr', label: 'Abbreviation', w: '1.2fr', kind: 'mono' },
      { key: 'code', label: 'Code', w: '1.2fr', kind: 'mono' },
      { key: 'itemsCount', label: 'Items', w: '110px', kind: 'num', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Unit name', type: 'text' },
      { key: 'abbr', label: 'Abbreviation', type: 'text' },
      { key: 'code', label: 'Code', type: 'text' },
    ],
  },
  locations: {
    title: 'Store Locations', sub: 'Stores and storage points', icon: 'warehouse', add: 'Add location', singular: 'Location', prefix: 'LOC-', editable: true,
    cols: [
      { key: 'name', label: 'Location', w: 'minmax(0,1.5fr)', kind: 'bold' },
      { key: 'branch', label: 'Branch', w: '1.4fr', kind: 'text' },
      { key: 'type', label: 'Type', w: '1fr', kind: 'text' },
      { key: 'itemsCount', label: 'Items', w: '100px', kind: 'num', align: 'right' },
      { key: 'status', label: 'Status', w: '110px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Location name', type: 'text' },
      { key: 'branch', label: 'Branch', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', opts: 'genStatus' },
    ],
  },
  suppliers: {
    title: 'Suppliers', sub: 'Vendors supplying your property', icon: 'local_shipping', add: 'Add supplier', singular: 'Supplier', prefix: 'SUP-', editable: true,
    cols: [
      { key: 'name', label: 'Supplier', w: 'minmax(0,1.5fr)', kind: 'bold' },
      { key: 'contact', label: 'Contact', w: '1.2fr', kind: 'text' },
      { key: 'phone', label: 'Phone', w: '1.3fr', kind: 'mono' },
      { key: 'category', label: 'Category', w: '1.1fr', kind: 'text' },
      { key: 'rating', label: 'Rating', w: '90px', kind: 'rating', align: 'right' },
      { key: 'status', label: 'Status', w: '110px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Supplier name', type: 'text' },
      { key: 'contact', label: 'Contact person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'category', label: 'Category', type: 'select', opts: 'categories' },
      { key: 'status', label: 'Status', type: 'select', opts: 'supStatus' },
    ],
  },
  balances: {
    title: 'Stock Balances', sub: 'Live quantities by item and store', icon: 'equalizer',
    cols: [
      { key: 'item', label: 'Item', w: 'minmax(0,1.7fr)', kind: 'bold' },
      { key: 'store', label: 'Store', w: '1.3fr', kind: 'text' },
      { key: 'onHand', label: 'On hand', w: '100px', kind: 'num', align: 'right' },
      { key: 'reserved', label: 'Reserved', w: '100px', kind: 'num', align: 'right' },
      { key: 'available', label: 'Available', w: '100px', kind: 'num', align: 'right' },
      { key: 'value', label: 'Value', w: '110px', kind: 'money', align: 'right' },
    ],
  },
  ledgers: {
    title: 'Stock Ledgers', sub: 'All stock in / out transactions', icon: 'menu_book',
    cols: [
      { key: 'date', label: 'Date', w: '1.1fr', kind: 'text' },
      { key: 'item', label: 'Item', w: 'minmax(0,1.6fr)', kind: 'bold' },
      { key: 'type', label: 'Type', w: '90px', kind: 'status' },
      { key: 'qty', label: 'Qty', w: '80px', kind: 'num', align: 'right' },
      { key: 'ref', label: 'Reference', w: '1.1fr', kind: 'mono' },
      { key: 'balance', label: 'Balance', w: '90px', kind: 'num', align: 'right' },
    ],
  },
  batches: {
    title: 'Inventory Batches', sub: 'Batch tracking and expiry', icon: 'layers',
    cols: [
      { key: 'batch', label: 'Batch', w: '1.1fr', kind: 'mono' },
      { key: 'item', label: 'Item', w: 'minmax(0,1.6fr)', kind: 'bold' },
      { key: 'qty', label: 'Qty', w: '80px', kind: 'num', align: 'right' },
      { key: 'expiry', label: 'Expiry', w: '1.1fr', kind: 'text' },
      { key: 'store', label: 'Store', w: '1.2fr', kind: 'text' },
      { key: 'status', label: 'Status', w: '100px', kind: 'status', align: 'right' },
    ],
  },
  requisitions: {
    title: 'Requisitions', sub: 'Purchase requisitions from departments', icon: 'request_quote', detail: true,
    cols: [
      { key: 'id', label: 'Requisition', w: '1.1fr', kind: 'mono' },
      { key: 'date', label: 'Date', w: '1fr', kind: 'text' },
      { key: 'dept', label: 'Department', w: '1.2fr', kind: 'text' },
      { key: 'requester', label: 'Requested by', w: '1.2fr', kind: 'text' },
      { key: 'count', label: 'Items', w: '70px', kind: 'num', align: 'right' },
      { key: 'total', label: 'Total', w: '110px', kind: 'money', align: 'right' },
      { key: 'status', label: 'Status', w: '120px', kind: 'status', align: 'right' },
    ],
  },
  approvals: {
    title: 'Approvals', sub: 'Requisitions awaiting your decision', icon: 'approval', detail: true,
    cols: [
      { key: 'id', label: 'Requisition', w: '1.1fr', kind: 'mono' },
      { key: 'date', label: 'Date', w: '1fr', kind: 'text' },
      { key: 'dept', label: 'Department', w: '1.2fr', kind: 'text' },
      { key: 'requester', label: 'Requested by', w: '1.2fr', kind: 'text' },
      { key: 'count', label: 'Items', w: '70px', kind: 'num', align: 'right' },
      { key: 'total', label: 'Total', w: '110px', kind: 'money', align: 'right' },
      { key: 'status', label: 'Status', w: '120px', kind: 'status', align: 'right' },
    ],
  },
  orders: {
    title: 'Purchase Orders', sub: 'Orders raised to suppliers', icon: 'receipt_long', detail: true,
    cols: [
      { key: 'id', label: 'PO Number', w: '1.1fr', kind: 'mono' },
      { key: 'supplier', label: 'Supplier', w: 'minmax(0,1.5fr)', kind: 'text' },
      { key: 'date', label: 'Date', w: '1fr', kind: 'text' },
      { key: 'count', label: 'Items', w: '70px', kind: 'num', align: 'right' },
      { key: 'total', label: 'Total', w: '120px', kind: 'money', align: 'right' },
      { key: 'status', label: 'Status', w: '120px', kind: 'status', align: 'right' },
    ],
  },
  grns: {
    title: 'Goods Receipts', sub: 'Goods received against purchase orders', icon: 'move_to_inbox',
    cols: [
      { key: 'id', label: 'GRN Number', w: '1.1fr', kind: 'mono' },
      { key: 'po', label: 'PO', w: '1.1fr', kind: 'mono' },
      { key: 'supplier', label: 'Supplier', w: 'minmax(0,1.5fr)', kind: 'text' },
      { key: 'date', label: 'Date', w: '1.1fr', kind: 'text' },
      { key: 'status', label: 'Status', w: '120px', kind: 'status', align: 'right' },
    ],
  },
}

export const reports: ReportCard[] = [
  { id: 'valuation', title: 'Stock Valuation', desc: 'Current value of all stock by item and store.', icon: 'savings', grp: 'Inventory' },
  { id: 'lowstock', title: 'Low Stock & Reorder', desc: 'Items at or below their reorder level.', icon: 'warning', grp: 'Inventory' },
  { id: 'movement', title: 'Stock Movement', desc: 'Ledger of all stock in / out transactions.', icon: 'sync_alt', grp: 'Inventory' },
  { id: 'aging', title: 'Stock Aging & Expiry', desc: 'Batches by expiry date and status.', icon: 'schedule', grp: 'Inventory' },
  { id: 'req', title: 'Requisition Summary', desc: 'Requisitions by department and status.', icon: 'request_quote', grp: 'Procurement' },
  { id: 'po', title: 'Purchase Order Summary', desc: 'POs by supplier, value and status.', icon: 'receipt_long', grp: 'Procurement' },
  { id: 'grn', title: 'Goods Receipt Report', desc: 'GRNs and inspection outcomes.', icon: 'move_to_inbox', grp: 'Procurement' },
  { id: 'supplier', title: 'Supplier Performance', desc: 'Ratings, fulfilment and status.', icon: 'local_shipping', grp: 'Vendors' },
  { id: 'consumption', title: 'Consumption by Department', desc: 'Issued stock value per department.', icon: 'pie_chart', grp: 'Analytics' },
]

export function getOptions(key: string, data: Record<EntityKey, Row[]>): string[] {
  if (key === 'categories') return data.categories.map((c) => c.name)
  if (key === 'uoms') return data.uoms.map((u) => u.name)
  if (key === 'locations') return data.locations.map((l) => l.name)
  if (key === 'supStatus') return ['Active', 'On hold', 'Inactive']
  if (key === 'genStatus') return ['Active', 'Inactive']
  return []
}

export function itemStatus(r: Row): string {
  const oh = Number(r.onHand || 0)
  const ro = Number(r.reorder || 0)
  if (ro > 0 && oh <= ro * 0.4) return 'Critical'
  if (oh <= ro) return 'Low'
  return 'OK'
}

export function nextId(entity: EntityKey, data: Record<EntityKey, Row[]>): string {
  const p = cfg[entity].prefix || ''
  let max = 0
  data[entity].forEach((x) => {
    const m = String(x.id).match(/(\d+)$/)
    if (m) max = Math.max(max, +m[1])
  })
  return p + String(max + 1).padStart(3, '0')
}
