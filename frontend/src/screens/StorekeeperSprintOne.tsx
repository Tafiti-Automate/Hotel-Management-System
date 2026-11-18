import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import ConfirmTransaction from '../components/ConfirmTransaction'
import WorkflowPrerequisite from '../components/WorkflowPrerequisite'
import { escapeHtml } from '../features/shared/html'
import { createBackendRecord, errorMessage, readBackendRecords, runBackendAction } from '../lib/api'
import { useApp } from '../state/AppContext'
import '../operational-blueprint.css'

type GrnLine = {
  id: string; item_name: string; sku: string; ordered_quantity: string
  previously_received_quantity: string; due_before_delivery: string
  received_quantity: string; accepted_quantity: string; difference: number
  unit_name: string; store_name: string; matches_lpo_limit: boolean
}
type GrnRecord = {
  id: string; grn_number: string; lpo_number: string; supplier_name: string
  received_date: string; received_by_name: string; status: string
  fiscal_period_status: string; fiscal_period_name: string
  lines: GrnLine[]
}
type PickLine = {
  id: string; item: string; article: string; sku: string; unit: string
  bin: string; requested: string; approved: string; outstanding: string
  physical_soh: string; suggested_issue: string
}
type PickRequest = {
  id: string; reference: string; department: string; store: string
  status: string; required_date: string; lines: PickLine[]
}
const ident = (value: unknown) => String(value ?? '')
const qty = (value: unknown) => Number(value || 0).toLocaleString('en-UG', { maximumFractionDigits: 4 })
const validQuantity = (raw: string, ceiling: number, physical: number) => {
  if (!raw.trim() || !/^\d+(?:\.\d{1,4})?$/.test(raw.trim())) return false
  const number = Number(raw)
  return Number.isFinite(number) && number >= 0 && number <= ceiling && number <= physical
}

function useStorekeeperQueue<T>(path: string) {
  const app = useApp()
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setItems((await readBackendRecords(path)) as unknown as T[])
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Stores data could not be loaded', message)
    } finally {
      setLoading(false)
    }
  }, [path, app.showWorkflowAlert])
  useEffect(() => { void refresh() }, [refresh])
  return { app, items, loading, error, setError, refresh }
}

