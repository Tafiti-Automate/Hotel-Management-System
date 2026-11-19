import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icon } from '../components/Icon'
import ConfirmTransaction from '../components/ConfirmTransaction'
import WorkflowPrerequisite from '../components/WorkflowPrerequisite'
import { createBackendRecord, errorMessage, readBackendPayload, runBackendAction } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

type Source = {
  requests: Row[]
  lines: Row[]
  stores: Row[]
  balances: Row[]
  destinations: Row[]
  items: Row[]
  units: Row[]
  issues: Row[]
  issueItems: Row[]
}
type DraftLine = { key: number; article: string; unit: string; quantity: string; remarks: string }
const empty: Source = {
  requests: [], lines: [], stores: [], balances: [], destinations: [],
  items: [], units: [], issues: [], issueItems: [],
}
const sid = (value: unknown) => String(value ?? '')
const articleLabel = (row: Row) => sid(row.sku) + ' — ' + sid(row.name)
const newLine = (key: number): DraftLine => ({ key, article: '', unit: '', quantity: '', remarks: '' })

function useOutletWorkflow() {
  const app = useApp()
  const [data, setData] = useState<Source>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await readBackendPayload('store-requisitions/workflow')
      setData({ ...empty, ...payload } as Source)
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Outlet records unavailable', message)
    } finally {
      setLoading(false)
    }
  }, [app.showWorkflowAlert])
  useEffect(() => { void load() }, [load])
  return { app, data, loading, error, setError, load }
}

