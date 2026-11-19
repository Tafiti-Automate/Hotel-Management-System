import type { Row } from '../lib/data'
import type { HotelRecord } from '../lib/api'

/**
 * Lake Victoria Serena-style Goods Received Note (PURCHASE ORDER RECEIVING).
 * A4 landscape specimen layout, with real per-property and per-GRN information.
 *
 * The initial count remains blind; after locking, the backend exposes the
 * approved LPO price and VAT snapshot for the printable GRN.
 */
export type GrnComparisonLine = {
  purchase_order_item: string
  article: string
  sku: string
  unit: string
  ordered_quantity: string
  due_before_delivery?: string
  counted_quantity: string
  accepted_quantity: string
  rejected_quantity: string
  short_quantity: string
  excess_quantity: string
  outstanding_after_inspection: string
}

export interface GrnReferenceDocumentProps {
  receipt: Row
  lines: Row[]
  hotel?: HotelRecord | null
  propertyName: string
  preparedBy: string
  items?: Row[]
  departments?: Row[]
  comparison?: { lines: GrnComparisonLine[]; has_variance?: boolean } | null
}

const str = (value: unknown) => String(value ?? '').trim()
const decimal = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
const qty = (value: unknown) =>
  decimal(value).toLocaleString('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const cash = (value: number) =>
  value.toLocaleString('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (value: number | null) => value === null ? '—' : cash(value)
const roundCents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

const dateOnly = (value: unknown) => {
  const raw = str(value)
  if (!raw) return '—'
  const date = new Date(raw.slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).replaceAll('/', '.')
}

const stamp = (value: unknown) => {
  const raw = str(value)
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).replaceAll('/', '.') + '  ' + date.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function getLines(
  lines: Row[], comparison: GrnReferenceDocumentProps['comparison'], items: Row[],
) {
  const byPo = new Map(lines.map(line => [str(line.purchase_order_item), line]))
  const rows: Row[] = comparison?.lines
    ? comparison.lines.map((detail) => ({
        ...(byPo.get(detail.purchase_order_item) ?? {}),
        purchase_order_item: detail.purchase_order_item,
        item_name: detail.article,
        item_sku: detail.sku,
        unit_abbreviation: detail.unit,
        ordered_quantity: detail.ordered_quantity,
        due_before_delivery: detail.due_before_delivery,
        quantity_received: detail.counted_quantity,
        accepted_quantity: detail.accepted_quantity,
        rejected_quantity: detail.rejected_quantity,
        short_quantity: detail.short_quantity,
        excess_quantity: detail.excess_quantity,
      }))
    : lines

  return rows.map((line) => {
    const article = items.find(item => str(item.id) === str(line.item))
    const actual = decimal(line.quantity_received)
    const accepted = decimal(line.accepted_quantity ?? line.quantity_received)
    const rejected = decimal(line.rejected_quantity)
    const hasOrdered = line.ordered_quantity !== undefined && line.ordered_quantity !== null
      && str(line.ordered_quantity) !== ''
    const due = hasOrdered ? decimal(line.due_before_delivery ?? line.ordered_quantity) : null
    const costKnown = line.unit_cost !== undefined && line.unit_cost !== null
      && str(line.unit_cost) !== ''
    const price = costKnown ? decimal(line.unit_cost) : null
    const baseRate = line.vat_percent ?? line.vat_rate
    const vatRaw = baseRate ?? 0 // Never assume VAT on a non-VAT article.
    const vatPercent = decimal(vatRaw) <= 1 ? decimal(vatRaw) * 100 : decimal(vatRaw)
    const net = price === null ? null : roundCents(accepted * price)
    const vat = net === null ? null : roundCents(net * vatPercent / 100)
    let articleStatus = '—'
    if (rejected > 0) articleStatus = 'Rejected'
    else if (due !== null && actual < due) articleStatus = 'UD'
    else if (due !== null && actual > due) articleStatus = 'Excess'
    return {
      key: str(line.id || line.purchase_order_item),
      article: str(line.item_name || article?.name || line.item || 'Article'),
      sku: str(line.item_sku || article?.sku),
      batch: str(line.batch_number),
      expiry: line.expiry_date ? dateOnly(line.expiry_date) : '',
      unit: str(line.unit_abbreviation || line.unit_name || article?.uom || article?.unit || 'Each'),
      ordered: hasOrdered ? qty(line.ordered_quantity) : '—', delivered: qty(actual),
      price: money(price), net: money(net),
      vatPercent: vatPercent.toFixed(0) + '%',
      gross: money(net === null || vat === null ? null : roundCents(net + vat)),
      netNumber: net, vatNumber: vat, status: articleStatus,
    }
  })
}

export default function GrnReferenceDocument({
  receipt, lines, hotel, propertyName, preparedBy, items = [],
  comparison,
}: GrnReferenceDocumentProps) {
  const entries = getLines(lines, comparison, items)
  const priced = entries.length > 0 && entries.every(row => row.netNumber !== null)
  const netTotal = priced ? roundCents(entries.reduce((s, row) => s + (row.netNumber ?? 0), 0)) : null
  const vatTotal = priced ? roundCents(entries.reduce((s, row) => s + (row.vatNumber ?? 0), 0)) : null
  const grandTotal = netTotal === null || vatTotal === null ? null : roundCents(netTotal + vatTotal)
  const receiptStatus = str(receipt.status).toLowerCase()
  const posted = receiptStatus === 'posted'
  const propertyLabel = str(hotel?.name) || str(propertyName) ||
    str(hotel?.legal_name) || 'Hotel Property'
  const partial = entries.some(line => line.status === 'UD' || line.status === 'Rejected')
    || Boolean(comparison?.has_variance)
    || /partial delivery/i.test(str(receipt.note))
  const statusNote = partial
    ? "Status: UD- Partial Delivery * only for LPO's not closed *"
    : "Status: " + (posted ? 'Posted to Stock on Hand' : 'Received - Awaiting Stores verification')

  return (
    <article className="grn-reference-page" role="document"
      aria-label={'Goods Received Note ' + str(receipt.grn_number)}>
      <header className="grn-reference-top">
        <div className="grn-reference-document-heading">
          <strong>{propertyLabel}</strong>
          <span>(PURCHASE ORDER RECEIVING)</span>
        </div>
        <div className="grn-reference-supplier-address">
          <strong>{str(receipt.supplier_name) || 'Supplier'}</strong>
          {receipt.supplier_address && <span>{str(receipt.supplier_address)}</span>}
          {receipt.supplier_phone && <span>TEL: {str(receipt.supplier_phone)}</span>}
          {receipt.supplier_email && <span>EMAIL: {str(receipt.supplier_email)}</span>}
          {receipt.supplier_tin && <span>TIN {str(receipt.supplier_tin)}</span>}
        </div>
        <dl className="grn-reference-fields">
          <div><dt>GRN No.</dt><dd>{str(receipt.grn_number) || '—'}</dd></div>
          <div><dt>LPO No.</dt><dd>{str(receipt.lpo_number) || '—'}</dd></div>
          <div><dt>Delivery Date</dt><dd>{dateOnly(receipt.received_date)}</dd></div>
          <div><dt>Delivery Note No.</dt><dd>{str(receipt.delivery_note_no) || '—'}</dd></div>
        </dl>
      </header>

      <section className="grn-reference-body">
        <table className="grn-reference-lines">
          <colgroup>
            <col className="grn-col-status" />
            <col className="grn-col-article" />
            <col className="grn-col-ordered" />
            <col className="grn-col-unit" />
            <col className="grn-col-delivered" />
            <col className="grn-col-price" />
            <col className="grn-col-net" />
            <col className="grn-col-vat" />
            <col className="grn-col-amount" />
          </colgroup>
          <thead><tr>
            <th>Status</th><th>Article</th><th className="grn-num">Ordered</th>
            <th>Unit</th><th className="grn-num">Delivered</th>
            <th className="grn-num">Unit Price</th><th className="grn-num">Net</th>
            <th className="grn-num">VAT %</th><th className="grn-num">Amount</th>
          </tr></thead>
          <tbody>
            {entries.map(line => <tr key={line.key}>
              <td>{line.status}</td>
              <td><span className="grn-line-name">{line.article}</span>
                {line.sku && <small>{line.sku}</small>}
                {line.batch && <small>Batch: {line.batch}</small>}
                {line.expiry && <small>Expiry: {line.expiry}</small>}</td>
              <td className="grn-num">{line.ordered}</td>
              <td>{line.unit}</td>
              <td className="grn-num">{line.delivered}</td>
              <td className="grn-num">{line.price}</td>
              <td className="grn-num">{line.net}</td>
              <td className="grn-num">{line.vatPercent}</td>
              <td className="grn-num">{line.gross}</td>
            </tr>)}
            {!entries.length && <tr><td colSpan={9}>No accepted goods receipt lines recorded.</td></tr>}
          </tbody>
        </table>
        <div className="grn-reference-blank-area" aria-hidden="true" />
        <div className="grn-reference-summary">
          <div><strong>Net Total</strong><span>{money(netTotal)}</span></div>
          <div><strong>VAT Total</strong><span>{money(vatTotal)}</span></div>
          <div className="grn-reference-grand-total"><strong>Total</strong><span>{money(grandTotal)}</span></div>
        </div>
      </section>

      <section className="grn-reference-signature">
        <div className="grn-reference-sig-line"><strong>Signature :</strong><span /></div>
        {receipt.note && <div className="grn-reference-note">{str(receipt.note)}</div>}
      </section>
      <footer className="grn-reference-bottom">
        <span className="grn-reference-prepared">{preparedBy || '—'}</span>
        <span className="grn-reference-status-note">{statusNote}</span>
        <span className="grn-reference-timestamp">{stamp(receipt.created_at || receipt.posted_at)}</span>
      </footer>
    </article>
  )
}