export function GrnPostingConsole() {
  const { app, items: grns, loading, error, setError, refresh } = useStorekeeperQueue<GrnRecord>('grns/unposted-queue')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = grns.find((record) => record.id === selectedId) || null
  const filtered = useMemo(() => grns.filter((record) =>
    [record.grn_number, record.lpo_number, record.supplier_name]
      .some((field) => field?.toLowerCase().includes(search.toLowerCase()))
  ), [grns, search])
  const post = async () => {
    if (!selected || busy || selected.fiscal_period_status !== 'open') return
    setBusy(true); setError('')
    try {
      await runBackendAction('grns', selected.id, 'post-to-inventory')
      app.showToast('GRN ' + selected.grn_number + ' posted · stock and WAC updated')
      await refresh()
      await app.refreshData()
      setSelectedId('')
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('GRN posting failed', message)
    } finally { setBusy(false) }
  }

  return <div className="bp-workspace">
    <header className="bp-heading"><div><span className="bp-eyebrow">Stores / Goods receiving</span><h1>GRN posting</h1>
      <p>Compare the Receiving Clerk's blind count with the approved LPO. Only accepted quantities enter stock.</p></div>
      <button type="button" className="bp-quiet" onClick={() => void refresh()} disabled={loading || busy}><Icon name="refresh" size={16} /> Refresh</button>
    </header>
    {error && <div className="bp-error" role="alert">{error}</div>}
    <div className="sk-kpis">
      <div><span>Unposted GRNs</span><strong>{grns.length}</strong></div>
      <div><span>Ready to post</span><strong>{grns.filter((record) => record.fiscal_period_status === 'open').length}</strong></div>
      <div><span>Fiscal action required</span><strong>{grns.filter((record) => record.fiscal_period_status !== 'open').length}</strong></div>
    </div>
    <div className="bp-master sk-grn">
      <section className="bp-panel bp-incoming-list">
        <div className="bp-panel-title"><h2>Received · Unposted</h2><small>{filtered.length} records</small></div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search received GRNs" placeholder="Search GRN, PO or supplier…" />
        <div className="sk-queue">
          {filtered.map((record) => <button type="button" className={'bp-issue' + (selected?.id === record.id ? ' selected' : '')} key={record.id} onClick={() => setSelectedId(record.id)}>
            <span className="sk-document-row"><strong>{record.grn_number}</strong><span className={'bp-state' + (record.fiscal_period_status === 'open' ? ' ready' : '')}>{record.fiscal_period_status === 'open' ? 'Open' : 'Blocked'}</span></span>
            <small>{record.supplier_name} · PO {record.lpo_number}</small>
            <small>{record.received_date} · {record.lines.length} articles</small>
          </button>)}
          {!loading && !filtered.length && <div className="bp-empty">No matching unposted GRNs.</div>}
          {loading && <div className="bp-empty">Loading the receiving queue…</div>}
        </div>
      </section>
      <section className="bp-panel">
        {!selected ? <div className="bp-empty"><Icon name="move_to_inbox" size={23} /><p>Select a GRN to verify its counted and accepted quantities.</p></div> : <>
          <div className="bp-panel-title">
            <div><span className="bp-eyebrow">Storekeeper verification</span><h2>{selected.grn_number}</h2>
              <p>PO {selected.lpo_number} · {selected.supplier_name}</p></div>
            <span className={selected.fiscal_period_status === 'open' ? 'bp-state ready' : 'bp-state'}>{selected.fiscal_period_name} · {selected.fiscal_period_status}</span>
          </div>
          <WorkflowPrerequisite domain="goods_receipt" record={selected} action="post"/>
          {selected.fiscal_period_status !== 'open' && <div className="mc-workflow-prerequisite" role="status"><Icon name="info" size={17}/><div><strong>GRN posting blocked by fiscal control</strong><p>The selected fiscal period is not open. No stock is posted.</p><small>Next: Ask Finance to review the fiscal period; never bypass a closed period.</small></div></div>}
          <div className="sk-grn-meta">
            <span><small>Received on</small><strong>{selected.received_date}</strong></span>
            <span><small>Receiving Clerk</small><strong>{selected.received_by_name}</strong></span>
            <span><small>Posting effect</small><strong>Accepted goods only</strong></span>
          </div>
          <div className="bp-table-scroll"><table className="bp-grid sk-grn-table">
            <thead><tr><th>Article</th><th>LPO ordered</th><th>Prior received</th><th>Physical count</th><th>Accepted</th><th>Variance</th><th>Destination</th></tr></thead>
            <tbody>{selected.lines.map((line) => {
              const difference = Number(line.difference)
              return <tr key={line.id}>
                <td><strong>{line.item_name}</strong><small>{line.sku}</small></td>
                <td>{qty(line.ordered_quantity)} {line.unit_name}</td>
                <td>{qty(line.previously_received_quantity)}</td>
                <td>{qty(line.received_quantity)}</td>
                <td><strong>{qty(line.accepted_quantity)}</strong></td>
                <td><span className={'sk-variance' + (difference < 0 ? ' shortage' : difference > 0 ? ' excess' : ' exact')}>
                  {difference > 0 ? '+' : ''}{qty(difference)}
                </span></td>
                <td>{line.store_name || 'Direct department issue'}</td>
              </tr>
            })}</tbody>
          </table></div>
          <div className="bp-footer">
            <div><strong>Controlled posting</strong><p>Updates Store SOH, weighted average cost and immutable GRN receipt ledger rows.</p></div>
            <ConfirmTransaction title={'Post GRN ' + selected.grn_number + '?'} description="This will post accepted quantities to inventory and cannot be repeated. Confirm against the physical delivery and inspection." confirmLabel="Post to inventory" className="bp-primary" disabled={busy || selected.fiscal_period_status !== 'open'} busy={busy} onConfirm={post}><Icon name="check_circle" size={16} /> Post to inventory</ConfirmTransaction>
          </div>
          {selected.fiscal_period_status !== 'open' && <p className="bp-error" role="alert">The GRN belongs to a closed or unconfigured fiscal period. Posting is blocked until the period is valid and open.</p>}
        </>}
      </section>
    </div>
  </div>
}