/** A controlled header/detail builder using the existing Django transaction engine. */
export function InternalRequestBuilder() {
  const { app, data, loading, error, setError } = useOutletWorkflow()
  const [store, setStore] = useState('')
  const [storeSearch, setStoreSearch] = useState('')
  const [destination, setDestination] = useState('')
  const [destinationSearch, setDestinationSearch] = useState('')
  const storeSearchRef = useRef<HTMLInputElement>(null)
  const destinationSearchRef = useRef<HTMLInputElement>(null)
  const [purpose, setPurpose] = useState('')
  const [rows, setRows] = useState<DraftLine[]>([newLine(1)])
  const [busy, setBusy] = useState(false)
  const nextId = useRef(2)
  const tableRef = useRef<HTMLTableElement>(null)

  const storeLabel = (row: Row) =>
    [sid(row.name), sid(row.branch_name)].filter(Boolean).join(' · ')
  useEffect(() => {
    if (!store && !storeSearch && data.stores.length === 1) {
      setStore(sid(data.stores[0].id))
      setStoreSearch(storeLabel(data.stores[0]))
    }
  }, [data.stores, store, storeSearch])
  useEffect(() => {
    if (!destination && !destinationSearch && data.destinations.length === 1) {
      setDestination(sid(data.destinations[0].id))
      setDestinationSearch(sid(data.destinations[0].name))
    }
  }, [data.destinations, destination, destinationSearch])

  const articleMap = useMemo(
    () => new Map(data.items.map((item) => [articleLabel(item), item])),
    [data.items],
  )
  const update = (key: number, patch: Partial<DraftLine>) => {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row))
  }
  const appendLine = () => setRows((current) => [...current, newLine(nextId.current++)])
  const addFromKeyboard = (event: ReactKeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    appendLine()
    window.requestAnimationFrame(() => {
      const fields = tableRef.current?.querySelectorAll<HTMLInputElement>('[data-article-search]')
      fields?.[index + 1]?.focus()
    })
  }
  const isAvailable = (itemId: string) => {
    const entries = data.balances.filter((b) => sid(b.item) === itemId && sid(b.store) === store)
    if (!entries.length) return false
    return entries.some((row) => row.in_stock === true || Number(row.available || 0) > 0)
  }
  const validate = () => {
    if (!store || !data.stores.some((row) => sid(row.id) === store && storeLabel(row) === storeSearch)) {
      return 'Search and select a valid issuing store.'
    }
    if (!destination || !data.destinations.some(
      (row) => sid(row.id) === destination && sid(row.name) === destinationSearch,
    )) {
      return 'Search and select your authorized destination cost center.'
    }
    const prepared = rows.map((row) => {
      const item = articleMap.get(row.article)
      return { item: sid(item?.id), unit: row.unit || sid(item?.base_unit), quantity: row.quantity, remarks: row.remarks }
    })
    if (prepared.some((line) => !line.item || !(Number(line.quantity) > 0) || !Number.isFinite(Number(line.quantity)))) {
      return 'Select an Article and a positive quantity in every row.'
    }
    const uniques = new Set(prepared.map((line) => line.item + ':' + line.unit))
    if (uniques.size !== prepared.length) return 'The same Article and unit cannot appear twice.'
    return ''
  }
  const save = async (submit: boolean) => {
    const message = validate()
    if (message) { setError(message); return }
    setBusy(true)
    setError('')
    try {
      const prepared = rows.map((row) => {
        const item = articleMap.get(row.article)
        return {
          item: sid(item?.id), unit: row.unit || sid(item?.base_unit) || null,
          quantity: row.quantity, remarks: row.remarks,
        }
      })
      const draft = await createBackendRecord('store-requisitions/create-with-lines', {
        store, destination_department: destination, purpose, lines: prepared, submit,
      })
      app.showToast(submit
        ? sid(draft.requisition_no) + ' submitted to Department Head'
        : sid(draft.requisition_no) + ' saved as draft')
      app.navTo('workflow-stores', 'My requests')
      void app.refreshData()
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Requisition could not be saved', message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="bp-workspace">
    <header className="bp-heading">
      <div><span className="bp-eyebrow">Outlet operations / Requisition</span><h1>New internal requisition</h1>
        <p>Request stock from Stores. Article prices and exact warehouse quantities are restricted.</p></div>
      <button type="button" className="bp-quiet" onClick={() => app.navTo('workflow-stores', 'My requests')}>Back to my requests</button>
    </header>
    {error && <p className="bp-error" role="alert">{error}</p>}
    {loading ? <div className="bp-panel" role="status">Loading authorized stores and articles…</div> : <>
      <section className="bp-panel bp-document-head" aria-label="Document information">
        <div className="bp-panel-title"><h2>Request details</h2><span className="bp-state">New draft</span></div>
        <div className="bp-fields">
          <label>Source store <b>*</b>
            <span className="bp-search-combo" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input ref={storeSearchRef} type="search" list="bp-store-search-options"
                aria-label="Search source store" autoComplete="off"
                value={storeSearch} disabled={busy}
                onChange={(event) => {
                  const value = event.target.value
                  setStoreSearch(value)
                  setStore(sid(data.stores.find((row) => storeLabel(row) === value)?.id))
                }}
                placeholder="Search for an issuing store" />
              <button type="button" className="bp-quiet" aria-label="Search source stores"
                disabled={busy} onClick={() => storeSearchRef.current?.focus()}>
                <Icon name="search" size={18} />
              </button>
            </span>
            <datalist id="bp-store-search-options">
              {data.stores.map((row) => <option key={sid(row.id)} value={storeLabel(row)} />)}
            </datalist>
          </label>
          <label>Destination cost center <b>*</b>
            <span className="bp-search-combo" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input ref={destinationSearchRef} type="search" list="bp-cost-center-options"
                aria-label="Search destination cost center" autoComplete="off"
                value={destinationSearch} disabled={busy}
                onChange={(event) => {
                  const value = event.target.value
                  setDestinationSearch(value)
                  setDestination(sid(data.destinations.find((row) => sid(row.name) === value)?.id))
                }}
                placeholder="Search authorized cost center" />
              <button type="button" className="bp-quiet" aria-label="Search destination cost centers"
                disabled={busy} onClick={() => destinationSearchRef.current?.focus()}>
                <Icon name="search" size={18} />
              </button>
            </span>
            <datalist id="bp-cost-center-options">
              {data.destinations.map((row) => <option key={sid(row.id)} value={sid(row.name)} />)}
            </datalist>
            <small className="bp-muted">Only your assigned cost center is authorized for this requisition.</small>
          </label>
          <label className="bp-grow">Purpose / shift note
            <input value={purpose} disabled={busy} maxLength={300} onChange={(event) => setPurpose(event.target.value)} placeholder="e.g. Breakfast service restocking" />
          </label>
        </div>
      </section>
      <section className="bp-panel" aria-label="Article details">
        <div className="bp-panel-title"><div><h2>Requested articles</h2><p>Tab moves across the grid. Press Enter in Remarks to add the next line.</p></div><button type="button" className="bp-quiet" disabled={busy || rows.length >= 100} onClick={appendLine}><Icon name="add" size={16} /> Add line</button></div>
        <datalist id="bp-article-options">{data.items.map((item) => <option key={sid(item.id)} value={articleLabel(item)} />)}</datalist>
        <div className="bp-table-scroll"><table className="bp-grid" ref={tableRef}>
          <thead><tr><th scope="col">#</th><th scope="col">Article / SKU</th><th scope="col">Store status</th><th scope="col">Issue unit</th><th scope="col">Requested qty</th><th scope="col">Remarks</th><th scope="col"><span className="bp-visually-hidden">Remove</span></th></tr></thead>
          <tbody>{rows.map((row, index) => {
            const item = articleMap.get(row.article)
            const inStock = item ? isAvailable(sid(item.id)) : null
            return <tr key={row.key}>
              <td className="bp-row-number">{index + 1}</td>
              <td><input data-article-search list="bp-article-options" value={row.article} disabled={busy} onChange={(event) => {
                const selected = articleMap.get(event.target.value)
                update(row.key, { article: event.target.value, unit: sid(selected?.base_unit) })
              }} aria-label={'Article, line ' + (index + 1)} placeholder="Search name or SKU" /></td>
              <td>{inStock === null ? <span className="bp-muted">Select article</span> : <span className={inStock ? 'bp-availability in' : 'bp-availability out'}>{inStock ? 'In stock' : 'Out of stock'}</span>}</td>
              <td><select value={row.unit} disabled={busy} onChange={(event) => update(row.key, { unit: event.target.value })} aria-label={'Issue unit, line ' + (index + 1)}>
                <option value="">Base unit</option>{data.units.map((unit) => <option key={sid(unit.id)} value={sid(unit.id)}>{sid(unit.abbreviation || unit.name)}</option>)}
              </select></td>
              <td><input type="number" min="0.01" step="0.01" inputMode="decimal" value={row.quantity} disabled={busy} onChange={(event) => update(row.key, { quantity: event.target.value })} aria-label={'Quantity, line ' + (index + 1)} /></td>
              <td><input type="text" maxLength={255} value={row.remarks} disabled={busy} onKeyDown={(event) => addFromKeyboard(event, index)} onChange={(event) => update(row.key, { remarks: event.target.value })} aria-label={'Remarks, line ' + (index + 1)} placeholder="Optional" /></td>
              <td><button type="button" className="bp-remove" aria-label={'Remove line ' + (index + 1)} disabled={busy || rows.length === 1} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}><Icon name="close" size={16} /></button></td>
            </tr>
          })}</tbody>
        </table></div>
        <div className="bp-footer"><span>{rows.length} line{rows.length === 1 ? '' : 's'} · Approval: HOD → Cost Control → Stores</span>
          <div className="bp-actions"><button type="button" className="bp-quiet" disabled={busy} onClick={() => void save(false)}>Save draft</button>
            <button type="button" className="bp-primary" disabled={busy} onClick={() => void save(true)}>{busy ? 'Saving…' : 'Submit request'} <Icon name="arrow_forward" size={16} /></button></div>
        </div>
      </section>
    </>}
  </div>
}

