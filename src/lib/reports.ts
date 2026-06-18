import type { CSSProperties } from 'react'
import type { EntityKey, Row } from './data'
import { money } from './theme'

export interface ReportCell { text: string; style: CSSProperties }
export interface ReportColumn { label: string; style: CSSProperties }
export interface BuiltReport {
  title: string
  subtitle: string
  grid: string
  columns: ReportColumn[]
  rows: { cells: ReportCell[] }[]
  hasTotals: boolean
  totals: ReportCell[]
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
  if (align === 'right') { s.justifyContent = 'flex-end'; s.fontFamily = "'JetBrains Mono',monospace"; s.fontWeight = 700; s.color = 'var(--text)' }
  else if (bold) { s.color = 'var(--text)'; s.fontWeight = 700 }
  else s.color = 'var(--text-muted)'
  return { text: String(text), style: s }
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
    R.title = 'Supplier Performance'; R.subtitle = 'Ratings and status'
    R.grid = 'minmax(0,1.5fr) 1.2fr 1.3fr 90px 120px'
    R.columns = head([{ t: 'Supplier' }, { t: 'Category' }, { t: 'Contact' }, { t: 'Rating', a: 'right' }, { t: 'Status' }])
    R.rows = data.suppliers.map((s) => ({ cells: [rcell(s.name, undefined, true), rcell(s.category), rcell(s.contact), rcell('★ ' + s.rating, 'right'), rcell(s.status)] }))
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