function printBatch(type: 'picking' | 'packing', selected: PickRequest[], valueFor: (req: PickRequest, line: PickLine) => string): boolean {
  if (!selected.length) return false
  const lines = selected.flatMap((req) => req.lines.map((line) => ({
    request: req.reference, department: req.department, store: req.store,
    bin: line.bin || 'Unassigned', sku: line.sku, article: line.article,
    unit: line.unit, quantity: valueFor(req, line),
  }))).filter((line) => Number(line.quantity) > 0)
    .sort((a, b) => a.store.localeCompare(b.store) || a.bin.localeCompare(b.bin) || a.sku.localeCompare(b.sku))
  const columns = type === 'picking' ? ['Store', 'Aisle / bin', 'SKU', 'Article', 'Base Qty', 'Unit', 'Request'] : ['Department', 'Article', 'Base Qty', 'Unit', 'Request']
  const clean = escapeHtml
  const rows = lines.map((line) => type === 'picking'
    ? [line.store, line.bin, line.sku, line.article, qty(line.quantity), line.unit, line.request]
    : [line.department, line.article, qty(line.quantity), line.unit, line.request]
  )
  const html = `<!doctype html><html><head><meta charset="UTF-8"><title>Stores ${type} list</title><style>
    body{font-family:Arial,sans-serif;color:#172b24;padding:32px}
    h1{font-size:23px;margin-bottom:4px}p{color:#647067}
    table{width:100%;border-collapse:collapse;margin-top:25px}th{background:#eff5f0;text-align:left}
    th,td{padding:10px;border-bottom:1px solid #dbe4dc;font-size:12px}
    .sig{display:flex;justify-content:space-between;margin-top:55px}.sig div{width:38%;border-top:1px solid #78887c;padding-top:8px}
    @media print{body{padding:8px}}
  </style></head><body><h1>${type === 'picking' ? 'Consolidated Picking List' : 'Packing List'}</h1>
  <p>Stores · ${clean(String(selected.length))} requisitions · ${clean(new Date().toLocaleString('en-UG'))}</p>
  <table><thead><tr>${columns.map((header) => '<th>' + clean(header) + '</th>').join('')}</tr></thead>
  <tbody>${rows.map((row) => '<tr>' + row.map((column) => '<td>' + clean(column) + '</td>').join('') + '</tr>').join('')}</tbody></table>
  <div class="sig"><div>Storekeeper signature / date</div><div>Supervisor signature / date</div></div></body></html>`
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.document.write(html)
  popup.document.close()
  popup.focus()
  popup.print()
  return true
}

