import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { errorMessage, readBackendRecords, runBackendAction } from '../lib/api'
import type { Row } from '../lib/data'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const id = (value: unknown) => String(value ?? '')
const n = (value: unknown) => Number(value || 0)
const q = (value: unknown) => n(value).toLocaleString('en-UG', { maximumFractionDigits: 2 })
const receiptStatus = (value: unknown) => id(value) === 'posted' ? 'Posted to SOH' : 'Awaiting Stores'

export default function ReceivingClerkWorkspaceV2() {
  const app = useApp()
  const [orders, setOrders] = useState<Row[]>([])
  const [lines, setLines] = useState<Row[]>([])
  const [grns, setGrns] = useState<Row[]>([])
  const [grnLines, setGrnLines] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [selectedGrnId, setSelectedGrnId] = useState('')
  const [previewGrnId, setPreviewGrnId] = useState('')
  const [tab, setTab] = useState<'ready' | 'history'>('ready')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [purchaseOrders, purchaseOrderLines, receipts, receiptLines] = await Promise.all([
        readBackendRecords('purchase-orders'),
        readBackendRecords('purchase-order-items'),
        readBackendRecords('grns'),
        readBackendRecords('grn-items'),
      ])
      setOrders(purchaseOrders)
      setLines(purchaseOrderLines)
      setGrns(receipts)
      setGrnLines(receiptLines)
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Receiving workspace unavailable', message)
    } finally {
      setLoading(false)
    }
  }, [app.showWorkflowAlert])

  useEffect(() => { void load() }, [load])

  const act = async (operation: () => Promise<unknown>, successMessage: string) => {
    if (busy) return
    setBusy(true)
    try {
      const result = await operation()
      await load()
      await app.refreshData()
      app.showToast(successMessage)
      return result
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Receiving action failed', message)
    } finally {
      setBusy(false)
    }
  }

  const ready = useMemo(
    () => orders.filter((order) => (
      ['issued', 'partially_received'].includes(id(order.status))
      && lines.some((line) => id(line.purchase_order) === id(order.id) && n(line.outstanding_quantity ?? line.approved_quantity) > 0)
    )),
    [orders, lines],
  )
  const order = ready.find((row) => id(row.id) === selectedOrderId)
  const previewGrn = grns.find((row) => id(row.id) === previewGrnId)

  const showHistory = () => {
    setTab('history')
    setSelectedOrderId('')
    setPreviewGrnId('')
  }

  return (
    <div className="ds-workspace">
      <header className="ds-hero">
        <span className="ds-hero-icon"><Icon name="move_to_inbox" size={22} /></span>
        <div>
          <div className="ds-eyebrow">Receiving Clerk</div>
          <h1>Supplier Receiving & GRN</h1>
          <p>Review LPO quantities and amounts, then record what physically arrived. GRN date/time is generated automatically.</p>
        </div>
        <div className="ds-hero-actions">
          <button
            type="button"
            className="ds-btn ds-btn-secondary"
            disabled={tab !== 'history' || !selectedGrnId || Boolean(previewGrn)}
            title={selectedGrnId ? 'Preview the highlighted GRN' : 'Highlight a GRN in the history list first'}
            onClick={() => setPreviewGrnId(selectedGrnId)}
          >
            <Icon name="visibility" size={15} /> Preview GRN
          </button>
          <button type="button" className="ds-btn ds-btn-secondary ds-refresh" onClick={() => void load()}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
        </div>
      </header>

      {error && <div className="ds-alert">{error}</div>}

      <nav className="ds-tabs">
        <button
          className={tab === 'ready' ? 'active' : ''}
          onClick={() => {
            setTab('ready')
            setSelectedOrderId('')
            setPreviewGrnId('')
          }}
        >
          Ready LPOs <b>{ready.length}</b>
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={showHistory}>
          GRN history <b>{grns.length}</b>
        </button>
      </nav>

      {loading ? <div className="ds-empty">Loading receiving records…</div>
        : tab === 'history' && previewGrn ? (
          <GrnPreview receipt={previewGrn} lines={grnLines} back={() => setPreviewGrnId('')} />
        )
          : tab === 'history' ? (
            <History grns={grns} lines={grnLines} selectedId={selectedGrnId} select={setSelectedGrnId} />
          )
            : order ? (
              <Receive
                order={order}
                lines={lines.filter((line) => id(line.purchase_order) === id(order.id))}
                app={app}
                busy={busy}
                act={act}
                back={() => setSelectedOrderId('')}
                receiptRecorded={(receiptId) => {
                  setSelectedOrderId('')
                  setSelectedGrnId(receiptId)
                  setPreviewGrnId('')
                  setTab('history')
                }}
              />
            )
              : <ReadyOrders orders={ready} app={app} select={setSelectedOrderId} />}
    </div>
  )
}

