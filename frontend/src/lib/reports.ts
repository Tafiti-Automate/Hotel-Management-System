import type { CSSProperties } from 'react'
import type { EntityKey, Row } from './data'
import type { OperationalReportId } from './api'
import { money } from './theme'

export interface ReportCell { text: string; style: CSSProperties }
export interface ReportColumn { label: string; style: CSSProperties }
export interface BuiltReport {
  title: string
  subtitle: string
  grid: string
  columns: ReportColumn[]
  rows: { cells: ReportCell[]; data?: ReportRecord }[]
  hasTotals: boolean
  totals: ReportCell[]
  emptyDetail?: string
}

interface Label { t: string; a?: 'right' }

function head(labels: Label[]): ReportColumn[] {
  return labels.map((l) => ({
    label: l.t,
    style: {
      padding: '9px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-faint)',
      textTransform: 'uppercase', display: 'flex', alignItems: 'center',
      justifyContent: l.a === 'right' ? 'flex-end' : undefined,
    },
  }))
}

function rcell(text: string | number, align?: 'right', bold?: boolean): ReportCell {
  const s: CSSProperties = {
    padding: '11px 10px', fontSize: 12.5, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
  }
  if (align === 'right') { s.justifyContent = 'flex-end'; s.fontWeight = 650; s.color = 'var(--text)' }
  else if (bold) { s.color = 'var(--text)'; s.fontWeight = 700 }
  else s.color = 'var(--text-muted)'
  return { text: String(text), style: s }
}

type ReportRecord = Record<string, unknown>

function records(value: unknown): ReportRecord[] {
  return Array.isArray(value)
    ? value.filter((row): row is ReportRecord => Boolean(row) && typeof row === 'object')
    : []
}