export function TransferDispatchConsole() {
  const { app, items: requests, loading, error, setError, refresh } = useStorekeeperQueue<PickRequest>('store-requisitions/fulfillment-queue')
  const [selected, setSelected] = useState<string[]>([])
  const [quantities, setQuantities] = useState<Record<string, Record<string, string>>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const filtered = useMemo(() => requests.filter((record) =>
    [record.reference, record.department, record.store]
      .some((field) => field.toLowerCase().includes(search.toLowerCase()))
  ), [requests, search])
  const chosen = requests.filter((record) => selected.includes(record.id))
  const valueFor = (req: PickRequest, line: PickLine) =>
    quantities[req.id]?.[line.id] ?? ident(line.suggested_issue)
  const setLineQuantity = (reqId: string, lineId: string, value: string) => {
    setQuantities((old) => ({
      ...old, [reqId]: { ...(old[reqId] || {}), [lineId]: value },
    }))
  }
  const invalid = chosen.some((req) =>
    !req.lines.some((line) => Number(valueFor(req, line)) > 0)
    || req.lines.some((line) => !validQuantity(
      valueFor(req, line), Number(line.outstanding), Number(line.physical_soh),
    ))
  )
  const linesTotal = chosen.reduce((total, record) =>
    total + record.lines.reduce((sub, line) => sub + Number(valueFor(record, line) || 0), 0), 0)
  const toggle = (id: string) => setSelected((ids) => ids.includes(id)
    ? ids.filter((value) => value !== id)
    : [...ids, id]
  )
  const dispatch = async () => {
    if (!chosen.length || !linesTotal || invalid || busy) return
    setBusy(true); setError('')
    try {
      const results = await createBackendRecord('store-requisitions/dispatch-batch', {
        requests: chosen.map((req) => ({
          id: req.id, quantities: Object.fromEntries(
            req.lines.map((line) => [line.id, valueFor(req, line)]),
          ),
        })),
      })
      app.showToast((Array.isArray(results) ? results.length : chosen.length) + ' transfer(s) dispatched to virtual transit')
      setSelected([]); setQuantities({})
      await refresh()
      await app.refreshData()
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Dispatch could not be completed', message)
    } finally { setBusy(false) }
  }

  return <div className="bp-workspace">
    <header className="bp-heading"><div><span className="bp-eyebrow">Stores / Fulfillment</span><h1>Transfer dispatch</h1>
      <p>Pack approved requisitions, choose actual issue quantities, then dispatch goods into controlled transit.</p></div>
      <button type="button" className="bp-quiet" disabled={busy || loading} onClick={() => void refresh()}><Icon name="refresh" size={16} /> Refresh</button>
    </header>
    {error && <div className="bp-error" role="alert">{error}</div>}
    <div className="sk-kpis"><div><span>Ready to fulfill</span><strong>{requests.length}</strong></div>
      <div><span>Selected requisitions</span><strong>{chosen.length}</strong></div>
      <div><span>Base units to dispatch</span><strong>{qty(linesTotal)}</strong></div></div>
    <section className="bp-panel">
      <div className="bp-panel-title"><div><h2>Approved department requests</h2><p>Only Cost-Control-approved requests for your assigned stores appear here.</p></div>
        <input className="sk-filter" aria-label="Search requisitions" placeholder="Filter store, request or department…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="sk-batch-actions">
        <label><input type="checkbox" aria-label="Select all visible requisitions" checked={filtered.length > 0 && filtered.every((row) => selected.includes(row.id))} onChange={(event) => setSelected((current) => event.target.checked ? Array.from(new Set([...current, ...filtered.map((row) => row.id)])) : current.filter((id) => !filtered.some((row) => row.id === id)))} /> Select visible</label>
        <button className="bp-quiet" type="button" disabled={!chosen.length || busy} onClick={() => { if (!printBatch('picking', chosen, valueFor)) app.showWorkflowAlert('Unable to print picking list', 'Allow pop-up windows for this hotel system, then retry printing.') }}><Icon name="print" size={16} /> Picking list</button>
        <button className="bp-quiet" type="button" disabled={!chosen.length || busy} onClick={() => { if (!printBatch('packing', chosen, valueFor)) app.showWorkflowAlert('Unable to print packing list', 'Allow pop-up windows for this hotel system, then retry printing.') }}><Icon name="print" size={16} /> Packing list</button>
      </div>
      {loading && <div className="bp-empty">Loading assigned Storekeeper requests…</div>}
      {!loading && !filtered.length && <div className="bp-empty">No approved requisitions are awaiting dispatch.</div>}
      {filtered.map((req) => <div className="sk-request" key={req.id}>
        <div className="sk-request-title"><label><input type="checkbox" checked={selected.includes(req.id)} onChange={() => toggle(req.id)} />
          <span><strong>{req.reference}</strong><small>{req.department} · {req.store}</small></span></label>
          <span className="bp-state ready">{req.status.replace(/_/g, ' ')}</span>
        </div>
        {selected.includes(req.id) && <div className="bp-table-scroll"><table className="bp-grid sk-picking-grid">
          <thead><tr><th>Bin</th><th>Article</th><th>Approved outstanding</th><th>Physical SOH</th><th>Issue qty</th><th>Unit</th></tr></thead>
          <tbody>{req.lines.map((line) => {
            const raw = valueFor(req, line)
            const correct = validQuantity(raw, Number(line.outstanding), Number(line.physical_soh))
            return <tr key={line.id}>
              <td>{line.bin || 'Unassigned'}</td>
              <td><strong>{line.article}</strong><small>{line.sku}</small></td>
              <td>{qty(line.outstanding)}</td>
              <td>{qty(line.physical_soh)}</td>
              <td><input aria-label={'Issue quantity for ' + line.article + ' / ' + req.reference} type="number" min="0" step="0.0001" max={Math.min(Number(line.outstanding), Number(line.physical_soh))} value={raw} onChange={(event) => setLineQuantity(req.id, line.id, event.target.value)} className={correct ? '' : 'sk-invalid-input'} />{!correct && <small role="alert">Must be within approved and physical stock limits.</small>}</td>
              <td>{line.unit}</td>
            </tr>
          })}</tbody>
        </table></div>}
      </div>)}
      <div className="bp-footer"><span>Dispatch deducts the issuing store and credits a virtual transit store. Outlet consumption posts only on signed pickup.</span>
        <ConfirmTransaction title="Dispatch selected transfers?" description="This posts stock out of Stores and into virtual transit. The department must sign pickup before transit is cleared." confirmLabel="Dispatch transfers" className="bp-primary" disabled={busy || !chosen.length || !linesTotal || invalid} busy={busy} onConfirm={dispatch}><Icon name="local_shipping" size={16} /> Dispatch selected</ConfirmTransaction>
      </div>
    </section>
  </div>
}