function ReadyOrders({ orders, app, select }: { orders: Row[]; app: any; select: (orderId: string) => void }) {
  return (
    <section className="ds-card">
      <div className="ds-section-head"><div><h2>Issued LPOs ready for supplier delivery</h2><span>Select an LPO to review before GRN.</span></div></div>
      <div className="ds-table-scroll">
        <table className="ds-table">
          <thead><tr><th>LPO</th><th>Supplier</th><th>Total amount</th><th>Expected</th><th>Status</th><th /></tr></thead>
          <tbody>{orders.map((order) => <tr key={id(order.id)}><td><strong>{id(order.lpo_number || order.po_number)}</strong></td><td>{id((app.data.suppliers as Row[]).find((supplier) => id(supplier.id) === id(order.supplier))?.name || order.supplier)}</td><td>{money(order.total_amount)}</td><td>{id(order.expected_date) || '—'}</td><td>{id(order.status).replace(/_/g, ' ')}</td><td><button type="button" className="ds-btn ds-btn-secondary" onClick={() => select(id(order.id))}>Review & receive</button></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  )
}

function Receive({ order, lines, app, busy, act, back, receiptRecorded }: { order: Row; lines: Row[]; app: any; busy: boolean; act: any; back: () => void; receiptRecorded: (receiptId: string) => void }) {
  const [invoice, setInvoice] = useState('')
  const [delivery, setDelivery] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')

  useEffect(() => {
    const nextValues: Record<string, string> = {}
    lines.forEach((line) => { nextValues[id(line.id)] = String(n(line.outstanding_quantity ?? line.approved_quantity)) })
    setValues(nextValues)
  }, [order.id])

  const items = new Map<string, Row>((app.data.items as Row[]).map((item: Row) => [id(item.id), item]))
  const positive = lines.filter((line) => n(values[id(line.id)]) > 0)
  const short = lines.some((line) => n(values[id(line.id)]) < n(line.outstanding_quantity ?? line.approved_quantity))
  const invalid = lines.some((line) => n(values[id(line.id)]) > n(line.outstanding_quantity ?? line.approved_quantity) || n(values[id(line.id)]) < 0)

  return (
    <section className="ds-card ds-detail">
      <button type="button" className="ds-btn ds-btn-secondary" onClick={back}><Icon name="arrow_back" size={15} />Back</button>
      <div className="ds-detail-head"><div><div className="ds-eyebrow">Review before GRN</div><h2>LPO {id(order.lpo_number || order.po_number)}</h2></div><span className="ds-status info">Approved supplier order</span></div>
      <div className="ds-form-grid">
        <div className="ds-read"><span>LPO total</span><strong>{money(order.total_amount)}</strong></div>
        <div className="ds-read"><span>Expected delivery</span><strong>{id(order.expected_date) || '—'}</strong></div>
        <div className="ds-read"><span>GRN date/time</span><strong>Automatic when saved</strong></div>
        <div className="ds-read"><span>Status</span><strong>{id(order.status)}</strong></div>
        <label>Supplier invoice *<input value={invoice} onChange={(event) => setInvoice(event.target.value)} /></label>
        <label>Delivery note<input value={delivery} onChange={(event) => setDelivery(event.target.value)} /></label>
      </div>
      <div className="ds-table-scroll">
        <table className="ds-table">
          <thead><tr><th>Article</th><th>Ordered</th><th>Previously received</th><th>Outstanding</th><th>Receive now</th><th>Unit price</th><th>Amount</th></tr></thead>
          <tbody>{lines.map((line) => {
            const item = items.get(id(line.item))
            return <tr key={id(line.id)}><td><strong>{id(item?.name || line.item_name || line.item)}</strong><small>{id(item?.sku || line.item_sku)}</small></td><td>{q(line.approved_quantity ?? line.quantity)}</td><td>{q(line.previously_received_quantity)}</td><td>{q(line.outstanding_quantity ?? line.approved_quantity)}</td><td><input type="number" min="0" max={n(line.outstanding_quantity ?? line.approved_quantity)} value={values[id(line.id)] || ''} onChange={(event) => setValues({ ...values, [id(line.id)]: event.target.value })} /></td><td>{money(line.unit_cost)}</td><td>{money(n(values[id(line.id)]) * n(line.unit_cost))}</td></tr>
          })}</tbody>
        </table>
      </div>
      {short && <label className="ds-field">Reason for short delivery *<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
      <div className="ds-sticky-action"><span>Receiving records the physical delivery. Store Keeper will verify the GRN before SOH increases.</span><button type="button" className="ds-btn ds-btn-primary" disabled={busy || !invoice.trim() || !positive.length || invalid || (short && !reason.trim())} onClick={() => void (async () => {
        const receipt = await act(() => runBackendAction('purchase-orders', id(order.id), 'receive-delivery', { supplier_invoice_no: invoice, delivery_note_no: delivery, short_delivery_reason: short ? reason : '', lines: positive.map((line) => ({ purchase_order_item: id(line.id), quantity_received: n(values[id(line.id)]) })) }), 'GRN recorded · awaiting Store Keeper verification')
        const receiptId = id((receipt as Row | undefined)?.id)
        if (receiptId) receiptRecorded(receiptId)
      })()}>Generate GRN</button></div>
    </section>
  )
}

function History({ grns, lines, selectedId, select }: { grns: Row[]; lines: Row[]; selectedId: string; select: (receiptId: string) => void }) {
  return (
    <section className="ds-card">
      <div className="ds-section-head"><div><h2>GRN history</h2><span>Select a GRN to highlight it, then choose Preview GRN above.</span></div></div>
      <div className="ds-table-scroll">
        <table className="ds-table">
          <thead><tr><th>GRN</th><th>LPO</th><th>Supplier</th><th>Invoice</th><th>Received</th><th>Lines</th><th>Status</th></tr></thead>
          <tbody>{grns.map((receipt) => {
            const selected = id(receipt.id) === selectedId
            return <tr key={id(receipt.id)} className={selected ? 'ds-selectable-row is-selected' : 'ds-selectable-row'} tabIndex={0} aria-selected={selected} onClick={() => select(id(receipt.id))} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(id(receipt.id)) } }}><td><strong>{id(receipt.grn_number)}</strong></td><td>{id(receipt.lpo_number)}</td><td>{id(receipt.supplier_name)}</td><td>{id(receipt.supplier_invoice_no) || '—'}</td><td>{id(receipt.received_date)}</td><td>{lines.filter((line) => id(line.goods_receipt) === id(receipt.id)).length}</td><td><span className={`ds-status ${id(receipt.status) === 'posted' ? 'good' : 'warn'}`}>{receiptStatus(receipt.status)}</span></td></tr>
          })}</tbody>
        </table>
      </div>
    </section>
  )
}