function printIssueVoucher(issue: Row, lines: Row[], preparedFor: string): boolean {
  if (!lines.length) return false
  const escapeHtml = (value: unknown) => sid(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const signed = Boolean(issue.signed_at && issue.received_by)
  const rows = lines.map((line, index) =>
    '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(line.item_name || 'Article unavailable') +
    '</td><td>' + escapeHtml(line.base_quantity) + '</td><td>' + escapeHtml(line.unit_name) + '</td></tr>'
  ).join('')
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Stock Issue Voucher ' +
    escapeHtml(issue.issue_no) + '</title><style>@page{size:A4 portrait;margin:15mm}body{font:12px Arial,sans-serif;color:#18352c}header{border-bottom:3px solid #166446;padding-bottom:12px}h1{font-size:21px}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #a7bcb1;padding:9px;text-align:left}th{background:#ecf3ee}.meta{line-height:1.9}.sig{display:grid;grid-template-columns:1fr 1fr;gap:45px;margin-top:65px}.sig div{padding-top:7px;border-top:1px solid #496a59}small{color:#577063}</style></head><body><header><h1>STOCK ISSUE / DEPARTMENT PICKUP VOUCHER</h1><small>Hotel ERP · Materials & Cost Control</small></header>' +
    '<section class="meta"><b>Issue no.:</b> ' + escapeHtml(issue.issue_no) +
    '<br><b>Issue date:</b> ' + escapeHtml(issue.issue_date) +
    '<br><b>Issuing store:</b> ' + escapeHtml(issue.store_name) +
    '<br><b>Status:</b> ' + (signed ? 'Signed and received' : 'Awaiting physical handover') +
    '<br><b>Signed receiver:</b> ' + escapeHtml(issue.received_by_name || 'Not signed') +
    '</section><table><thead><tr><th>#</th><th>Article</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>' + rows +
    '</tbody></table><section class="sig"><div>Issued by Storekeeper<br>Name / signature: ____________________<br>Date: __________</div>' +
    '<div>Received by Department<br>Name / signature: ____________________<br>Date: __________</div></section><p><small>Printed by ' +
    escapeHtml(preparedFor) + ' · ' + escapeHtml(new Date().toLocaleString('en-UG')) +
    '. Blank signature fields are not digital signatures. Electronic pickup is authoritative in the system.</small></p></body></html>'
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.document.write(html)
  popup.document.close()
  popup.focus()
  popup.print()
  return true
}

export function IncomingPickup() {
  const { app, data, loading, error, setError, load } = useOutletWorkflow()
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState('')
  const [agreed, setAgreed] = useState(false)
  const candidate = data.issues.find((row) => sid(row.id) === selected)
  const items = candidate ? data.issueItems.filter((row) => sid(row.issue) === sid(candidate.id)) : []
  const ready = candidate?.fulfillment_status === 'in_transit'
    || (candidate?.inventory_changes_applied === true && !candidate?.received_by && !candidate?.fulfillment_status)
  const acknowledge = async () => {
    if (!candidate || !ready || !agreed) return
    setBusy(true); setError('')
    try {
      await runBackendAction('stock-issues', sid(candidate.id), 'acknowledge')
      await load()
      await app.refreshData()
      setAgreed(false)
      app.showToast('Pickup signed · virtual transit cleared and department issue recorded')
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Pickup confirmation failed', message)
    } finally { setBusy(false) }
  }

  return <div className="bp-workspace">
    <header className="bp-heading"><div><span className="bp-eyebrow">Outlet operations / Handover</span><h1>Incoming stock & pickup</h1>
      <p>Verify packed items against the Storekeeper's issue voucher. Only posted issues can be signed.</p></div>
      <button type="button" className="bp-quiet" disabled={loading} onClick={() => void load()}><Icon name="refresh" size={16} /> Refresh</button>
    </header>
    {error && <p className="bp-error" role="alert">{error}</p>}
    {loading ? <div className="bp-panel" role="status">Loading incoming issues…</div> : <div className="bp-master">
      <section className="bp-panel bp-incoming-list"><div className="bp-panel-title"><h2>My store issues</h2><span>{data.issues.length}</span></div>
        {!data.issues.length && <p className="bp-muted">No issue vouchers are ready or awaiting handover.</p>}
        {data.issues.map((issue) => <button type="button" key={sid(issue.id)} className={selected === sid(issue.id) ? 'bp-issue selected' : 'bp-issue'} onClick={() => { setSelected(sid(issue.id)); setAgreed(false) }}>
          <strong>{sid(issue.issue_no)}</strong><small>{sid(issue.store_name)}</small>
          <span className={issue.received_by ? 'bp-state done' : issue.inventory_changes_applied ? 'bp-state ready' : 'bp-state'}>{issue.received_by ? 'Signed' : issue.inventory_changes_applied ? 'Ready for confirmation' : 'Pending Stores post'}</span>
        </button>)}
      </section>
      <section className="bp-panel">
        {!candidate ? <div className="bp-empty">Select an issue voucher to check the item list.</div> : <>
          <WorkflowPrerequisite domain="stock_issue" record={{...candidate, status: ready ? 'in_transit' : candidate.fulfillment_status || 'packed'}} action="acknowledge"/>
          <div className="bp-panel-title"><div><span className="bp-eyebrow">Issue voucher</span><h2>{sid(candidate.issue_no)}</h2><p>{sid(candidate.store_name)} · {sid(candidate.issue_date)}</p></div><span className={candidate.received_by ? 'bp-state done' : 'bp-state'}>{candidate.received_by ? 'Received' : candidate.fulfillment_status === 'in_transit' ? 'In transit · awaiting signature' : candidate.inventory_changes_applied ? 'Posted by Stores' : 'Prepared'}</span><button className="bp-quiet" type="button" disabled={!items.length} onClick={()=>{if(!printIssueVoucher(candidate,items,app.user.name)) app.showWorkflowAlert('Issue voucher cannot print','Select a voucher with articles and allow pop-ups in your browser.','warning')}}><Icon name="print" size={16}/> Print voucher</button></div>
          <div className="bp-table-scroll"><table className="bp-grid"><thead><tr><th>Article</th><th>Issued quantity</th><th>Unit</th></tr></thead><tbody>
            {items.map((line) => <tr key={sid(line.id)}><td><strong>{sid(line.item_name)}</strong></td><td>{sid(line.base_quantity)}</td><td>{sid(line.unit_name)}</td></tr>)}
          </tbody></table></div>
          {candidate.received_by ? <p className="bp-confirmed">Signed by {sid(candidate.received_by_name) || 'requesting supervisor'}.</p>
            : <div className="bp-handover"><label><input type="checkbox" checked={agreed} disabled={!ready || busy} onChange={(event) => setAgreed(event.target.checked)} /> I have physically checked the articles and quantities shown above.</label>
              <ConfirmTransaction
                title={'Sign pickup for issue ' + sid(candidate.issue_no) + '?'}
                description={'Confirm that you physically collected all ' + items.length + ' article line(s) listed on this issue. Your signature clears virtual transit, records department consumption and cannot be submitted twice.'}
                confirmLabel="Sign physical pickup"
                className="bp-primary"
                disabled={!ready || !agreed || busy || !items.length}
                busy={busy}
                onConfirm={acknowledge}
              >{busy ? 'Confirming…' : 'Confirm & sign receipt'}</ConfirmTransaction>
              {!ready && <p className="bp-muted">Awaiting posting by the assigned Storekeeper. Stock cannot be acknowledged earlier.</p>}
            </div>}
        </>}
      </section>
    </div>}
  </div>
}
