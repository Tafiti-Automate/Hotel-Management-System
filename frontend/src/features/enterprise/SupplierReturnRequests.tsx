import { useState } from 'react'
import ConfirmTransaction from '../../components/ConfirmTransaction'
import { createBackendRecord, errorMessage, runBackendAction } from '../../lib/api'
import { useApp } from '../../state/AppContext'
import { StateMessage, str, useBackendRows, WorkspacePage, OperationalSummary, type ApiRow } from './workspaceKit'

type RequestRow = ApiRow

const inputClass = 'mc-field'
const buttonClass = 'mc-action mc-action-primary'
const quantityPattern = /^\d+(?:\.\d{1,4})?$/

function useReturnActions(reload: () => Promise<void>) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const run = async (work: () => Promise<unknown>, label: string) => {
    if (busy) return false
    setBusy(true)
    setFailure('')
    try {
      await work()
      await reload()
      app.showToast(label)
      return true
    } catch (error) {
      setFailure(errorMessage(error))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { run, busy, failure }
}

export default function SupplierReturnReporter() {
  const app = useApp()
  const clerk = app.user.role.toLowerCase() === 'receiving clerk'
  const source = clerk ? 'receiving_rejection' : 'stock_on_hand'
  const { data, loading, error, reload } = useBackendRows([
    'grns', 'grn-items', 'purchase-orders', 'supplier-return-requests',
  ])
  const { run, busy, failure } = useReturnActions(reload)
  const [grnId, setGrnId] = useState('')
  const [lineId, setLineId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const grns = (data.grns || []).filter(r => clerk || str(r.status) === 'posted')
  const selectedGrn = grns.find(r => str(r.id) === grnId)
  const order = (data['purchase-orders'] || []).find(r => str(r.id) === str(selectedGrn?.purchase_order))
  const eligibleLines = (data['grn-items'] || []).filter(r =>
    str(r.goods_receipt) === grnId &&
    (clerk ? Number(r.rejected_quantity || 0) > 0 : r.inventory_changes_applied === true)
  )
  const selectedLine = eligibleLines.find(r => str(r.id) === lineId)
  const validQuantity = quantityPattern.test(quantity.trim()) && Number(quantity) > 0
  const report = async () => {
    if (!selectedGrn || !order?.store || !selectedLine || !validQuantity || !reason.trim()) return
    const saved = await run(() => createBackendRecord('supplier-return-requests', {
      goods_receipt: grnId, goods_receipt_item: lineId, store: order.store,
      source, quantity: quantity.trim(), reason: reason.trim(), evidence_note: evidence.trim(),
    }), 'Supplier return report sent to Cost Controller')
    if (saved) { setGrnId(''); setLineId(''); setQuantity(''); setReason(''); setEvidence('') }
  }
  const reports = (data['supplier-return-requests'] || [])
  return <WorkspacePage section={clerk ? 'Receiving / Quality exceptions' : 'Stores / Quality exceptions'}
    title={clerk ? 'Report rejected goods' : 'Request supplier return'}
    subtitle={clerk
      ? 'Report goods rejected in a GRN inspection. Rejected goods never enter Stock on Hand.'
      : 'Report damaged, defective, expired, or incorrect goods from a posted GRN. Requested quantities are quarantined immediately.'}>
    <StateMessage loading={loading} error={error || failure} />
    {!loading && error && <button type="button" className={buttonClass} onClick={() => void reload()}>Retry loading return reports</button>}
    {!loading && !error && <div className="mc-split mc-admin-split">
      <section className="mc-dense-panel mc-form-panel">
        <header className="mc-panel-title">Report goods requiring supplier return</header>
        <label className={inputClass}><span>Original GRN</span>
          <select value={grnId} onChange={event => { setGrnId(event.target.value); setLineId('') }}>
            <option value="">Select GRN</option>
            {grns.map(r => <option key={str(r.id)} value={str(r.id)}>{str(r.grn_number)} · {str(r.status)}</option>)}
          </select>
        </label>
        {selectedGrn && <div className="mc-alert mc-muted">
          Receiving store: {str(order?.store_name) || str(order?.store) || 'Check linked store'}.
          The original GRN and its article lines are the evidence reference.
        </div>}
        <label className={inputClass}><span>Article on GRN</span>
          <select value={lineId} onChange={event => setLineId(event.target.value)}>
            <option value="">Select affected article</option>
            {eligibleLines.map(r => <option key={str(r.id)} value={str(r.id)}>
              {str(r.item_name) || str(r.item_sku) || str(r.item)}
              {clerk ? ' · Rejected: ' + str(r.rejected_quantity) : ' · Accepted: ' + str(r.accepted_quantity)}
            </option>)}
          </select>
        </label>
        {grnId && eligibleLines.length === 0 && <div className="mc-alert mc-muted">
          {clerk ? 'This GRN has no recorded rejected inspection lines yet.' : 'This GRN has no eligible posted stock lines.'}
        </div>}
        <label className={inputClass}><span>Quantity to report (article base units)</span>
          <input type="number" min="0" step="0.0001" value={quantity}
            onChange={event => setQuantity(event.target.value)} />
        </label>
        <label className={inputClass}><span>Reason for return *</span>
          <textarea rows={2} value={reason} onChange={event => setReason(event.target.value)}
            placeholder="e.g. Damaged packaging, expired stock, wrong specification" />
        </label>
        <label className={inputClass}><span>Condition / evidence notes (optional)</span>
          <textarea rows={2} value={evidence} onChange={event => setEvidence(event.target.value)}
            placeholder="Batch number, expiry, delivery issue, or physical condition" />
        </label>
        <div className="mc-alert mc-muted">
          {clerk
            ? 'The Cost Controller will be notified. A receiving rejection does not deduct stock.'
            : 'The reported quantity is held from usable stock during review. Only the Cost Controller can approve and dispatch a supplier return.'}
        </div>
        <button className={buttonClass} disabled={busy || !selectedLine || !validQuantity || !reason.trim() || !order?.store}
          onClick={() => void report()}>Submit report to Cost Controller</button>
      </section>
      <section className="mc-dense-panel">
        <header className="mc-panel-title">My supplier return reports</header>
        {reports.length === 0 && <p className="mc-alert mc-muted">No return reports submitted.</p>}
        {reports.map(r => <div className="mc-alert mc-muted" key={str(r.id)}>
          <strong>{str(r.article_name)} · {str(r.quantity)} base units</strong>
          <div>{str(r.grn_number)} · {str(r.store_name)} · {str(r.supplier_name)}</div>
          <div>Reason: {str(r.reason)}</div>
          <div>Status: <strong>{str(r.status)}</strong></div>
          {Boolean(r.review_note) && <small>Cost Controller: {str(r.review_note)}</small>}
        </div>)}
      </section>
    </div>}
  </WorkspacePage>
}

export function SupplierReturnReviewQueue() {
  const { data, loading, error, reload } = useBackendRows(['supplier-return-requests'])
  const { run, busy, failure } = useReturnActions(reload)
  const [selectedId, setSelectedId] = useState('')
  const [note, setNote] = useState('')
  const [representative, setRepresentative] = useState('')
  const [credit, setCredit] = useState('')
  const rows: RequestRow[] = data['supplier-return-requests'] || []
  const selected = rows.find(r => str(r.id) === selectedId)
  const pending = rows.filter(r => str(r.status) === 'pending').length
  const approved = rows.filter(r => str(r.status) === 'approved').length
  const dispatched = rows.filter(r => str(r.status) === 'dispatched').length
  const act = async (action: string, label: string, extra: Record<string, unknown> = {}) => {
    if (!selected) return
    const ok = await run(() => runBackendAction('supplier-return-requests', str(selected.id), action,
      { note: note.trim(), ...extra }), label)
    if (ok) { setNote(''); setRepresentative(''); setCredit('') }
  }
  return <section className="mc-dense-panel" aria-label="Supplier return review queue">
    <header className="mc-panel-title">Reported goods · Cost Controller review and dispatch</header>
    <StateMessage loading={loading} error={error || failure} />
    {!loading && error && <button type="button" className={buttonClass} onClick={() => void reload()}>Retry loading Cost Controller return queue</button>}
    {!loading && !error && <>
      <OperationalSummary label="Supplier return control queue" metrics={[
        { label: 'Awaiting review', value: pending, description: 'Reported by Receiving / Stores', tone: pending ? 'attention' : 'neutral' },
        { label: 'Approved for dispatch', value: approved, description: 'Awaiting physical supplier return', tone: approved ? 'attention' : 'neutral' },
        { label: 'Dispatched', value: dispatched, description: 'Supplier acknowledgement may be outstanding' },
      ]} nextAction="Select a report, verify the linked GRN and physical evidence, then approve or reject. Only approved reports can be dispatched." />
      <label className={inputClass}><span>Return report</span>
        <select value={selectedId} onChange={event => { setSelectedId(event.target.value); setNote('') }}>
          <option value="">Select reported goods</option>
          {rows.map(r => <option key={str(r.id)} value={str(r.id)}>
            {str(r.status).toUpperCase()} · {str(r.grn_number)} · {str(r.article_name)} · {str(r.store_name)}
          </option>)}
        </select>
      </label>
      {selected && <div className="mc-alert mc-muted">
        <div><strong>{str(selected.article_name)} · {str(selected.quantity)} base units</strong></div>
        <div>Supplier: {str(selected.supplier_name)} · Store: {str(selected.store_name)}</div>
        <div>GRN: {str(selected.grn_number)} · Reported by: {str(selected.reporter_name)}</div>
        <div>Source: {str(selected.source) === 'receiving_rejection' ? 'Rejected at receiving (not in Stock on Hand)' : 'Accepted stock (quarantined)'}</div>
        <div>Reason: {str(selected.reason)} · Evidence: {str(selected.evidence_note) || 'None recorded'}</div>
        <div>Status: <strong>{str(selected.status)}</strong></div>
        {Boolean(selected.review_note) && <div>Decision: {str(selected.review_note)}</div>}
      </div>}
      {selected && str(selected.status) === 'pending' && <>
        <label className={inputClass}><span>Review note (required to reject)</span>
          <textarea rows={2} value={note} onChange={event => setNote(event.target.value)} />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <ConfirmTransaction title="Approve supplier return?" description="Approval permits a later controlled dispatch. No physical stock is deducted by this approval."
            confirmLabel="Approve return" disabled={busy} busy={busy}
            onConfirm={() => act('approve', 'Supplier return approved')}>Approve</ConfirmTransaction>
          <ConfirmTransaction title="Reject supplier return report?" description="The stated reason is recorded and any held stock quantity is released."
            confirmLabel="Reject report" disabled={busy || !note.trim()} busy={busy}
            onConfirm={() => act('reject', 'Return request rejected')}>Reject with reason</ConfirmTransaction>
        </div>
      </>}
      {selected && str(selected.status) === 'approved' && <ConfirmTransaction
        title="Confirm physical dispatch to supplier?" description={str(selected.source) === 'receiving_rejection'
          ? 'The goods were rejected before stock posting; no inventory quantity will be deducted.'
          : 'The quarantine hold will be released and the returned quantity deducted exactly once with a stock ledger movement.'}
        confirmLabel="Confirm supplier dispatch" disabled={busy} busy={busy}
        onConfirm={() => act('dispatch', 'Goods dispatched to supplier')}>Dispatch approved return</ConfirmTransaction>}
      {selected && str(selected.status) === 'dispatched' && !selected.supplier_acknowledged_at && <>
        <label className={inputClass}><span>Supplier representative</span>
          <input value={representative} onChange={event => setRepresentative(event.target.value)} />
        </label>
        <label className={inputClass}><span>Supplier credit note reference (optional)</span>
          <input value={credit} onChange={event => setCredit(event.target.value)} />
        </label>
        <button className={buttonClass} disabled={busy || !representative.trim()}
          onClick={() => void act('acknowledge', 'Supplier acknowledgement recorded', {
            acknowledged_by: representative.trim(), credit_note_number: credit.trim(),
          })}>Record supplier acknowledgement</button>
      </>}
      {rows.length === 0 && <p className="mc-alert mc-muted">No supplier return reports yet. Receiving Clerks and Store Keepers can submit them from their own sidebar.</p>}
    </>}
  </section>
}