function text(value: unknown, fallback = ''): string {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function title(value: unknown): string {
  return text(value, 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function buildOperationalReport(
  id: OperationalReportId,
  payload: Record<string, unknown>,
): BuiltReport {
  const R: BuiltReport = { title: '', subtitle: '', grid: '', columns: [], rows: [], hasTotals: false, totals: [] }

  // The Materials analysis catalogue describes its own export columns. Keeping
  // that contract data-driven lets new operational reports use the same scoped
  // report workspace without creating browser-only calculations.
  const dynamicColumns = records(payload.columns)
  if (dynamicColumns.length) {
    R.title = text(payload.title, 'Operational report')
    R.subtitle = text(payload.subtitle, 'Live operational records in your permitted scope')
    R.emptyDetail = text(payload.notice, '')
    R.grid = dynamicColumns.map(() => 'minmax(120px, 1fr)').join(' ')
    R.columns = head(dynamicColumns.map((column) => ({ t: text(column.label, title(column.key)), a: column.kind === 'money' || column.kind === 'number' ? 'right' : undefined })))
    R.rows = records(payload.results).map((row) => ({
      data: row,
      cells: dynamicColumns.map((column, index) => {
        const kind = text(column.kind)
        const value = row[text(column.key)]
        const rendered = kind === 'money' && value !== null && value !== undefined && value !== '' ? money(number(value)) : text(value, '—')
        return rcell(rendered, kind === 'money' || kind === 'number' ? 'right' : undefined, index === 0)
      }),
    }))
    return R
  }

  if (id === 'departmentRequests') {
    R.title = 'Department Request Register'; R.subtitle = 'Department stock requests and their current workflow position'
    R.grid = '1.05fr 1fr minmax(0,1.35fr) minmax(0,1.35fr) 1.15fr 80px 1.15fr'
    R.columns = head([{ t: 'Request' }, { t: 'Date' }, { t: 'Department' }, { t: 'Requester' }, { t: 'Store' }, { t: 'Items', a: 'right' }, { t: 'Status' }])
    R.rows = records(payload.results).map((row) => ({ data: row, cells: [
      rcell(text(row.reference), undefined, true), rcell(text(row.date).slice(0, 10)), rcell(text(row.department)),
      rcell(text(row.requester)), rcell(text(row.store, '—')), rcell(number(row.item_count), 'right'), rcell(title(row.status)),
    ] }))
  } else if (id === 'storeIssues') {
    R.title = 'Stock Issue Register'; R.subtitle = 'Stock issues raised against approved department requests'
    R.grid = '1.05fr 1fr 1.05fr minmax(0,1.35fr) 1.15fr 1.2fr 80px 1fr'
    R.columns = head([{ t: 'Issue' }, { t: 'Date' }, { t: 'Request' }, { t: 'Department' }, { t: 'Store' }, { t: 'Issued by' }, { t: 'Items', a: 'right' }, { t: 'Status' }])
    R.rows = records(payload.results).map((row) => ({ data: row, cells: [
      rcell(text(row.reference), undefined, true), rcell(text(row.date).slice(0, 10)), rcell(text(row.request_reference)),
      rcell(text(row.department)), rcell(text(row.store)), rcell(text(row.actor, '—')), rcell(number(row.item_count), 'right'), rcell(title(row.status)),
    ] }))
  } else if (id === 'purchaseRequisitions') {
    R.title = 'Purchase Requisition Register'; R.subtitle = 'Controlled procurement requisitions by department, value and status'
    R.grid = '1.05fr 1fr minmax(0,1.25fr) minmax(0,1.25fr) 80px 120px 1.15fr'
    R.columns = head([{ t: 'Requisition' }, { t: 'Date' }, { t: 'Department' }, { t: 'Requester' }, { t: 'Items', a: 'right' }, { t: 'Value', a: 'right' }, { t: 'Status' }])
    R.rows = records(payload.results).map((row) => ({ data: row, cells: [
      rcell(text(row.reference), undefined, true), rcell(text(row.date).slice(0, 10)), rcell(text(row.department)),
      rcell(text(row.requester)), rcell(number(row.item_count), 'right'), rcell(money(number(row.value)), 'right'), rcell(title(row.status)),
    ] }))
  } else if (id === 'purchaseOrders') {
    R.title = 'LPO Register'; R.subtitle = 'Local Purchase Orders with supplier, value, status and controlled-copy position'
    R.grid = '1fr 1fr minmax(0,1.45fr) minmax(0,1.15fr) 1fr 120px 1fr 1.25fr'
    R.columns = head([{ t: 'LPO' }, { t: 'Date' }, { t: 'Supplier' }, { t: 'Department' }, { t: 'Expected' }, { t: 'Total', a: 'right' }, { t: 'Status' }, { t: 'Controlled output' }])
    R.rows = records(payload.results).map((row) => ({ data: row, cells: [
      rcell(text(row.reference), undefined, true), rcell(text(row.date).slice(0, 10)), rcell(text(row.supplier)),
      rcell(text(row.department, '—')), rcell(text(row.expected_date, '—')), rcell(money(number(row.value)), 'right'),
      rcell(title(row.status)), rcell(text(row.copy_classification, 'ORIGINAL COPY')),
    ] }))
    R.hasTotals = true
    R.totals = [rcell('Total LPO value', undefined, true), rcell(''), rcell(''), rcell(''), rcell(''), rcell(money(number(payload.total_value)), 'right'), rcell(''), rcell('')]
  } else if (id === 'goodsReceipts') {
    R.title = 'GRN Register'; R.subtitle = 'Goods Received Notes with receipt and posting status'
    R.grid = '1fr 1fr 1fr minmax(0,1.45fr) minmax(0,1.25fr) 80px 1fr 1fr'
    R.columns = head([{ t: 'GRN' }, { t: 'Date' }, { t: 'LPO' }, { t: 'Supplier' }, { t: 'Received by' }, { t: 'Items', a: 'right' }, { t: 'Receipt status' }, { t: 'Posting' }])
    R.rows = records(payload.results).map((row) => ({ data: row, cells: [
      rcell(text(row.reference), undefined, true), rcell(text(row.date).slice(0, 10)), rcell(text(row.lpo_reference)),
      rcell(text(row.supplier)), rcell(text(row.actor, '—')), rcell(number(row.item_count), 'right'),
      rcell(title(row.status)), rcell(text(row.posted_at) ? 'Posted' : 'Received'),
    ] }))
  } else if (id === 'valuation') {
    R.title = 'Stock Valuation'; R.subtitle = 'Live weighted-average stock value from inventory batches'
    R.grid = 'minmax(0,1.5fr) 1fr 1.1fr 1.2fr 90px 110px 120px'
    R.columns = head([{ t: 'Item' }, { t: 'SKU' }, { t: 'Category' }, { t: 'Store' }, { t: 'On hand', a: 'right' }, { t: 'Avg cost', a: 'right' }, { t: 'Value', a: 'right' }])
    R.rows = records(payload.results).map((row) => ({ data: row, cells: [
      rcell(text(row.item), undefined, true), rcell(text(row.sku)), rcell(text(row.category)), rcell(text(row.store)),
      rcell(number(row.quantity_in_stock), 'right'), rcell(money(number(row.average_cost)), 'right'), rcell(money(number(row.stock_value)), 'right'),
    ] }))
    R.hasTotals = true
    R.totals = [rcell('Total valuation', undefined, true), rcell(''), rcell(''), rcell(''), rcell(''), rcell(''), rcell(money(number(payload.total_value)), 'right')]
  } else if (id === 'lowstock') {
    R.title = 'Low Stock & Reorder'; R.subtitle = 'Live balances at or below their effective reorder minimum'
    R.grid = 'minmax(0,1.5fr) 1fr 1.2fr 90px 90px 100px minmax(0,1.3fr)'
    R.columns = head([{ t: 'Item' }, { t: 'SKU' }, { t: 'Store' }, { t: 'On hand', a: 'right' }, { t: 'Minimum', a: 'right' }, { t: 'Reorder qty', a: 'right' }, { t: 'Preferred supplier' }])
    R.rows = records(payload.results).map((row) => ({ cells: [
      rcell(text(row.item), undefined, true), rcell(text(row.sku)), rcell(text(row.store)),
      rcell(number(row.quantity_in_stock), 'right'), rcell(number(row.minimum_level), 'right'),
      rcell(number(row.reorder_quantity), 'right'), rcell(text(row.preferred_supplier, '—')),
    ] }))
  } else if (id === 'movement') {
    R.title = 'Stock Card'; R.subtitle = 'Live chronological movements and running balance for one article'
    R.grid = '1.15fr minmax(0,1.35fr) 1.1fr 80px 80px 1.2fr 100px'
    R.columns = head([{ t: 'Date' }, { t: 'Item' }, { t: 'Store' }, { t: 'In', a: 'right' }, { t: 'Out', a: 'right' }, { t: 'Reference' }, { t: 'Balance', a: 'right' }])
    R.rows = records(payload.results).map((row) => ({ cells: [
      rcell(text(row.date).slice(0, 19).replace('T', ' ')), rcell(text(row.item), undefined, true), rcell(text(row.store)),
      rcell(number(row.quantity_in), 'right'), rcell(number(row.quantity_out), 'right'),
      rcell(`${title(row.reference_type)} ${text(row.reference_id).slice(0, 8)}`), rcell(number(row.running_balance), 'right'),
    ] }))
  } else if (id === 'aging') {
    R.title = 'Stock Expiry'; R.subtitle = `Live non-depleted batches expiring by ${text(payload.until, 'the selected date')}`
    R.grid = 'minmax(0,1.5fr) 1fr 1.2fr 100px 110px 110px'
    R.columns = head([{ t: 'Item' }, { t: 'SKU' }, { t: 'Store' }, { t: 'Quantity', a: 'right' }, { t: 'Unit cost', a: 'right' }, { t: 'Expiry' }])
    R.rows = records(payload.results).map((row) => ({ cells: [
      rcell(text(row.item), undefined, true), rcell(text(row.sku)), rcell(text(row.store)),
      rcell(number(row.remaining_quantity), 'right'), rcell(money(number(row.unit_cost)), 'right'), rcell(text(row.expiry_date)),
    ] }))
  } else if (id === 'consumption') {
    R.title = 'Stock Consumption'; R.subtitle = 'Live outbound quantities grouped by article, store and source'
    R.grid = 'minmax(0,1.6fr) 1fr 1.3fr 1.2fr 110px'
    R.columns = head([{ t: 'Item' }, { t: 'SKU' }, { t: 'Store' }, { t: 'Source' }, { t: 'Quantity', a: 'right' }])
    R.rows = records(payload.results).map((row) => ({ cells: [
      rcell(text(row.item), undefined, true), rcell(text(row.sku)), rcell(text(row.store)),
      rcell(title(row.reference_type)), rcell(number(row.total_quantity), 'right'),
    ] }))
  } else if (['dailyActivities', 'pendingActions', 'exceptions', 'userActivity', 'stockMovementControl', 'approvalTrail', 'directWorkspace', 'supplierPriceChanges', 'managementSummary'].includes(id)) {
    const names: Record<string, [string, string]> = {
      dailyActivities: ['Daily Crucial Activities', 'Important system actions completed today or in the selected period'],
      pendingActions: ['Pending Actions', 'Controlled documents still awaiting the next responsible action'],
      exceptions: ['Exception Report', 'Operational exceptions requiring investigation or resolution'],
      userActivity: ['User Activity', 'Important actions grouped by their responsible system actor'],
      stockMovementControl: ['Stock Movement Control', 'Posted inventory movements with source references and responsible actors'],
      approvalTrail: ['Approval Trail', 'Sequential maker-checker decisions, comments and timestamps'],
      directWorkspace: ['Direct-to-Workspace', 'Accepted goods delivered directly to an operating department'],
      supplierPriceChanges: ['Supplier Price Changes', 'Auditable old-to-new supplier price movements'],
      managementSummary: ['Management Summary', 'Current commitments, exceptions and operational risk indicators'],
    }
    ;[R.title, R.subtitle] = names[id]
    R.grid = '1.1fr 1.1fr 1.1fr 1.25fr 1fr 1.2fr 1.2fr 95px minmax(0,1.8fr)'
    R.columns = head([{ t: 'Date' }, { t: 'Document' }, { t: 'Reference' }, { t: 'Action' }, { t: 'Status' }, { t: 'Actor' }, { t: 'Location' }, { t: 'Value', a: 'right' }, { t: 'Detail' }])
    R.rows = records(payload.results).map((row) => ({ data: row, cells: [
      rcell(text(row.date).slice(0, 19).replace('T', ' ')), rcell(title(row.document_type)), rcell(text(row.reference), undefined, true),
      rcell(title(row.action)), rcell(title(row.status)), rcell(text(row.actor, '—')),
      rcell(text(row.store_workspace || row.department || row.branch, '—')),
      rcell(row.value === '' ? '—' : money(number(row.value)), 'right'), rcell(text(row.detail, '—')),
    ] }))
  } else {
    R.title = 'Procurement Status Summary'; R.subtitle = 'Live requisition, purchase-order and supplier-return totals by status'
    R.grid = '1.4fr minmax(0,1.5fr) 100px 140px'
    R.columns = head([{ t: 'Document' }, { t: 'Status' }, { t: 'Count', a: 'right' }, { t: 'Total value', a: 'right' }])
    const groups: Array<[string, ReportRecord[]]> = [
      ['Purchase requisition', records(payload.requisitions)],
      ['Purchase order', records(payload.purchase_orders)],
      ['Supplier return', records(payload.supplier_returns)],
    ]
    R.rows = groups.flatMap(([label, rows]) => rows.map((row) => ({ cells: [
      rcell(label, undefined, true), rcell(title(row.status)), rcell(number(row.count), 'right'),
      rcell(row.total_amount === undefined ? '—' : money(number(row.total_amount)), 'right'),
    ] })))
  }

  return R
}

export function buildReport(id: string, data: Record<EntityKey, Row[]>): BuiltReport {
  const R: BuiltReport = { title: '', subtitle: '', grid: '', columns: [], rows: [], hasTotals: false, totals: [] }

  if (id === 'valuation') {
    R.title = 'Stock Valuation'; R.subtitle = 'Current stock value by item'
    R.grid = 'minmax(0,1.8fr) 1.3fr 100px 110px 130px'
    R.columns = head([{ t: 'Item' }, { t: 'Store' }, { t: 'On hand', a: 'right' }, { t: 'Unit cost', a: 'right' }, { t: 'Value', a: 'right' }])
    let tot = 0
    R.rows = data.items.map((i) => {
      const val = i.onHand * i.unitCost
      tot += val
      return { cells: [rcell(i.name, undefined, true), rcell(i.store), rcell(i.onHand, 'right'), rcell(money(i.unitCost), 'right'), rcell(money(val), 'right')] }
    })
    R.hasTotals = true
    R.totals = [rcell('Total valuation', undefined, true), rcell(''), rcell(''), rcell(''), rcell(money(tot), 'right')]
  } else if (id === 'lowstock') {
    R.title = 'Low Stock & Reorder'; R.subtitle = 'Items at or below reorder level'
    R.grid = 'minmax(0,1.8fr) 1.3fr 100px 100px 120px'
    R.columns = head([{ t: 'Item' }, { t: 'Store' }, { t: 'On hand', a: 'right' }, { t: 'Reorder', a: 'right' }, { t: 'Status', a: 'right' }])
    R.rows = data.items.filter((i) => i.onHand <= i.reorder).map((i) => ({ cells: [rcell(i.name, undefined, true), rcell(i.store), rcell(i.onHand, 'right'), rcell(i.reorder, 'right'), rcell(i.status, 'right')] }))
  } else if (id === 'movement') {
    R.title = 'Stock Movement'; R.subtitle = 'All in / out transactions'
    R.grid = '1.1fr minmax(0,1.6fr) 90px 80px 1.1fr 100px'
    R.columns = head([{ t: 'Date' }, { t: 'Item' }, { t: 'Type' }, { t: 'Qty', a: 'right' }, { t: 'Reference' }, { t: 'Balance', a: 'right' }])
    R.rows = data.ledgers.map((l) => ({ cells: [rcell(l.date), rcell(l.item, undefined, true), rcell(l.type), rcell(l.qty, 'right'), rcell(l.ref), rcell(l.balance, 'right')] }))
  } else if (id === 'aging') {
    R.title = 'Stock Aging & Expiry'; R.subtitle = 'Batches by expiry date'
    R.grid = '1.1fr minmax(0,1.5fr) 80px 1.1fr 1.2fr 110px'
    R.columns = head([{ t: 'Batch' }, { t: 'Item' }, { t: 'Qty', a: 'right' }, { t: 'Expiry' }, { t: 'Store' }, { t: 'Status' }])
    R.rows = data.batches.map((b) => ({ cells: [rcell(b.batch), rcell(b.item, undefined, true), rcell(b.qty, 'right'), rcell(b.expiry), rcell(b.store), rcell(b.status)] }))
  } else if (id === 'req') {
    R.title = 'Requisition Summary'; R.subtitle = 'Requisitions by department and status'
    R.grid = '1.1fr 1.3fr 1.3fr 80px 120px 120px'
    R.columns = head([{ t: 'Requisition' }, { t: 'Department' }, { t: 'Requested by' }, { t: 'Items', a: 'right' }, { t: 'Total', a: 'right' }, { t: 'Status' }])
    R.rows = data.requisitions.map((r) => ({ cells: [rcell(r.id, undefined, true), rcell(r.dept), rcell(r.requester), rcell(r.count, 'right'), rcell(money(r.total), 'right'), rcell(r.status)] }))
  } else if (id === 'po') {
    R.title = 'Purchase Order Summary'; R.subtitle = 'POs by supplier and status'
    R.grid = '1.1fr minmax(0,1.5fr) 1.1fr 80px 120px 120px'
    R.columns = head([{ t: 'PO Number' }, { t: 'Supplier' }, { t: 'Date' }, { t: 'Items', a: 'right' }, { t: 'Total', a: 'right' }, { t: 'Status' }])
    let tot = 0
    R.rows = data.orders.map((o) => {
      tot += o.total
      return { cells: [rcell(o.id, undefined, true), rcell(o.supplier), rcell(o.date), rcell(o.count, 'right'), rcell(money(o.total), 'right'), rcell(o.status)] }
    })
    R.hasTotals = true
    R.totals = [rcell('Total committed', undefined, true), rcell(''), rcell(''), rcell(''), rcell(money(tot), 'right'), rcell('')]
  } else if (id === 'grn') {
    R.title = 'Goods Receipt Report'; R.subtitle = 'GRNs and inspection outcomes'
    R.grid = '1.1fr 1.1fr minmax(0,1.5fr) 1.1fr 120px'
    R.columns = head([{ t: 'GRN' }, { t: 'PO' }, { t: 'Supplier' }, { t: 'Date' }, { t: 'Status' }])
    R.rows = data.grns.map((g) => ({ cells: [rcell(g.id, undefined, true), rcell(g.po), rcell(g.supplier), rcell(g.date), rcell(g.status)] }))
  } else if (id === 'supplier') {
    R.title = 'Supplier Directory'; R.subtitle = 'Supplier contacts and current account status'
    R.grid = 'minmax(0,1.5fr) 1.2fr 1.2fr minmax(0,1.6fr) 110px'
    R.columns = head([{ t: 'Supplier' }, { t: 'Contact person' }, { t: 'Phone' }, { t: 'Email' }, { t: 'Status' }])
    R.rows = data.suppliers.map((s) => ({ cells: [rcell(s.name, undefined, true), rcell(s.contact), rcell(s.phone), rcell(s.email), rcell(s.status)] }))
  } else {
    R.title = 'Consumption by Department'; R.subtitle = 'Issued stock value per department'
    R.grid = 'minmax(0,1.6fr) 140px 160px'
    R.columns = head([{ t: 'Department' }, { t: 'Requisitions', a: 'right' }, { t: 'Issued value', a: 'right' }])
    const agg: Record<string, { n: number; v: number }> = {}
    data.requisitions.forEach((r) => {
      agg[r.dept] = agg[r.dept] || { n: 0, v: 0 }
      agg[r.dept].n++
      agg[r.dept].v += r.total
    })
    R.rows = Object.keys(agg).map((d) => ({ cells: [rcell(d, undefined, true), rcell(agg[d].n, 'right'), rcell(money(agg[d].v), 'right')] }))
  }

  return R
}


// Only explicitly additive, raw monetary fields are aggregated. Unit costs,
// percentages, running balances and quantities with mixed UOMs are not summed.
const summaryAmounts: Record<string, { key: string; label: string }[]> = {
  monthlyStoreBalance: [{key:'opening_value',label:'Opening value'},{key:'variance_value',label:'Variance value'},{key:'closing_value',label:'Closing value'}],
  stockTakeLinewise: [{key:'variance_value',label:'Variance value'},{key:'closing_value',label:'Closing value'}],
  consumptionInventory: [{key:'value',label:'Net recorded cost'}],
  fbBudget: [{key:'budget',label:'Budget cap'},{key:'committed',label:'Purchase commitments'},{key:'remaining',label:'Remaining cap'}],
  purchaseRequisitions: [{ key: 'value', label: 'Requisition value' }],
  purchaseOrders: [{ key: 'value', label: 'LPO value' }],
  valuation: [{ key: 'stock_value', label: 'Stock value' }],
  directWorkspace: [{ key: 'value', label: 'Recorded receipt value' }],
  monthlyReport: [{ key: 'sales', label: 'Sales' }, { key: 'collected', label: 'Collected' }, { key: 'outstanding', label: 'Outstanding' }],
  costOfSalesLocation: [{ key:'sales',label:'Net POS sales' }, { key:'cogs',label:'Recorded COGS' }, {key:'profit',label:'Gross contribution'}],
  warehouseStatistics: [{key:'value',label:'Stock value'}],
  majorGroupLists: [{key:'value',label:'Stock value'}],
  receiptsJournal: [{key:'value',label:'Received value'}],
  supplierInvoices: [{key:'subtotal',label:'Subtotal'}, {key:'tax',label:'Tax'}, {key:'total',label:'Invoice total'}],
}
const groupLabels = ['department', 'store', 'supplier', 'status', 'receipt status', 'posting', 'location', 'category', 'major group', 'document', 'source', 'month', 'group', 'item', 'article', 'reason', 'classification', 'destination']

export function summaryGroupOptions(report: BuiltReport) {
  return report.columns.flatMap((column, index) => groupLabels.includes(column.label.toLowerCase()) ? [{ label: column.label, index }] : [])
}

export function presentReport(source: BuiltReport, reportId: string, search: string, mode: 'detail' | 'summary', groupIndex: number): BuiltReport {
  const tokens = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const rows = source.rows.filter(row => {
    const haystack = row.cells.map(cell => cell.text).join(' ').toLocaleLowerCase()
    return tokens.every(token => haystack.includes(token))
  })
  if (mode === 'detail') {
    return { ...source, rows, hasTotals: source.hasTotals && tokens.length === 0, totals: tokens.length ? [] : source.totals }
  }
  const options = summaryGroupOptions(source)
  const group = options.find(option => option.index === groupIndex) || options[0]
  const lineAmount = rows.some(row => row.data && 'line_value' in row.data)
  const candidates = lineAmount ? [{ key: 'line_value', label: 'Recorded line value' }] : (summaryAmounts[reportId] || [])
  // Stock at a cutoff is a balance, not a flow: never total across months.
  const multipleCutoffs = ['monthlyStoreBalance','stockTakeLinewise'].includes(reportId) && new Set(rows.map(row=>String(row.data?.date ?? ''))).size > 1
  const amounts = multipleCutoffs ? [] : candidates.filter(field => rows.some(row => row.data && field.key in row.data))
  const validAmount = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  const articleGrouped = !multipleCutoffs && group?.label.toLowerCase() === 'article' && rows.every(row => row.data?.article && row.data?.unit)
  const quantities = articleGrouped ? [
    {key:'requested',label:'Requested qty'}, {key:'approved',label:'Approved qty'}, {key:'issued',label:'Issued qty'},
    {key:'deviation',label:'Deviation qty'}, {key:'quantity_in',label:'In'}, {key:'quantity_out',label:'Out'}, {key:'quantity',label:'Quantity'}, {key:'physical_quantity',label:'Physical qty'}, {key:'variance',label:'Variance qty'}, {key:'ordered',label:'Ordered qty'}, {key:'delivered',label:'Delivered qty'}, {key:'accepted',label:'Accepted qty'}, {key:'rejected',label:'Rejected qty'},
  ].filter(field => rows.length && rows.every(row => row.data?.[field.key] != null && row.data[field.key] !== '' && Number.isFinite(Number(row.data[field.key])))) : []
  const groups = new Map<string, {count: number; amounts: number[]; missing: boolean[]; quantities: number[]}>()
  for (const row of rows) {
    const key = articleGrouped ? [row.data?.article, row.data?.sku, row.data?.unit].filter(Boolean).join(' · ') : group ? row.cells[group.index]?.text || 'Not specified' : 'All matching records'
    const bucket = groups.get(key) || {count: 0, amounts: amounts.map(() => 0), missing: amounts.map(() => false), quantities: quantities.map(() => 0)}
    bucket.count += 1
    amounts.forEach((field, i) => { const value = row.data?.[field.key]; if (validAmount(value)) bucket.amounts[i] += Number(value); else bucket.missing[i] = true })
    quantities.forEach((field, i) => { bucket.quantities[i] += Number(row.data?.[field.key]) })
    groups.set(key, bucket)
  }
  return {
    ...source,
    title: source.title + ' — Summary',
    subtitle: 'Grouped report records in the same authorized and filtered scope. ' +
      (amounts.length || quantities.length ? 'Only additive recorded amounts and same-article, same-unit quantities are summarized. Incomplete amounts are not reported as zero.' : 'Record counts only; non-additive quantities, costs and rates are not totaled.'),
    grid: ['minmax(200px, 1.4fr)', 'minmax(100px, .7fr)', ...quantities.map(() => 'minmax(120px, 1fr)'), ...amounts.map(() => 'minmax(140px, 1fr)')].join(' '),
    columns: head([{ t: group?.label || 'Scope' }, { t: 'Records', a: 'right' }, ...quantities.map(field => ({t: field.label, a: 'right' as const})), ...amounts.map(field => ({t: field.label, a: 'right' as const}))]),
    rows: Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([key, bucket]) => ({
      cells: [rcell(key, undefined, true), rcell(bucket.count, 'right'), ...bucket.quantities.map(quantity => rcell(quantity.toFixed(4), 'right')), ...bucket.amounts.map((amount,i) => rcell(bucket.missing[i] ? 'Not available' : money(amount), 'right'))],
    })),
    hasTotals: groups.size > 0,
    totals: [rcell('Total matching records', undefined, true), rcell(rows.length, 'right'),
      ...quantities.map(() => rcell('—', 'right')),
      ...amounts.map((field) => rcell(rows.every(row => validAmount(row.data?.[field.key])) ? money(rows.reduce((total, row) => total + Number(row.data?.[field.key]), 0)) : 'Not available', 'right'))],
  }
}
