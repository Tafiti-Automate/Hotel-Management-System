import { useCallback, useEffect, useState } from 'react'
import { createBackendRecord, errorMessage, readBackendRecords, readBackendPayload, runBackendAction } from '../lib/api'
import { useApp } from '../state/AppContext'
import type { Row } from '../lib/data'

type Batch = { id: string; batch_number: string; expiry_date: string | null; physical_quantity: string | null; system_quantity?: string }
type Line = {
  id: string; article: string; sku: string; item_group: string; unit: string
  physical_quantity: string | null; note: string; system_quantity?: string
  unit_cost?: string; variance?: string; variance_value?: string; closing_value?: string
  batch_required?: boolean; batches?: Batch[]
}
type Location = {
  id: number; location_name: string; treatment: string; status: string; booked: boolean
  lines: Line[]; stock_count: string | null; difference_value: string | null; closing_value: string | null
}
type Cycle = {
  id: number; cutoff: string; memo_reference: string; memo: string; status: string
  inventories: Location[]; approval_note: string; booked_at?: string
  total_difference_value: string | null; total_closing_value: string | null
}
const resource = 'month-end-cycles'
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)
const dateLabel = (value: string) => value.replaceAll('_', ' ')

function printDocument(title: string, property: string, content: string) {
  const win = window.open('', '_blank', 'width=1024,height=760')
  if (!win) throw new Error('Allow pop-ups to open the print preview.')
  win.opener = null
  win.document.write('<!doctype html><html><head><title>' + escape(title) +
    '</title><style>@page{size:A4 landscape;margin:12mm}body{font:12px Arial;color:#111}h1,h2{text-align:center;margin:6px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #777;padding:7px;text-align:left}th{background:#eee}thead{display:table-header-group}tr{break-inside:avoid}.signature{margin-top:32px;display:flex;justify-content:space-between}p{white-space:pre-wrap}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>' +
    escape(property) + '</h1><h2>' + escape(title) + '</h2>' + content + '</body></html>')
  win.document.close()
}

