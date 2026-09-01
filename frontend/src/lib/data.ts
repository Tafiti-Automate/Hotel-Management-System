// Entity configuration and report definitions for the stock-management UI.

export type Row = Record<string, any>

export type EntityKey =
  | 'items' | 'categories' | 'uoms' | 'itemUnits' | 'locations' | 'suppliers'
  | 'supplierItems'
  | 'departments' | 'employees' | 'branches'
  | 'balances' | 'ledgers' | 'batches'
  | 'reorderRules' | 'storeRequisitions' | 'stockIssues' | 'storeReturns'
  | 'requisitions' | 'orders' | 'grns' | 'inspections' | 'supplierReturns'

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
  type: 'text' | 'password' | 'number' | 'select' | 'date' | 'textarea'
  opts?: string
  hint?: string
  placeholder?: string
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
  source: 'backend' | 'local'
  controlledDocument?: 'lpo' | 'grn'
}

export const cfg: Record<string, EntityConfig> = {
  items: {
    title: 'Items', sub: 'All stock items across stores', icon: 'inventory_2', add: 'Add item', singular: 'Item', prefix: 'ITM-', editable: true,
    cols: [
      { key: 'name', label: 'Item', w: 'minmax(0,1.7fr)', kind: 'bold' },
      { key: 'sku', label: 'SKU', w: '1fr', kind: 'mono' },
      { key: 'categoryPath', label: 'Major / item group', w: '1.35fr', kind: 'text' },
      { key: 'businessType', label: 'Type', w: '1.15fr', kind: 'status' },
      { key: 'store', label: 'Store', w: '1.1fr', kind: 'text' },
      { key: 'onHand', label: 'On hand', w: '90px', kind: 'num', align: 'right' },
      { key: 'reorder', label: 'Reorder', w: '90px', kind: 'num', align: 'right' },
      { key: 'unitCost', label: 'Unit cost', w: '100px', kind: 'money2', align: 'right' },
      { key: 'status', label: 'Status', w: '104px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Item name', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text', placeholder: 'Generated after saving', hint: 'Generated automatically' },
      { key: 'majorGroup', label: 'Major group', type: 'select', opts: 'majorGroups', hint: 'Select the top-level inventory family first.' },
      { key: 'category', label: 'Item group', type: 'select', opts: 'itemGroups', hint: 'Only groups inside the selected Major Group are shown.' },
      { key: 'businessType', label: 'Business classification', type: 'select', opts: 'businessTypes' },
      { key: 'uom', label: 'Base stock unit', type: 'select', opts: 'uoms' },
      { key: 'reorder', label: 'Reorder level', type: 'number' },
    ],
  },
  categories: {
    title: 'Item Grouping', sub: 'Major Group → Item Group → Items', icon: 'account_tree', add: 'Create group', singular: 'Group', prefix: 'CAT-', editable: true,
    cols: [
      { key: 'name', label: 'Group', w: 'minmax(0,1.8fr)', kind: 'bold' },
      { key: 'groupType', label: 'Level', w: '1fr', kind: 'status' },
      { key: 'code', label: 'Code', w: '1fr', kind: 'mono' },
      { key: 'parent', label: 'Major group', w: '1.2fr', kind: 'text' },
      { key: 'itemsCount', label: 'Items', w: '90px', kind: 'num', align: 'right' },
      { key: 'status', label: 'Status', w: '110px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Group name', type: 'text', placeholder: 'e.g. Beverages or Soft Drinks' },
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'parent', label: 'Major group (optional)', type: 'select', opts: 'categoryParents', hint: 'Leave blank to create a Major Group. Select a Major Group to create an Item Group beneath it.' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', opts: 'genStatus' },
    ],
  },
  uoms: {
    title: 'Units of Measure', sub: 'Measurement units used for items', icon: 'straighten', add: 'Add unit', singular: 'Unit', prefix: 'UOM-', editable: true,
    cols: [
      { key: 'name', label: 'Unit', w: 'minmax(0,1.6fr)', kind: 'bold' },
      { key: 'abbr', label: 'Abbreviation', w: '1.2fr', kind: 'mono' },
      { key: 'itemsCount', label: 'Items', w: '110px', kind: 'num', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Unit name', type: 'text' },
      { key: 'abbr', label: 'Abbreviation', type: 'text' },
    ],
  },
  itemUnits: {
    title: 'Article Unit Conversions', sub: 'Controlled purchase and issue units converted into each article’s base stock unit', icon: 'calculate', add: 'Add conversion', singular: 'Article Unit Conversion', editable: true,
    cols: [
      { key: 'item', label: 'Article', w: 'minmax(0,1.5fr)', kind: 'bold' },
      { key: 'sku', label: 'SKU', w: '1fr', kind: 'mono' },
      { key: 'unit', label: 'Selected unit', w: '1fr', kind: 'text' },
      { key: 'role', label: 'Used for', w: '1fr', kind: 'status' },
      { key: 'baseEquivalent', label: 'Base equivalent', w: 'minmax(0,1.4fr)', kind: 'text' },
      { key: 'sellingPrice', label: 'Selling price', w: '110px', kind: 'money2', align: 'right' },
      { key: 'status', label: 'Status', w: '90px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'item', label: 'Article', type: 'select', opts: 'items' },
      { key: 'role', label: 'How this unit is used', type: 'select', opts: 'unitRoles' },
      { key: 'unit', label: 'Purchase, issue, alternate, or base unit', type: 'select', opts: 'uoms' },
      { key: 'conversionFactor', label: 'Number of base units in one selected unit', type: 'number' },
      { key: 'sellingPrice', label: 'Optional selling price per selected unit', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', opts: 'genStatus' },
    ],
  },
  locations: {
    title: 'Store Locations', sub: 'Stores and storage points', icon: 'warehouse', add: 'Add location', singular: 'Location', prefix: 'LOC-', editable: true,
    cols: [
      { key: 'name', label: 'Location', w: 'minmax(0,1.5fr)', kind: 'bold' },
      { key: 'branch', label: 'Branch', w: '1.4fr', kind: 'text' },
      { key: 'type', label: 'Issuing role', w: '1fr', kind: 'status' },
      { key: 'itemsCount', label: 'Items', w: '100px', kind: 'num', align: 'right' },
      { key: 'status', label: 'Status', w: '110px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Location name', type: 'text' },
      { key: 'branch', label: 'Branch', type: 'select', opts: 'branches' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'isDefault', label: 'Default issuing store for this branch', type: 'select', opts: 'yesNo' },
      { key: 'status', label: 'Status', type: 'select', opts: 'genStatus' },
    ],
  },
  suppliers: {
    title: 'Suppliers', sub: 'Vendors supplying your property', icon: 'local_shipping', add: 'Add supplier', singular: 'Supplier', prefix: 'SUP-', editable: true,
    cols: [
      { key: 'name', label: 'Supplier', w: 'minmax(0,1.5fr)', kind: 'bold' },
      { key: 'contact', label: 'Contact', w: '1.2fr', kind: 'text' },
      { key: 'phone', label: 'Phone', w: '1.3fr', kind: 'mono' },
      { key: 'email', label: 'Email', w: 'minmax(0,1.4fr)', kind: 'text' },
      { key: 'paymentTerms', label: 'Payment Terms', w: '1fr', kind: 'text' },
      { key: 'status', label: 'Status', w: '110px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Supplier name', type: 'text' },
      { key: 'contact', label: 'Contact person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text', hint: 'Uganda format: 0701234567 or +256701234567' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'tinNumber', label: 'Tax identification number', type: 'text' },
      { key: 'registrationNumber', label: 'Registration number', type: 'text' },
      { key: 'paymentTerms', label: 'Payment terms', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', opts: 'supStatus' },
    ],
  },
  supplierItems: {
    title: 'Supplier Catalogue', sub: 'Multiple suppliers can quote the same article; Procurement compares their current offers', icon: 'contract', add: 'Add quotation', singular: 'Supplier Quotation', editable: true,
    cols: [
      { key: 'supplier', label: 'Supplier', w: 'minmax(0,1.4fr)', kind: 'bold' },
      { key: 'article', label: 'Article', w: 'minmax(0,1.5fr)', kind: 'text' },
      { key: 'articleSku', label: 'Article SKU', w: '1fr', kind: 'mono' },
      { key: 'category', label: 'Category', w: '1fr', kind: 'text' },
      { key: 'supplierSku', label: 'Supplier Ref.', w: '1fr', kind: 'mono' },
      { key: 'quotationReference', label: 'Quote Ref.', w: '1fr', kind: 'mono' },
      { key: 'unit', label: 'Purchase Unit', w: '1fr', kind: 'text' },
      { key: 'price', label: 'Quoted Price', w: '110px', kind: 'money2', align: 'right' },
      { key: 'pricePosition', label: 'Comparison', w: '95px', kind: 'status' },
      { key: 'minimumOrder', label: 'Minimum', w: '85px', kind: 'num', align: 'right' },
      { key: 'leadTime', label: 'Lead Days', w: '85px', kind: 'num', align: 'right' },
      { key: 'historyCount', label: 'Price changes', w: '90px', kind: 'num', align: 'right' },
      { key: 'status', label: 'Status', w: '90px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'supplier', label: 'Supplier', type: 'select', opts: 'suppliers' },
      { key: 'article', label: 'Article', type: 'select', opts: 'items' },
      { key: 'unit', label: 'Purchase unit', type: 'select', opts: 'uoms' },
      { key: 'supplierSku', label: 'Supplier catalogue reference', type: 'text' },
      { key: 'quotationReference', label: 'Supplier quotation number', type: 'text' },
      { key: 'quotationValidUntil', label: 'Quotation valid until', type: 'date' },
      { key: 'price', label: 'Quoted unit price', type: 'number' },
      { key: 'currency', label: 'Currency', type: 'select', opts: 'currencies', hint: 'UGX is selected by default. Choose the currency stated on the supplier quotation.' },
      { key: 'effectiveFrom', label: 'Effective from', type: 'date' },
      { key: 'minimumOrder', label: 'Minimum order quantity', type: 'number' },
      { key: 'leadTime', label: 'Lead time in days', type: 'number' },
      { key: 'lastQuoted', label: 'Last quoted date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', opts: 'genStatus' },
    ],
  },
  departments: {
    title: 'Departments', sub: 'Hotel departments and operating cost centres', icon: 'account_tree', add: 'Add department', singular: 'Department', prefix: 'DEP-', editable: true,
    cols: [
      { key: 'name', label: 'Department', w: 'minmax(0,1.8fr)', kind: 'bold' },
      { key: 'description', label: 'Description', w: 'minmax(0,2fr)', kind: 'text' },
      { key: 'employeeCount', label: 'Employees', w: '100px', kind: 'num', align: 'right' },
      { key: 'status', label: 'Status', w: '110px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'name', label: 'Department name', type: 'text' },
      { key: 'description', label: 'Purpose and responsibilities', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', opts: 'genStatus' },
    ],
  },
  employees: {
    title: 'Employees', sub: 'Employee profiles, assignments and system access', icon: 'badge', add: 'Register employee', singular: 'Employee', prefix: 'EMP-', editable: true,
    cols: [
      { key: 'name', label: 'Employee', w: 'minmax(0,1.6fr)', kind: 'bold' },
      { key: 'employeeCode', label: 'Employee ID', w: '1fr', kind: 'mono' },
      { key: 'department', label: 'Department', w: '1.2fr', kind: 'text' },
      { key: 'designation', label: 'Job title', w: '1.3fr', kind: 'text' },
      { key: 'contact', label: 'Contact', w: '1.1fr', kind: 'mono' },
      { key: 'dateJoined', label: 'Joined', w: '1fr', kind: 'text' },
      { key: 'status', label: 'Status', w: '100px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'firstName', label: 'First name', type: 'text' },
      { key: 'lastName', label: 'Last name', type: 'text' },
      { key: 'employeeCode', label: 'Employee ID (auto if blank)', type: 'text' },
      { key: 'email', label: 'Work email', type: 'text' },
      { key: 'contact', label: 'Phone number', type: 'text', hint: 'Uganda format: 0701234567 or +256701234567' },
      { key: 'branch', label: 'Branch', type: 'select', opts: 'branches' },
      { key: 'department', label: 'Department', type: 'select', opts: 'departments' },
      { key: 'designation', label: 'Job title', type: 'text' },
      { key: 'gender', label: 'Gender', type: 'select', opts: 'gender' },
      { key: 'dateJoined', label: 'Date joined', type: 'date' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'password', label: 'Temporary password', type: 'password' },
      { key: 'status', label: 'Employment status', type: 'select', opts: 'genStatus' },
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
  reorderRules: {
    title: 'Reorder Rules', sub: 'Low-stock triggers for hotel purchases', icon: 'notification_important', add: 'Add rule', singular: 'Reorder Rule', editable: true,
    cols: [
      { key: 'item', label: 'Item', w: 'minmax(0,1.7fr)', kind: 'bold' },
      { key: 'store', label: 'Store', w: '1.2fr', kind: 'text' },
      { key: 'minimum', label: 'Minimum', w: '90px', kind: 'num', align: 'right' },
      { key: 'onHand', label: 'On hand', w: '90px', kind: 'num', align: 'right' },
      { key: 'reorderQty', label: 'Reorder qty', w: '110px', kind: 'num', align: 'right' },
      { key: 'supplier', label: 'Supplier', w: '1.4fr', kind: 'text' },
      { key: 'status', label: 'Status', w: '110px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'item', label: 'Item', type: 'select', opts: 'items' },
      { key: 'store', label: 'Store', type: 'select', opts: 'locations' },
      { key: 'minimum', label: 'Minimum stock level', type: 'number' },
      { key: 'reorderQty', label: 'Reorder quantity', type: 'number' },
      { key: 'supplier', label: 'Preferred supplier', type: 'select', opts: 'suppliers' },
    ],
  },
  storeRequisitions: {
    title: 'Department Requisitions', sub: 'Create and track department requisitions', icon: 'assignment', add: 'New requisition', singular: 'Department Requisition', editable: true, detail: true,
    cols: [
      { key: 'id', label: 'Request', w: '1.05fr', kind: 'mono' },
      { key: 'date', label: 'Date', w: '100px', kind: 'text' },
      { key: 'department', label: 'Department', w: '1.1fr', kind: 'text' },
      { key: 'itemSummary', label: 'Requested items', w: 'minmax(0,2fr)', kind: 'text' },
      { key: 'count', label: 'Lines', w: '64px', kind: 'num', align: 'right' },
      { key: 'status', label: 'Status', w: '155px', kind: 'status', align: 'right' },
    ],
    fields: [
      { key: 'department', label: 'Department', type: 'select', opts: 'departments' },
      { key: 'store', label: 'Store', type: 'select', opts: 'locations' },
      { key: 'required_date', label: 'Required date', type: 'date' },
      { key: 'purpose', label: 'Purpose', type: 'textarea' },
    ],
  },
  stockIssues: {
    title: 'Stock Issues', sub: 'Approved store requests issued to departments', icon: 'outbox', detail: true,
    cols: [
      { key: 'id', label: 'Issue', w: '1.1fr', kind: 'mono' },
      { key: 'request', label: 'Request', w: '1.1fr', kind: 'mono' },
      { key: 'store', label: 'Store', w: '1.2fr', kind: 'text' },
      { key: 'issuedBy', label: 'Issued by', w: '1.2fr', kind: 'text' },
      { key: 'count', label: 'Items', w: '70px', kind: 'num', align: 'right' },
      { key: 'status', label: 'Status', w: '130px', kind: 'status', align: 'right' },
    ],
  },
  storeReturns: {
    title: 'Store Returns', sub: 'Unused department stock returned to stores', icon: 'assignment_return',
    cols: [
      { key: 'id', label: 'Return', w: '1.1fr', kind: 'mono' },
      { key: 'department', label: 'Department', w: '1.3fr', kind: 'text' },
      { key: 'store', label: 'Store', w: '1.2fr', kind: 'text' },
      { key: 'receivedBy', label: 'Received by', w: '1.2fr', kind: 'text' },
      { key: 'count', label: 'Items', w: '70px', kind: 'num', align: 'right' },
      { key: 'status', label: 'Status', w: '130px', kind: 'status', align: 'right' },
    ],
  },
  requisitions: {
    title: 'Procurement Inbox', sub: 'Store shortages and exceptional purchase requests', icon: 'request_quote', add: 'New purchase request', singular: 'Purchase Request', prefix: 'PR-', editable: true, detail: true,
    cols: [
      { key: 'id', label: 'Requisition', w: '1.1fr', kind: 'mono' },
      { key: 'date', label: 'Date', w: '1fr', kind: 'text' },
      { key: 'sourceLabel', label: 'Source', w: '1.15fr', kind: 'text' },
      { key: 'dept', label: 'Department', w: '1.2fr', kind: 'text' },
      { key: 'count', label: 'Items', w: '70px', kind: 'num', align: 'right' },
      { key: 'total', label: 'Total', w: '110px', kind: 'money', align: 'right' },
      { key: 'status', label: 'Status', w: '120px', kind: 'status', align: 'right' },
    ],
    fields: [
      {
        key: 'procurement_source',
        label: 'Reason for purchase',
        type: 'select',
        opts: 'procurementSources',
        hint: 'Choose the option that best describes why the hotel needs this purchase.',
      },
      {
        key: 'expected_date',
        label: 'Date needed',
        type: 'date',
        hint: 'The date by which the goods or service should be available.',
      },
      {
        key: 'reason',
        label: 'Why is this purchase needed?',
        type: 'textarea',
        placeholder: 'e.g. Replace damaged reception computer',
        hint: 'Briefly explain what is needed and how it will help the hotel.',
      },
      {
        key: 'control_notes',
        label: 'Additional notes (optional)',
        type: 'textarea',
        placeholder: 'Additional purchasing notes',
        hint: 'You can leave this blank if there is nothing else to add.',
      },
      {
        key: 'currency',
        label: 'Payment currency',
        type: 'select',
        opts: 'currencies',
        hint: 'UGX is filled in automatically. Change it only if payment will use another currency.',
      },
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
  inspections: {
    title: 'Goods Inspections', sub: 'Accepted and rejected received goods', icon: 'fact_check',
    cols: [
      { key: 'id', label: 'Inspection', w: '1.1fr', kind: 'mono' },
      { key: 'grn', label: 'GRN', w: '1.1fr', kind: 'mono' },
      { key: 'inspectedBy', label: 'Inspected by', w: '1.2fr', kind: 'text' },
      { key: 'date', label: 'Date', w: '1fr', kind: 'text' },
      { key: 'deliveryNote', label: 'Delivery note', w: '1.2fr', kind: 'mono' },
      { key: 'status', label: 'Status', w: '140px', kind: 'status', align: 'right' },
    ],
  },
  supplierReturns: {
    title: 'Supplier Returns', sub: 'Rejected or damaged goods returned to suppliers', icon: 'keyboard_return',
    cols: [
      { key: 'id', label: 'Return', w: '1.1fr', kind: 'mono' },
      { key: 'supplier', label: 'Supplier', w: 'minmax(0,1.5fr)', kind: 'text' },
      { key: 'store', label: 'Store', w: '1.2fr', kind: 'text' },
      { key: 'returnedBy', label: 'Returned by', w: '1.2fr', kind: 'text' },
      { key: 'date', label: 'Date', w: '1fr', kind: 'text' },
      { key: 'status', label: 'Status', w: '120px', kind: 'status', align: 'right' },
    ],
  },
}

export const reports: ReportCard[] = [
  { id: 'departmentRequests', title: 'Department Request Register', desc: 'Department stock requests, current status and responsible workflow stage.', icon: 'assignment', grp: 'Department & Stores', source: 'backend' },
  { id: 'storeIssues', title: 'Stock Issue Register', desc: 'Stock issued against approved department requests.', icon: 'outbox', grp: 'Department & Stores', source: 'backend' },
  { id: 'purchaseRequisitions', title: 'Purchase Requisition Register', desc: 'Controlled procurement requisitions with department, value and status.', icon: 'request_quote', grp: 'Procurement', source: 'backend' },
  { id: 'purchaseOrders', title: 'LPO Register', desc: 'Local Purchase Orders with supplier, value, status and controlled-copy position.', icon: 'receipt_long', grp: 'Procurement', source: 'backend', controlledDocument: 'lpo' },
  { id: 'goodsReceipts', title: 'GRN Register', desc: 'Goods Received Notes with receipt and posting status.', icon: 'move_to_inbox', grp: 'Receiving', source: 'backend', controlledDocument: 'grn' },
  { id: 'valuation', title: 'Stock Valuation', desc: 'Weighted-average stock value by article and store.', icon: 'savings', grp: 'Inventory', source: 'backend' },
  { id: 'lowstock', title: 'Low Stock & Reorder', desc: 'Balances at or below effective reorder levels.', icon: 'warning', grp: 'Inventory', source: 'backend' },
  { id: 'movement', title: 'Stock Card', desc: 'Chronological movements and running balance for an article.', icon: 'sync_alt', grp: 'Inventory', source: 'backend' },
  { id: 'aging', title: 'Stock Expiry', desc: 'Non-depleted batches expiring within the selected period.', icon: 'schedule', grp: 'Inventory', source: 'backend' },
  { id: 'consumption', title: 'Stock Consumption', desc: 'Outbound quantity by article, store and source.', icon: 'pie_chart', grp: 'Inventory', source: 'backend' },
  { id: 'procurement', title: 'Procurement Status Summary', desc: 'Requisition, LPO and supplier-return totals by status.', icon: 'monitoring', grp: 'Procurement', source: 'backend' },
  { id: 'pendingActions', title: 'Pending Actions', desc: 'Controlled documents still waiting for the next responsible action.', icon: 'pending_actions', grp: 'Control', source: 'backend' },
  { id: 'exceptions', title: 'Exception Report', desc: 'Overdue deliveries, rejected goods, mismatches and stock variances.', icon: 'report_problem', grp: 'Control', source: 'backend' },
  { id: 'stockMovementControl', title: 'Stock Movement Control', desc: 'Posted receipts, issues, returns, transfers and adjustments.', icon: 'swap_vert', grp: 'Inventory', source: 'backend' },
  { id: 'approvalTrail', title: 'Approval Trail', desc: 'Sequential maker-checker decisions, comments and timestamps.', icon: 'approval', grp: 'Control', source: 'backend' },
  { id: 'directWorkspace', title: 'Direct-to-Workspace', desc: 'Accepted goods delivered directly to an operating department.', icon: 'fork_right', grp: 'Receiving', source: 'backend' },
  { id: 'supplierPriceChanges', title: 'Supplier Price Changes', desc: 'Auditable old-to-new supplier price movements.', icon: 'price_change', grp: 'Supplier Control', source: 'backend' },
  { id: 'managementSummary', title: 'Management Summary', desc: 'Current commitments, exceptions and key operational risk indicators.', icon: 'dashboard_customize', grp: 'Management', source: 'backend' },
  { id: 'dailyActivities', title: 'Daily Crucial Activities', desc: 'Important controlled actions completed during the selected period.', icon: 'today', grp: 'Audit', source: 'backend' },
  { id: 'userActivity', title: 'User Activity', desc: 'Important actions grouped by the responsible system actor.', icon: 'manage_accounts', grp: 'Audit', source: 'backend' },
  { id: 'supplier', title: 'Supplier Directory', desc: 'Supplier contacts and current account status.', icon: 'local_shipping', grp: 'Supplier Control', source: 'local' },
]


export function getOptions(key: string, data: Record<EntityKey, Row[]>): string[] {
  if (key === 'categoryParents') return (data.categories || []).filter((category) => !category.parentId).map((category) => category.name)
  if (key === 'majorGroups') return (data.categories || []).filter((category) => !category.parentId).map((category) => category.name)
  if (key === 'categories' || key === 'itemGroups') return (data.categories || []).filter((category) => Boolean(category.parentId)).map((category) => category.name)
  if (key === 'uoms') return (data.uoms || []).map((u) => u.name)
  if (key === 'locations') return (data.locations || []).map((l) => l.name)
  if (key === 'branches') return (data.branches || []).map((branch) => branch.name)
  if (key === 'suppliers') return (data.suppliers || []).map((s) => s.name)
  if (key === 'departments') return (data.departments || []).map((d) => d.name)
  if (key === 'employees') return (data.employees || []).map((e) => e.name)
  if (key === 'items') return (data.items || []).map((i) => i.name)
  if (key === 'businessTypes') return ['Consumable / Operating Expense', 'Resale / Revenue Item', 'Fixed Asset', 'Service']
  if (key === 'unitRoles') return ['Purchase unit', 'Issue unit', 'Alternate unit', 'Base unit']
  if (key === 'reqTypes') return ['department', 'hotel_purchase']
  if (key === 'procurementSources') return ['manual', 'capital_asset', 'emergency', 'project', 'service']
  if (key === 'currencies') return ['UGX', 'KES', 'USD', 'TZS', 'RWF']
  if (key === 'supStatus') return ['Active', 'On hold', 'Inactive']
  if (key === 'genStatus') return ['Active', 'Inactive']
  if (key === 'gender') return ['Female', 'Male']
  if (key === 'yesNo') return ['Yes', 'No']
  return []
}

export function itemStatus(r: Row): string {
  const oh = Number(r.onHand || 0)
  const ro = Number(r.reorder || 0)
  if (ro > 0 && oh <= ro * 0.4) return 'Critical'
  if (oh <= ro) return 'Low'
  return 'OK'
}
