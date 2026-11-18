import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import ConfirmTransaction from '../components/ConfirmTransaction'
import WorkflowPrerequisite from '../components/WorkflowPrerequisite'
import GrnReferenceDocument from '../components/GrnReferenceDocument'
import { errorMessage, fetchHotels, readBackendPayload, readBackendRecords, runBackendAction, type HotelRecord } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

const id = (value: unknown) => String(value ?? '')
const n = (value: unknown) => Number(value || 0)
const q = (value: unknown) => n(value).toLocaleString('en-UG', { maximumFractionDigits: 4 })
const receiptStatus = (value: unknown) => id(value) === 'posted' ? 'Posted to SOH' : 'Awaiting Stores'

type LockedCountLine = {
  purchase_order_item: string
  article: string
  sku: string
  unit: string
  ordered_quantity: string
  previously_received_quantity: string
  due_before_delivery: string
  counted_quantity: string
  accepted_quantity: string
  rejected_quantity: string
  short_quantity: string
  excess_quantity: string
  outstanding_after_inspection: string
  has_variance: boolean
  rejection_reason: string
}
type LockedComparison = {
  grn_id: string
  blind_count_locked_at: string
  blind_count_locked: boolean
  has_variance: boolean
  variance_note_required: boolean
  variance_note: string
  note: string
  lines: LockedCountLine[]
}

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
      && lines.some((line) => id(line.purchase_order) === id(order.id) && (
        line.has_outstanding === true || n(line.outstanding_quantity ?? line.approved_quantity) > 0
      ))
    )),
    [orders, lines],
  )
  useEffect(() => {
    const match = /^\/receiving\/po\/([^/]+)\/?$/.exec(window.location.pathname)
    if (!match || !ready.length || selectedOrderId) return
    const target = decodeURIComponent(match[1]).toLowerCase()
    const linked = ready.find((row) =>
      [row.id, row.lpo_number, row.po_number].some(
        (value) => id(value).toLowerCase() === target,
      ),
    )
    if (linked) setSelectedOrderId(id(linked.id))
  }, [ready, selectedOrderId])

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
          <p>Stage 1: save and lock an independent physical count. Stage 2: review the ordered-versus-counted quantities before Stores verifies the GRN.</p>
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
                  setPreviewGrnId(receiptId)
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
          <thead><tr><th>LPO</th><th>Supplier</th><th>Expected</th><th>Status</th><th /></tr></thead>
          <tbody>{orders.map((order) => <tr key={id(order.id)}><td><strong>{id(order.lpo_number || order.po_number)}</strong></td><td>{id((app.data.suppliers as Row[]).find((supplier) => id(supplier.id) === id(order.supplier))?.name || order.supplier)}</td> <td>{id(order.expected_date) || '—'}</td><td>{id(order.status).replace(/_/g, ' ')}</td><td><button type="button" className="ds-btn ds-btn-secondary" onClick={() => select(id(order.id))}>Review & receive</button></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  )
}