export default function MonthEndStocktake() {
  const app = useApp()
  const controller = app.user.role.trim().toLowerCase() === 'cost controller'
  const finance = app.user.role.trim().toLowerCase() === 'financial manager'
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [location, setLocation] = useState<number | null>(null)
  const [departments, setDepartments] = useState<Row[]>([])
  const [deptIds, setDeptIds] = useState<string[]>([])
  const [rosterConfirmed, setRosterConfirmed] = useState(false)
  const [cutoff, setCutoff] = useState('')
  const [memoReference, setMemoReference] = useState('')
  const [memo, setMemo] = useState('')
  const [approval, setApproval] = useState('')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [batchCounts, setBatchCounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const cycle = cycles.find(c => c.id === selected) || cycles[0]
  const row = cycle?.inventories.find(r => r.id === location) || cycle?.inventories[0]
  const ready = cycle?.inventories.every(r => r.treatment === 'consumption_zero' || r.status === 'submitted')
  const editable = controller && cycle?.status === 'planned'
  const completeDraft = (l: Line) => Boolean(counts[l.id]?.trim()) && (l.batches || []).every(b => Boolean(batchCounts[b.id]?.trim()))
  const changedDraft = (l: Line) => counts[l.id] !== l.physical_quantity || (l.batches || []).some(b => batchCounts[b.id] !== b.physical_quantity)
  const property = app.user.branchName || 'Property'
  const load = useCallback(async () => {
    const values = await readBackendRecords(resource) as unknown as Cycle[]
    setCycles(values)
    if (controller) {
      const depts = await readBackendRecords('departments')
      setDepartments(depts.filter(d => d.is_active !== false))
    }
  }, [controller])
  useEffect(() => { void load().catch(e => setError(errorMessage(e))) }, [load])
  useEffect(() => {
    setCounts(Object.fromEntries((row?.lines || []).map(l => [l.id, l.physical_quantity ?? ''])))
    setNotes(Object.fromEntries((row?.lines || []).map(l => [l.id, l.note || ''])))
    setBatchCounts(Object.fromEntries((row?.lines || []).flatMap(l => (l.batches || []).map(b => [b.id, b.physical_quantity ?? '']))))
  }, [row])
  async function act(task: () => Promise<unknown>, message: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await task() as Cycle
      setCycles(previous => [result, ...previous.filter(c => c.id !== result.id)])
      setSelected(result.id); setNotice(message)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const action = (operation: string, body: Row = {}, message = 'Inventory updated') => {
    if (!cycle) return
    void act(() => runBackendAction(resource, String(cycle.id), operation, body), message)
  }
  const print = (kind: 'memo' | 'count' | 'variance') => {
    if (!cycle) return
    try {
      const header = '<p>Month end: ' + escape(cycle.cutoff) + ' &nbsp; | &nbsp; Memo: ' + escape(cycle.memo_reference) + '</p>'
      if (kind === 'memo') {
        printDocument('MONTH-END STOCKTAKE MEMO', property, header + '<p>' + escape(cycle.memo) + '</p><table><thead><tr><th>Location</th><th>Inventory treatment</th></tr></thead><tbody>' + cycle.inventories.map(r => '<tr><td>' + escape(r.location_name) + '</td><td>' + escape(dateLabel(r.treatment)) + '</td></tr>').join('') + '</tbody></table><p>Head of Cost Control: _____________________ Date: __________</p>')
      } else if (kind === 'count' && row?.treatment === 'physical_count') {
        printDocument('PHYSICAL STOCKTAKE SHEET', property, header + '<p>Location: ' + escape(row.location_name) + '</p><table><thead><tr><th>Item group</th><th>Article</th><th>Code</th><th>Unit</th><th>Physical quantity</th><th>Remarks</th></tr></thead><tbody>' + row.lines.map(l => '<tr><td>' + escape(l.item_group) + '</td><td>' + escape(l.article) + (l.batches || []).map(b => '<div>Batch: '+escape(b.batch_number || 'Unlabelled')+' · Expiry: '+escape(b.expiry_date || '—')+' · Count: __________</div>').join('') + '</td><td>' + escape(l.sku) + '</td><td>' + escape(l.unit) + '</td><td></td><td></td></tr>').join('') + '</tbody></table><div class="signature"><span>Counted by: __________________</span><span>Checked by: __________________</span><span>Date: __________</span></div>')
      } else if (kind === 'variance') {
        const report = cycle.inventories.filter(r => r.status === 'submitted' || r.booked)
        printDocument('INVENTORY DIFFERENCES BY VALUE', property, header + '<p>Status: ' + escape(cycle.status) + '</p>' +
          report.map(r => '<h3>' + escape(r.location_name) + '</h3><table><thead><tr><th>Item group</th><th>Article</th><th>Unit</th><th>System</th><th>Physical</th><th>Difference</th><th>Unit cost</th><th>Difference value</th><th>Closing value</th><th>Reason</th></tr></thead><tbody>' + r.lines.map(l => '<tr>' + [l.item_group,l.article,l.unit,l.system_quantity,l.physical_quantity,l.variance,l.unit_cost,l.variance_value,l.closing_value,l.note].map(v => '<td>' + escape(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table><p>Net difference value: ' + escape(r.difference_value) + ' | Closing value: ' + escape(r.closing_value) + '</p>').join('') + '<p>Property total difference: ' + escape(cycle.total_difference_value) + ' | Total closing value: ' + escape(cycle.total_closing_value) + '</p><div class="signature"><span>Cost Control: __________________</span><span>Finance: __________________</span></div>')
      }
    } catch (e) { setError(errorMessage(e)) }
  }
  async function printReconciliation() {
    if (!cycle || cycle.status !== 'booked') return
    try {
      const data = await readBackendPayload(resource + '/' + cycle.id + '/reconciliation') as unknown as {
        locations: { location: string; opening_value: string | null; valued_receipts: string; valued_issues: string; closing_value: string | null; difference: string | null; unvalued_movements: number; movement_categories: Record<string, {in: string; out: string; missing: number}> }[]
        blockers: string[]; direct_department_expenses: {department: string; amount: string}[]; note: string
      }
      printDocument('MONTH-END INVENTORY VALUE RECONCILIATION', property,
        '<p>Cutoff: '+escape(cycle.cutoff)+'</p><p>'+escape(data.note)+'</p><table><thead><tr><th>Location</th><th>Opening</th><th>Valued receipts</th><th>Valued issues</th><th>Closing</th><th>Difference</th><th>Missing valuations</th></tr></thead><tbody>'+
        data.locations.map(r => '<tr>'+[r.location,r.opening_value,r.valued_receipts,r.valued_issues,r.closing_value,r.difference,r.unvalued_movements].map(v => '<td>'+escape(v ?? 'Not available')+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+
        data.locations.map(r => '<h3>'+escape(r.location)+' — movement categories</h3><table><thead><tr><th>Source</th><th>Value in</th><th>Value out</th><th>Missing valuations</th></tr></thead><tbody>'+Object.entries(r.movement_categories).map(([key,v])=>'<tr>'+[key,v.in,v.out,v.missing].map(x=>'<td>'+escape(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>').join('')+
        '<h3>Direct departmental expenses (outside physical stock)</h3><table><thead><tr><th>Department</th><th>Recorded amount</th></tr></thead><tbody>'+data.direct_department_expenses.map(r=>'<tr><td>'+escape(r.department)+'</td><td>'+escape(r.amount)+'</td></tr>').join('')+'</tbody></table>'+
        '<h3>Reconciliation exceptions</h3><p>'+escape(data.blockers.join('\n') || 'No value reconciliation exceptions identified.')+'</p>')
    } catch (e) { setError(errorMessage(e)) }
  }
  if (!controller && !finance) return <section className="mc-card"><h2>Month-end inventory</h2><p>Assigned Cost Control and Finance roles only.</p></section>
  return <div className="mc-workspace" style={{ padding: 20, display: 'grid', gap: 16, color: 'var(--text)' }}>
    <header><h1>Month-end stocktake</h1><p>{property} · Physical stock and consumption department inventories</p></header>
    {error && <div role="alert" className="mc-card">{error}</div>}
    {notice && <div role="status" className="mc-card">{notice}</div>}
    {controller && <details className="mc-card"><summary>Create month-end inventory</summary>
      <form style={{display:'grid', gap: 12, marginTop:12}} onSubmit={e => {
        e.preventDefault()
        void act(() => createBackendRecord(resource, { cutoff, memo_reference: memoReference, memo, consumption_department_ids: deptIds, roster_confirmed: rosterConfirmed }), 'Month-end inventory created')
      }}>
        <label>Inventory cutoff <input type="date" required value={cutoff} onChange={e => setCutoff(e.target.value)} /></label>
        <label>Official memo reference <input required maxLength={100} value={memoReference} onChange={e => setMemoReference(e.target.value)} /></label>
        <label>Stocktake schedule and instructions <textarea required rows={4} value={memo} onChange={e => setMemo(e.target.value)} /></label>
        <fieldset><legend>Consumption-only departments (zero closing stock)</legend>
          <p>All active physical stores and outlets are included automatically. Select only departments that expense stock upon issue, not stockholding outlets.</p>
          {departments.map(d => <label key={String(d.id)} style={{display:'block'}}><input type="checkbox" checked={deptIds.includes(String(d.id))} onChange={e => { setRosterConfirmed(false); setDeptIds(old => e.target.checked ? [...old, String(d.id)] : old.filter(id => id !== String(d.id))) }} /> {String(d.name)}</label>)}
        </fieldset>
        <label><input type="checkbox" required checked={rosterConfirmed} onChange={e => setRosterConfirmed(e.target.checked)} /> I confirm the complete property roster and department classifications.</label>
        <button className="mc-primary" disabled={busy || !rosterConfirmed}>Create inventories</button>
      </form>
    </details>}
    <section className="mc-card">
      <label>Month-end inventory <select value={cycle?.id ?? ''} onChange={e => {setSelected(Number(e.target.value)); setLocation(null)}}>
        {!cycles.length && <option value="">No inventory cycles</option>}{cycles.map(c => <option key={c.id} value={c.id}>{c.cutoff} · {dateLabel(c.status)}</option>)}
      </select></label>
      <button className="mc-secondary" disabled={busy} onClick={() => void load().catch(e => setError(errorMessage(e)))}>Reload register</button>
      {cycle && <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
        <button className="mc-secondary" onClick={() => print('memo')}>Print official memo</button>
        <button className="mc-secondary" disabled={!ready && cycle.status !== 'booked' && cycle.status !== 'approved'} onClick={() => print('variance')}>Inventory Differences by Value</button>
        {finance && cycle.status === 'planned' && <><input aria-label="Finance approval note" placeholder="Finance approval note" value={approval} onChange={e => setApproval(e.target.value)} /><button className="mc-primary" disabled={busy || !ready || !approval.trim()} onClick={() => action('approve', {note:approval}, 'Inventories approved')}>Approve inventories</button></>}
        {controller && cycle.status === 'approved' && <><button className="mc-primary" disabled={busy} onClick={() => {if (window.confirm('Book all approved inventories? Posted records become read-only.')) action('book', {}, 'Inventories booked')}}>Book inventories</button><button className="mc-secondary" disabled={busy} onClick={() => {if (window.confirm('Reopen and invalidate Finance approval?')) action('reopen')}}>Reopen for review</button></>}
        {cycle.total_closing_value !== null && <p>Net difference value: <strong>{cycle.total_difference_value}</strong> · Closing inventory value: <strong>{cycle.total_closing_value}</strong></p>}
        {cycle.status === 'booked' && <button className="mc-secondary" onClick={() => void printReconciliation()}>Monthly inventory reconciliation</button>}
        {cycle.approval_note && <p>Finance approval: {cycle.approval_note}</p>}
      </div>}
    </section>
    {cycle && <section className="mc-card" style={{display:'grid',gridTemplateColumns:'minmax(180px, 280px) minmax(0,1fr)',gap:16}}>
      <aside><h2>Inventories</h2>{cycle.inventories.map(r => <button key={r.id} className="mc-secondary" aria-pressed={r.id === row?.id} style={{display:'block',width:'100%',textAlign:'left',marginBottom:6}} onClick={() => setLocation(r.id)}>{r.location_name} · {dateLabel(r.status)}</button>)}</aside>
      {row && <main style={{minWidth:0}}><h2>{row.location_name}</h2>
        {row.treatment === 'consumption_zero' ? <p>Consumption department · {row.booked ? 'Booked' : 'Planned'} closing quantity 0.0000. No duplicate consumption or expense posting.</p> : <>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
            {editable && row.status === 'count_pending' && <button className="mc-primary" disabled={busy} onClick={() => action('prepare',{inventory:row.id})}>Prepare count sheet</button>}
            {row.status !== 'count_pending' && <button className="mc-secondary" onClick={() => print('count')}>Print blind sheet</button>}
            {editable && row.status !== 'count_pending' && <button className="mc-secondary" disabled={busy} onClick={() => {if(window.confirm('Refresh the snapshot and discard every previous physical count for this location?')) action('refresh',{inventory:row.id,discard_counts:true})}}>Refresh & recount</button>}
            {editable && row.status === 'counting' && <><button className="mc-primary" disabled={busy || !row.lines.some(completeDraft)} onClick={() => action('save-count',{inventory:row.id,lines:row.lines.filter(completeDraft).map(l => ({id:l.id,physical_quantity:counts[l.id],batches:(l.batches || []).map(b => ({id:b.id,physical_quantity:batchCounts[b.id]}))}))},'Physical quantities saved')}>Save quantities</button><button className="mc-secondary" disabled={busy || row.lines.some(l => l.physical_quantity === null || changedDraft(l))} onClick={() => {if(row.lines.length || window.confirm('Confirm that the physical location is empty.')) action('submit',{inventory:row.id,confirm_empty:!row.lines.length},'Count submitted for variance review')}}>Submit saved count</button></>}
            {editable && row.status === 'submitted' && <button className="mc-primary" disabled={busy || !row.lines.some(l => notes[l.id]?.trim())} onClick={() => action('investigate',{inventory:row.id,lines:row.lines.filter(l => notes[l.id]?.trim()).map(l => ({id:l.id,note:notes[l.id]}))},'Investigation notes saved')}>Save variance notes</button>}
          </div>
          <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontVariantNumeric:'tabular-nums'}}><thead><tr>{['Item group','Article','Unit','Physical quantity',...(row.status === 'submitted' || row.booked ? ['System','Difference','Unit cost','Difference value','Closing value','Investigation'] : [])].map(h => <th key={h} style={{textAlign:'left',padding:8,borderBottom:'1px solid var(--border)'}}>{h}</th>)}</tr></thead><tbody>
            {row.lines.map(l => <tr key={l.id}>{[l.item_group,l.article,l.unit].map((v,i) => <td key={i} style={{padding:8}}>{v}{i === 1 && (l.batches || []).map(b => <div key={b.id} style={{marginTop:6,fontSize:12}}>Batch {b.batch_number || 'Unlabelled'} · Expiry {b.expiry_date || '—'} {editable && row.status === 'counting' ? <input aria-label={'Batch quantity '+b.id} type="number" min="0" step="0.0001" value={batchCounts[b.id] ?? ''} onChange={e => setBatchCounts(old => ({...old,[b.id]:e.target.value}))} style={{width:95}}/> : <span>Physical: {b.physical_quantity ?? '—'}{b.system_quantity !== undefined && ' · System: '+b.system_quantity}</span>}</div>)}</td>)}<td style={{padding:8}}>{editable && row.status === 'counting' ? <input aria-label={'Physical quantity '+l.article} inputMode="decimal" type="number" min="0" step="0.0001" value={counts[l.id] ?? ''} onChange={e => setCounts(old => ({...old,[l.id]:e.target.value}))} style={{width:110}}/> : l.physical_quantity ?? '—'}</td>
              {(row.status === 'submitted' || row.booked) && <>{[l.system_quantity,l.variance,l.unit_cost,l.variance_value,l.closing_value].map((v,i) => <td key={i} style={{padding:8}}>{v}</td>)}<td>{editable ? <input aria-label={'Investigation '+l.article} value={notes[l.id] ?? ''} onChange={e => setNotes(old => ({...old,[l.id]:e.target.value}))}/> : l.note}</td></>}
            </tr>)}
          </tbody></table></div>
          {!row.lines.length && <p>{row.status === 'count_pending' ? 'Prepare a physical stock snapshot on the cutoff date.' : 'No stock balance articles were found. Physically confirm the empty location before submitting.'}</p>}
        </>}
      </main>}
    </section>}
  </div>
}
