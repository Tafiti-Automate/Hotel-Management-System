// Seed data, entity configuration and report definitions ported from the prototype.

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

export const branches = ['Grand Plaza Hotel', 'Seaside Resort & Spa', 'City Center Inn']

export function seedData(): Record<EntityKey, Row[]> {
  const data: Record<EntityKey, Row[]> = {
    items: [
      { id: 'ITM-001', name: 'Basmati Rice 25kg', sku: 'RICE-25', category: 'Food & Beverage', uom: 'Bag', store: 'Main Store', onHand: 4, reorder: 10, unitCost: 38, status: 'Low' },
      { id: 'ITM-002', name: 'Bath Towels (Large)', sku: 'TWL-LG', category: 'Linen & Laundry', uom: 'Piece', store: 'Housekeeping Store', onHand: 18, reorder: 60, unitCost: 6.5, status: 'Critical' },
      { id: 'ITM-003', name: 'Dishwashing Liquid 5L', sku: 'DSH-5L', category: 'Housekeeping', uom: 'Bottle', store: 'Kitchen Store', onHand: 6, reorder: 15, unitCost: 9.2, status: 'Low' },
      { id: 'ITM-004', name: 'Cooking Oil 20L', sku: 'OIL-20', category: 'Food & Beverage', uom: 'Jerrycan', store: 'Main Store', onHand: 2, reorder: 8, unitCost: 41, status: 'Critical' },
      { id: 'ITM-005', name: 'AA Batteries (pack)', sku: 'BAT-AA', category: 'Maintenance', uom: 'Pack', store: 'Maintenance Store', onHand: 22, reorder: 40, unitCost: 3.1, status: 'Low' },
      { id: 'ITM-006', name: 'Toilet Paper (carton)', sku: 'TP-CTN', category: 'Amenities', uom: 'Carton', store: 'Floor 3 Store', onHand: 30, reorder: 24, unitCost: 18, status: 'OK' },
      { id: 'ITM-007', name: 'Bed Sheets Queen', sku: 'SHT-Q', category: 'Linen & Laundry', uom: 'Set', store: 'Housekeeping Store', onHand: 75, reorder: 50, unitCost: 14, status: 'OK' },
      { id: 'ITM-008', name: 'Hand Soap 500ml', sku: 'SOAP-500', category: 'Amenities', uom: 'Bottle', store: 'Main Store', onHand: 120, reorder: 80, unitCost: 2.4, status: 'OK' },
    ],
    categories: [
      { id: 'CAT-01', name: 'Food & Beverage', code: 'FNB', parent: '—', itemsCount: 42, status: 'Active' },
      { id: 'CAT-02', name: 'Housekeeping', code: 'HKP', parent: '—', itemsCount: 28, status: 'Active' },
      { id: 'CAT-03', name: 'Linen & Laundry', code: 'LIN', parent: '—', itemsCount: 19, status: 'Active' },
      { id: 'CAT-04', name: 'Maintenance', code: 'MNT', parent: '—', itemsCount: 23, status: 'Active' },
      { id: 'CAT-05', name: 'Amenities', code: 'AMN', parent: '—', itemsCount: 31, status: 'Active' },
      { id: 'CAT-06', name: 'Utilities', code: 'UTL', parent: '—', itemsCount: 8, status: 'Active' },
    ],
    uoms: [
      { id: 'UOM-01', name: 'Kilogram', abbr: 'kg', code: 'KG', itemsCount: 34 },
      { id: 'UOM-02', name: 'Piece', abbr: 'pc', code: 'PC', itemsCount: 88 },
      { id: 'UOM-03', name: 'Bottle', abbr: 'btl', code: 'BTL', itemsCount: 26 },
      { id: 'UOM-04', name: 'Carton', abbr: 'ctn', code: 'CTN', itemsCount: 19 },
      { id: 'UOM-05', name: 'Bag', abbr: 'bag', code: 'BAG', itemsCount: 12 },
      { id: 'UOM-06', name: 'Litre', abbr: 'L', code: 'LTR', itemsCount: 21 },
    ],
    locations: [
      { id: 'LOC-01', name: 'Main Store', branch: 'Grand Plaza Hotel', type: 'Central', itemsCount: 320, status: 'Active' },
      { id: 'LOC-02', name: 'Kitchen Store', branch: 'Grand Plaza Hotel', type: 'Department', itemsCount: 88, status: 'Active' },
      { id: 'LOC-03', name: 'Housekeeping Store', branch: 'Grand Plaza Hotel', type: 'Department', itemsCount: 64, status: 'Active' },
      { id: 'LOC-04', name: 'Maintenance Store', branch: 'Grand Plaza Hotel', type: 'Department', itemsCount: 47, status: 'Active' },
      { id: 'LOC-05', name: 'Floor 3 Store', branch: 'Grand Plaza Hotel', type: 'Floor', itemsCount: 22, status: 'Active' },
    ],
    suppliers: [
      { id: 'SUP-01', name: 'Fresh Foods Ltd', contact: 'John Adu', phone: '+233 24 111 2222', category: 'Food & Beverage', rating: 4.6, status: 'Active' },
      { id: 'SUP-02', name: 'Sunrise Linens', contact: 'Mary Boateng', phone: '+233 20 333 4444', category: 'Linen & Laundry', rating: 4.2, status: 'Active' },
      { id: 'SUP-03', name: 'CleanPro Supplies', contact: 'Kofi Mensah', phone: '+233 27 555 6666', category: 'Housekeeping', rating: 4.8, status: 'Active' },
      { id: 'SUP-04', name: 'BuildRight Hardware', contact: 'Ama Owusu', phone: '+233 24 777 8888', category: 'Maintenance', rating: 3.9, status: 'Active' },
      { id: 'SUP-05', name: 'AquaServe', contact: 'Yaw Darko', phone: '+233 26 999 0000', category: 'Utilities', rating: 4.1, status: 'On hold' },
      { id: 'SUP-06', name: 'Comfort Amenities', contact: 'Esi Appiah', phone: '+233 20 222 1111', category: 'Amenities', rating: 4.5, status: 'Active' },
    ],
    balances: [
      { id: 'B1', item: 'Basmati Rice 25kg', store: 'Main Store', onHand: 4, reserved: 1, available: 3, value: 152 },
      { id: 'B2', item: 'Bath Towels (Large)', store: 'Housekeeping Store', onHand: 18, reserved: 4, available: 14, value: 117 },
      { id: 'B3', item: 'Cooking Oil 20L', store: 'Main Store', onHand: 2, reserved: 0, available: 2, value: 82 },
      { id: 'B4', item: 'Bed Sheets Queen', store: 'Housekeeping Store', onHand: 75, reserved: 10, available: 65, value: 1050 },
      { id: 'B5', item: 'Hand Soap 500ml', store: 'Main Store', onHand: 120, reserved: 20, available: 100, value: 288 },
      { id: 'B6', item: 'Toilet Paper (carton)', store: 'Floor 3 Store', onHand: 30, reserved: 6, available: 24, value: 540 },
    ],
    ledgers: [
      { id: 'L1', date: '2026-06-16', item: 'Bath Towels (Large)', type: 'In', qty: 200, ref: 'GRN-0188', balance: 218 },
      { id: 'L2', date: '2026-06-15', item: 'Cooking Oil 20L', type: 'Out', qty: 6, ref: 'ISS-0441', balance: 2 },
      { id: 'L3', date: '2026-06-15', item: 'Basmati Rice 25kg', type: 'Out', qty: 8, ref: 'ISS-0440', balance: 4 },
      { id: 'L4', date: '2026-06-14', item: 'Hand Soap 500ml', type: 'In', qty: 144, ref: 'GRN-0186', balance: 120 },
      { id: 'L5', date: '2026-06-13', item: 'Bed Sheets Queen', type: 'In', qty: 100, ref: 'GRN-0185', balance: 75 },
      { id: 'L6', date: '2026-06-12', item: 'AA Batteries (pack)', type: 'Out', qty: 18, ref: 'ISS-0438', balance: 22 },
    ],
    batches: [
      { id: 'BAT-2201', batch: 'BAT-2201', item: 'Basmati Rice 25kg', qty: 40, expiry: '2027-01-10', store: 'Main Store', status: 'Fresh' },
      { id: 'BAT-2198', batch: 'BAT-2198', item: 'Cooking Oil 20L', qty: 20, expiry: '2026-09-30', store: 'Main Store', status: 'Expiring' },
      { id: 'BAT-2195', batch: 'BAT-2195', item: 'Hand Soap 500ml', qty: 144, expiry: '2027-05-01', store: 'Main Store', status: 'Fresh' },
      { id: 'BAT-2190', batch: 'BAT-2190', item: 'Dishwashing Liquid 5L', qty: 30, expiry: '2026-07-20', store: 'Kitchen Store', status: 'Expiring' },
    ],
    requisitions: [
      { id: 'REQ-3125', date: '2026-06-15', dept: 'Housekeeping', requester: 'J. Mensah', status: 'Pending', lines: [{ item: 'Bath Towels (Large)', qty: 200, uom: 'pc', unitCost: 6.5 }, { item: 'Bed Sheets Queen', qty: 100, uom: 'set', unitCost: 14 }, { item: 'Hand Soap 500ml', qty: 500, uom: 'btl', unitCost: 2.4 }] },
      { id: 'REQ-3126', date: '2026-06-15', dept: 'Food & Beverage', requester: 'K. Owusu', status: 'Pending', lines: [{ item: 'Basmati Rice 25kg', qty: 100, uom: 'bag', unitCost: 38 }, { item: 'Cooking Oil 20L', qty: 80, uom: 'jc', unitCost: 41 }, { item: 'Hand Soap 500ml', qty: 200, uom: 'btl', unitCost: 2.4 }] },
      { id: 'REQ-3127', date: '2026-06-14', dept: 'Maintenance', requester: 'A. Boateng', status: 'Pending', lines: [{ item: 'AA Batteries (pack)', qty: 200, uom: 'pack', unitCost: 3.1 }, { item: 'Dishwashing Liquid 5L', qty: 130, uom: 'btl', unitCost: 9.2 }] },
      { id: 'REQ-3120', date: '2026-06-12', dept: 'Food & Beverage', requester: 'K. Owusu', status: 'Approved', lines: [{ item: 'Basmati Rice 25kg', qty: 60, uom: 'bag', unitCost: 38 }, { item: 'Cooking Oil 20L', qty: 22, uom: 'jc', unitCost: 41 }] },
      { id: 'REQ-3118', date: '2026-06-10', dept: 'Amenities', requester: 'E. Appiah', status: 'Approved', lines: [{ item: 'Toilet Paper (carton)', qty: 80, uom: 'ctn', unitCost: 18 }, { item: 'Hand Soap 500ml', qty: 430, uom: 'btl', unitCost: 2.4 }] },
      { id: 'REQ-3115', date: '2026-06-08', dept: 'Housekeeping', requester: 'J. Mensah', status: 'Rejected', lines: [{ item: 'Bath Towels (Large)', qty: 150, uom: 'pc', unitCost: 6.5 }] },
    ],
    orders: [
      { id: 'PO-2041', supplier: 'Fresh Foods Ltd', date: '2026-06-15', status: 'Awaiting GRN', lines: [{ item: 'Basmati Rice 25kg', qty: 200, uom: 'bag', unitCost: 38 }, { item: 'Cooking Oil 20L', qty: 120, uom: 'jc', unitCost: 41 }] },
      { id: 'PO-2039', supplier: 'Sunrise Linens', date: '2026-06-13', status: 'In transit', lines: [{ item: 'Bath Towels (Large)', qty: 600, uom: 'pc', unitCost: 6.5 }, { item: 'Bed Sheets Queen', qty: 300, uom: 'set', unitCost: 14 }] },
      { id: 'PO-2042', supplier: 'BuildRight Hardware', date: '2026-06-15', status: 'Draft', lines: [{ item: 'AA Batteries (pack)', qty: 400, uom: 'pack', unitCost: 3.1 }] },
      { id: 'PO-2035', supplier: 'CleanPro Supplies', date: '2026-06-10', status: 'Completed', lines: [{ item: 'Dishwashing Liquid 5L', qty: 200, uom: 'btl', unitCost: 9.2 }] },
      { id: 'PO-2030', supplier: 'Comfort Amenities', date: '2026-06-08', status: 'Completed', lines: [{ item: 'Toilet Paper (carton)', qty: 120, uom: 'ctn', unitCost: 18 }, { item: 'Hand Soap 500ml', qty: 300, uom: 'btl', unitCost: 2.4 }] },
    ],
    grns: [
      { id: 'GRN-0188', po: 'PO-2039', supplier: 'Sunrise Linens', date: '2026-06-16', status: 'Inspected' },
      { id: 'GRN-0187', po: 'PO-2035', supplier: 'CleanPro Supplies', date: '2026-06-12', status: 'Accepted' },
      { id: 'GRN-0186', po: 'PO-2030', supplier: 'Comfort Amenities', date: '2026-06-09', status: 'Accepted' },
    ],
  }

  // derive count + total for requisitions / orders
  ;(['requisitions', 'orders'] as EntityKey[]).forEach((k) =>
    data[k].forEach((d) => {
      d.count = (d.lines as Line[]).length
      d.total = (d.lines as Line[]).reduce((s, l) => s + l.qty * l.unitCost, 0)
    }),
  )

  return data
}

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