function GrnPreview({ receipt, lines, back }: { receipt: Row; lines: Row[]; back: () => void }) {
  const receiptLines = lines.filter((line) => id(line.goods_receipt) === id(receipt.id))
  const total = receiptLines.reduce((sum, line) => sum + n(line.quantity_received) * n(line.unit_cost), 0)

  return (
    <section className="ds-card ds-detail">
      <button type="button" className="ds-btn ds-btn-secondary" onClick={back}><Icon name="arrow_back" size={15} />Back to GRN history</button>
      <div className="ds-detail-head"><div><div className="ds-eyebrow">GRN preview</div><h2>{id(receipt.grn_number)}</h2><p>Read-only receipt recorded from the supplier delivery.</p></div><span className={`ds-status ${id(receipt.status) === 'posted' ? 'good' : 'warn'}`}>{receiptStatus(receipt.status)}</span></div>
      <div className="ds-form-grid">
        <div className="ds-read"><span>LPO</span><strong>{id(receipt.lpo_number) || '—'}</strong></div>
        <div className="ds-read"><span>Supplier</span><strong>{id(receipt.supplier_name) || '—'}</strong></div>
        <div className="ds-read"><span>Supplier invoice</span><strong>{id(receipt.supplier_invoice_no) || '—'}</strong></div>
        <div className="ds-read"><span>Delivery note</span><strong>{id(receipt.delivery_note_no) || '—'}</strong></div>
        <div className="ds-read"><span>Received on</span><strong>{id(receipt.received_date) || '—'}</strong></div>
        <div className="ds-read"><span>Received by</span><strong>{id(receipt.received_by_name) || '—'}</strong></div>
        <div className="ds-read"><span>Receiving store</span><strong>{id(receipt.receiving_store_name) || '—'}</strong></div>
        <div className="ds-read"><span>Receipt value</span><strong>{money(total)}</strong></div>
      </div>
      <div className="ds-table-scroll">
        <table className="ds-table">
          <thead><tr><th>Article</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Unit</th><th>Unit price</th><th>Line value</th></tr></thead>
          <tbody>{receiptLines.map((line) => <tr key={id(line.id)}><td><strong>{id(line.item_name || line.item)}</strong><small>{id(line.item_sku)}</small></td><td>{q(line.quantity_received)}</td><td>{q(line.accepted_quantity)}</td><td>{q(line.rejected_quantity)}</td><td>{id(line.unit_abbreviation || line.unit_name) || '—'}</td><td>{money(line.unit_cost)}</td><td>{money(n(line.quantity_received) * n(line.unit_cost))}</td></tr>)}</tbody>
        </table>
      </div>
      {receipt.note && <div className="ds-sticky-action"><span><strong>Receiving note:</strong> {id(receipt.note)}</span></div>}
    </section>
  )
}