function Receive({ order, lines, app, busy, act, back, receiptRecorded }: { order: Row; lines: Row[]; app: any; busy: boolean; act: any; back: () => void; receiptRecorded: (receiptId: string) => void }) {
  const [invoice, setInvoice] = useState('')
  const [delivery, setDelivery] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [tracking, setTracking] = useState<Record<string, { batch_number: string; expiry_date: string; delivery_temperature: string }>>({})
  const [rejected, setRejected] = useState<Record<string, string>>({})
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({})
 
  useEffect(() => {
    const nextValues: Record<string, string> = {}
    const nextTracking: Record<string, { batch_number: string; expiry_date: string; delivery_temperature: string }> = {}
    lines.forEach((line) => { nextValues[id(line.id)] = '' })
    lines.forEach((line) => { nextTracking[id(line.id)] = { batch_number: '', expiry_date: '', delivery_temperature: '' } })
    setValues(nextValues)
    setRejected({})
    setRejectionReasons({})
    setTracking(nextTracking)
  }, [order.id])

  const items = new Map<string, Row>((app.data.items as Row[]).map((item: Row) => [id(item.id), item]))
  const positive = lines.filter((line) => n(values[id(line.id)]) > 0)
   const invalidLines = lines.filter((line) => {
    const raw = (values[id(line.id)] || '').trim()
    return !raw || !Number.isFinite(Number(raw)) || Number(raw) < 0
  })
  const invalidRejected = lines.filter((line) => {
    const amount = n(rejected[id(line.id)])
    return !Number.isFinite(amount) || amount < 0
      || amount > n(values[id(line.id)])
      || (amount > 0 && !rejectionReasons[id(line.id)]?.trim())
  })
  const invalidTracking = positive.filter((line) => {
    const article = items.get(id(line.item))
    const trace = tracking[id(line.id)] || { batch_number: '', expiry_date: '', delivery_temperature: '' }
    return (Boolean(article?.batchTracking) && !trace.batch_number.trim())
      || (Boolean(article?.expiryTracking) && !trace.expiry_date)
      || (Boolean(article?.requiresDeliveryTemperature) && trace.delivery_temperature.trim() === '')
      || Boolean(trace.expiry_date && trace.expiry_date < new Date().toISOString().slice(0, 10))
  })
  const invalid = invalidLines.length > 0 || invalidTracking.length > 0 || invalidRejected.length > 0

  return (
    <section className="ds-card ds-detail">
      <button type="button" className="ds-btn ds-btn-secondary" onClick={back}><Icon name="arrow_back" size={15} />Back</button>
      <WorkflowPrerequisite domain="goods_receipt" record={order} action="receive"/>
      <div className="ds-detail-head"><div><div className="ds-eyebrow">Stage 1 · Blind physical count</div><h2>LPO {id(order.lpo_number || order.po_number)}</h2></div><span className="ds-status info">Approved supplier order</span></div>
      <div className="ds-form-grid">
        <div className="ds-read"><span>Receiving mode</span><strong>Blind count · ordered quantities concealed</strong></div>
        <div className="ds-read"><span>Expected delivery</span><strong>{id(order.expected_date) || '—'}</strong></div>
        <div className="ds-read"><span>GRN date/time</span><strong>Automatic when saved</strong></div>
        <div className="ds-read"><span>Status</span><strong>{id(order.status)}</strong></div>
        <label>Supplier invoice *<input value={invoice} onChange={(event) => setInvoice(event.target.value)} /></label>
        <label>Delivery note<input value={delivery} onChange={(event) => setDelivery(event.target.value)} /></label>
      </div>
      <div className="ds-table-scroll">
        <table className="ds-table">
          <thead><tr><th>Article</th><th>Ordered</th><th>Counted qty</th><th>Rejected qty</th><th>Rejection reason</th><th>Batch / lot</th><th>Expiry</th><th>Temp °C</th></tr></thead>
          <tbody>{lines.map((line) => {
            const item = items.get(id(line.item))
            const trace = tracking[id(line.id)] || { batch_number: '', expiry_date: '', delivery_temperature: '' }
            const setTrace = (field: 'batch_number' | 'expiry_date' | 'delivery_temperature', value: string) => setTracking({ ...tracking, [id(line.id)]: { ...trace, [field]: value } })
            return <tr key={id(line.id)}>
              <td><strong>{id(item?.name || line.item_name || line.item)}</strong><small>{id(item?.sku || line.item_sku)}</small></td>
              <td><span title="Ordered quantity concealed during blind receiving">***</span></td>
              <td><input type="number" min="0" step="0.0001" inputMode="decimal" placeholder="Count" aria-label={'Counted quantity for ' + id(item?.name || line.item_name)} aria-invalid={invalidLines.some(entry=>id(entry.id)===id(line.id))} value={values[id(line.id)] || ''} onChange={(event) => setValues({ ...values, [id(line.id)]: event.target.value })} /></td>
              <td><input type="number" min="0" step="0.0001" inputMode="decimal" aria-label={'Rejected quantity for ' + id(item?.name || line.item_name)} aria-invalid={invalidRejected.some(entry=>id(entry.id)===id(line.id))} value={rejected[id(line.id)] || ''} onChange={(event) => setRejected({ ...rejected, [id(line.id)]: event.target.value })} /></td>
              <td><input type="text" placeholder="If rejected" aria-label={'Rejection reason for ' + id(item?.name || line.item_name)} aria-invalid={invalidRejected.some(entry=>id(entry.id)===id(line.id))} value={rejectionReasons[id(line.id)] || ''} onChange={(event) => setRejectionReasons({ ...rejectionReasons, [id(line.id)]: event.target.value })} /></td>
              <td><input aria-label={`Batch number for ${id(item?.name || line.item_name)}`} required={Boolean(item?.batchTracking) && n(values[id(line.id)]) > 0} placeholder={item?.batchTracking ? 'Required' : 'Optional'} value={trace.batch_number} onChange={(event) => setTrace('batch_number', event.target.value)} /></td>
              <td><input aria-label={`Expiry date for ${id(item?.name || line.item_name)}`} required={Boolean(item?.expiryTracking) && n(values[id(line.id)]) > 0} type="date" min={new Date().toISOString().slice(0, 10)} value={trace.expiry_date} onChange={(event) => setTrace('expiry_date', event.target.value)} /></td>
              <td><input aria-label={`Delivery temperature for ${id(item?.name || line.item_name)}`} type="number" step="0.1" required={Boolean(item?.requiresDeliveryTemperature) && n(values[id(line.id)]) > 0} placeholder={item?.requiresDeliveryTemperature ? 'Required' : 'Optional'} value={trace.delivery_temperature} onChange={(event) => setTrace('delivery_temperature', event.target.value)} /></td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {(invalidLines.length > 0 || invalidRejected.length > 0 || invalidTracking.length > 0 || !invoice.trim()) && <div className="ds-alert" role="status" aria-live="polite">
        <strong>Complete the receiving prerequisites</strong>
        <ul>
          {!invoice.trim() && <li>Enter the supplier invoice reference.</li>}
          {invalidLines.length > 0 && <li>Record non-negative physical counts for {invalidLines.length} article row(s).</li>}
          {invalidRejected.length > 0 && <li>Correct rejected quantities and rejection reasons on {invalidRejected.length} article row(s).</li>}
          {invalidTracking.length > 0 && <li>Complete batch, expiry and temperature evidence on {invalidTracking.length} tracked article row(s).</li>}
        </ul>
        <small>Next: Correct the highlighted lines. Save &amp; lock becomes available when all prerequisites are complete.</small>
      </div>}
      <div className="ds-sticky-action"><span>Ordered quantities remain hidden until this physical count and inspection are saved and permanently locked.</span><ConfirmTransaction title="Save and lock your blind count?" description="The saved quantities, batch details and inspection decisions cannot be changed by the Receiving Clerk. After saving, the system reveals ordered quantities and any delivery differences in a read-only reconciliation. Stores will verify before SOH increases." confirmLabel="Save & lock blind count" className="ds-btn ds-btn-primary" disabled={busy || !invoice.trim() || !positive.length || invalid || false} busy={busy} onConfirm={async () => {
        const receipt = await act(() => runBackendAction('purchase-orders', id(order.id), 'receive-delivery', { supplier_invoice_no: invoice, delivery_note_no: delivery, lines: positive.map((line) => ({ purchase_order_item: id(line.id), quantity_received: n(values[id(line.id)]), quantity_rejected: n(rejected[id(line.id)]), rejection_reason: rejectionReasons[id(line.id)] || '', batch_number: tracking[id(line.id)]?.batch_number || '', expiry_date: tracking[id(line.id)]?.expiry_date || null, delivery_temperature: tracking[id(line.id)]?.delivery_temperature ? Number(tracking[id(line.id)].delivery_temperature) : null })) }), 'GRN recorded · awaiting Store Keeper verification')
        const receiptId = id((receipt as Row | undefined)?.id)
        if (receiptId) receiptRecorded(receiptId)
      }}>Generate GRN</ConfirmTransaction></div>
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
  const app = useApp()
  const receiptLines = lines.filter((line) => id(line.goods_receipt) === id(receipt.id))
  const [comparison, setComparison] = useState<LockedComparison | null>(null)
  const [hotel, setHotel] = useState<HotelRecord | null>(null)
  const [loading, setLoading] = useState(Boolean(receipt.blind_count_locked_at))
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    let active = true
    void fetchHotels()
      .then((hotels) => {
        if (active) setHotel(hotels.find((row) => row.is_active) || hotels[0] || null)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!receipt.blind_count_locked_at) { setLoading(false); return }
    let active = true
    setLoading(true)
    setError('')
    void readBackendPayload('grns/' + encodeURIComponent(id(receipt.id)) + '/blind-reconciliation/')
      .then((payload) => { if (active) setComparison(payload as unknown as LockedComparison) })
      .catch((cause) => { if (active) setError(errorMessage(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [receipt.id, receipt.blind_count_locked_at])

  const recordExplanation = async () => {
    if (!note.trim() || savingNote) return
    setSavingNote(true)
    setError('')
    try {
      const result = await runBackendAction(
        'grns', id(receipt.id), 'variance-note', { note: note.trim() },
      )
      setComparison(result as unknown as LockedComparison)
      setNote('')
      app.showToast('Variance explanation recorded with audit history. The original count remains locked.')
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Variance explanation not saved', message)
    } finally { setSavingNote(false) }
  }
  return (
    <section className="ds-card ds-detail">
      <button type="button" className="ds-btn ds-btn-secondary" onClick={back}><Icon name="arrow_back" size={15} />Back to GRN history</button>
      <div className="ds-detail-head">
        <div><div className="ds-eyebrow">{receipt.blind_count_locked_at ? 'Stage 2 · Locked count reconciliation' : 'GRN preview'}</div>
          <h2>{id(receipt.grn_number)}</h2>
          <p>{receipt.blind_count_locked_at
            ? 'Physical quantities are saved and locked. Ordered quantities are now visible for comparison.'
            : 'Read-only receipt recorded from the supplier delivery.'}</p>
        </div>
        <span className={`ds-status ${id(receipt.status) === 'posted' ? 'good' : 'warn'}`}>{receiptStatus(receipt.status)}</span>
      </div>
      <div className="ds-form-grid">
        <div className="ds-read"><span>LPO</span><strong>{id(receipt.lpo_number) || '—'}</strong></div>
        <div className="ds-read"><span>Supplier</span><strong>{id(receipt.supplier_name) || '—'}</strong></div>
        <div className="ds-read"><span>Supplier invoice</span><strong>{id(receipt.supplier_invoice_no) || '—'}</strong></div>
        <div className="ds-read"><span>Delivery note</span><strong>{id(receipt.delivery_note_no) || '—'}</strong></div>
        <div className="ds-read"><span>Received on</span><strong>{id(receipt.received_date) || '—'}</strong></div>
        <div className="ds-read"><span>Received by</span><strong>{id(receipt.received_by_name) || '—'}</strong></div>
        <div className="ds-read"><span>Receiving store</span><strong>{id(receipt.receiving_store_name) || '—'}</strong></div>
        {receipt.blind_count_locked_at && <div className="ds-read"><span>Count locked at</span><strong>{new Date(id(receipt.blind_count_locked_at)).toLocaleString('en-UG')}</strong></div>}
      </div>
      {loading && <div className="ds-empty" role="status">Loading the locked count comparison…</div>}
      {error && <div className="ds-alert" role="alert">{error}</div>}
      {comparison && <>
        <div className="ds-section-head">
          <div><h2>Ordered vs independently counted</h2><span>Read-only · values in the purchase unit · supplier prices concealed</span></div>
          <span className={`ds-status ${comparison.has_variance ? 'warn' : 'good'}`}>
            {comparison.has_variance ? 'Variance requires attention' : 'Quantities reconciled'}
          </span>
        </div>
        <div className="ds-table-scroll">
          <table className="ds-table">
            <thead><tr>
              <th>Article / unit</th><th>Ordered</th><th>Previously received</th>
              <th>Due before delivery</th><th>Blind count</th><th>Accepted</th>
              <th>Rejected</th><th>Short</th><th>Excess</th><th>Outstanding after inspection</th>
            </tr></thead>
            <tbody>{comparison.lines.map((line) => <tr key={line.purchase_order_item}>
              <td><strong>{line.article}</strong><small>{line.sku} · {line.unit}</small></td>
              <td>{q(line.ordered_quantity)}</td>
              <td>{q(line.previously_received_quantity)}</td>
              <td>{q(line.due_before_delivery)}</td>
              <td><strong>{q(line.counted_quantity)}</strong></td>
              <td>{q(line.accepted_quantity)}</td>
              <td>{q(line.rejected_quantity)}</td>
              <td>{n(line.short_quantity) > 0 ? <strong>{q(line.short_quantity)}</strong> : '—'}</td>
              <td>{n(line.excess_quantity) > 0 ? <strong>{q(line.excess_quantity)}</strong> : '—'}</td>
              <td>{q(line.outstanding_after_inspection)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="ds-alert" role="status">
          <Icon name="lock" size={16} /> Saved receiving and inspection quantities cannot be edited. Report a discrepancy to the Store Keeper for independent review.
        </div>
        {comparison.has_variance && <>
          {comparison.variance_note ? (
            <div className="ds-read"><span>Recorded variance explanation</span><strong>{comparison.variance_note}</strong></div>
          ) : (
            <div className="ds-sticky-action">
              <label className="ds-field" style={{ flex: 1 }}>Explanation for the shortage, excess or rejection
                <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1500}
                  placeholder="Record what was observed. This does not change the locked quantities." />
              </label>
              <button type="button" className="ds-btn ds-btn-primary" onClick={() => void recordExplanation()}
                disabled={savingNote || !note.trim()}>
                <Icon name="check_circle" size={16} /> Save audited explanation
              </button>
            </div>
          )}
        </>}
        <div className="ds-sticky-action">
          <span>Stage 2 complete: Stores independently verifies this GRN before posting accepted stock to SOH.</span>
        </div>
      </>}
      {!receipt.blind_count_locked_at && <div className="ds-table-scroll">
        <table className="ds-table">
          <thead><tr><th>Article</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Unit</th></tr></thead>
          <tbody>{receiptLines.map((line) => <tr key={id(line.id)}><td><strong>{id(line.item_name || line.item)}</strong><small>{id(line.item_sku)}</small></td>
            <td>{q(line.quantity_received)}</td><td>{q(line.accepted_quantity)}</td>
            <td>{q(line.rejected_quantity)}</td><td>{id(line.unit_abbreviation || line.unit_name) || '—'}</td></tr>)}</tbody>
        </table>
      </div>}
      {!comparison && receipt.note && <div className="ds-sticky-action"><span><strong>Receiving note:</strong> {id(receipt.note)}</span></div>}
      <div className="screen-document-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 24 }}>
        <div><strong>Print-ready GRN</strong><p style={{ fontSize: 12, margin: '4px 0', color: 'var(--text-muted)' }}>A4 landscape · original purchase-order receiving layout · supplier and delivery metadata</p></div>
        <button type="button" className="ds-btn ds-btn-secondary" disabled={loading || Boolean(receipt.blind_count_locked_at && !comparison)} onClick={() => window.print()}>
          <Icon name="print" size={16} /> Print GRN
        </button>
      </div>
      <div className="grn-reference-print-region">
        <GrnReferenceDocument
          receipt={receipt}
          lines={receiptLines}
          comparison={comparison}
          hotel={hotel}
          propertyName={id(receipt.branch_name) || app.currentBranch || app.user.branchName}
          preparedBy={id(receipt.received_by_name) || app.user.name}
          items={app.data.items}
          departments={app.data.departments}
        />
      </div>
    </section>
  )
}
