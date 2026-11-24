import { varianceSignal, signalStyle, operationalStatus } from '../lib/operationalSignals'
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
type DepartmentCost = { classification?: string; net_cost: string | null; missing_valuations: number; closing_value: string; lines: {id:string; article:string; sku:string; source:string; reference:string; date:string; quantity:string; unit:string; value:string|null}[] }
type Location = {
  id: number; location_name: string; treatment: string; status: string; booked: boolean
  lines: Line[]; stock_count: string | null; difference_value: string | null; closing_value: string | null; department_cost?: DepartmentCost | null
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
  const [classifications, setClassifications] = useState<Record<string,string>>({})
  const [articleSearch, setArticleSearch] = useState('')
  const [articleQuery, setArticleQuery] = useState('')
  const [foundArticle,setFoundArticle] = useState('')
  const [foundQty,setFoundQty] = useState('')
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
  const matches = (values: unknown[]) => values.map(value => String(value ?? '')).join(' ').toLowerCase().includes(articleQuery.trim().toLowerCase())
  const departmentReady = cycle?.inventories.every(r => !r.department_cost || (!r.department_cost.missing_valuations && (!r.department_cost.lines.length || Boolean(classifications[String(r.id)]))))
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
      <label>Month-end inventory <select value={cycle?.id ?? ''} onChange={e => {setSelected(Number(e.target.value)); setLocation(null); setClassifications({}); setArticleSearch(''); setArticleQuery('')}}>
        {!cycles.length && <option value="">No inventory cycles</option>}{cycles.map(c => <option key={c.id} value={c.id}>{c.cutoff} · {dateLabel(c.status)}</option>)}
      </select></label>
      <button className="mc-secondary" disabled={busy} onClick={() => void load().catch(e => setError(errorMessage(e)))}>Reload register</button>
      {cycle && <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
        <button className="mc-secondary" onClick={() => print('memo')}>Print official memo</button>
        <button className="mc-secondary" disabled={!ready && cycle.status !== 'booked' && cycle.status !== 'approved'} onClick={() => print('variance')}>Inventory Differences by Value</button>
        {finance && cycle.status === 'planned' && <><input aria-label="Finance approval note" placeholder="Finance approval note" value={approval} onChange={e => setApproval(e.target.value)} /><button className="mc-primary" disabled={busy || !ready || !approval.trim() || !departmentReady} onClick={() => action('approve', {note:approval, department_classifications:classifications}, 'Inventories approved')}>Approve inventories</button></>}
        {controller && cycle.status === 'approved' && <><button className="mc-primary" disabled={busy} onClick={() => {if (window.confirm('Book all approved inventories? Posted records become read-only.')) action('book', {}, 'Inventories booked')}}>Book inventories</button><button className="mc-secondary" disabled={busy} onClick={() => {if (window.confirm('Reopen and invalidate Finance approval?')) action('reopen')}}>Reopen for review</button></>}
        {cycle.total_closing_value !== null && <p>Net difference value: <strong>{cycle.total_difference_value}</strong> · Closing inventory value: <strong>{cycle.total_closing_value}</strong></p>}
        {cycle.status === 'booked' && <button className="mc-secondary" onClick={() => void printReconciliation()}>Monthly inventory reconciliation</button>}
        <button className="mc-secondary" onClick={()=>{try{printDocument('DEPARTMENT CONSUMPTION — SUMMARY',property,'<p>Cutoff: '+escape(cycle.cutoff)+'</p><table><thead><tr><th>Department</th><th>Finance classification</th><th>Recorded net cost</th><th>Closing inventory</th></tr></thead><tbody>'+cycle.inventories.filter(r=>r.treatment==='consumption_zero').map(r=>'<tr>'+[r.location_name,r.department_cost?.classification || 'Pending',r.department_cost?.net_cost ?? 'Not available','0.0000'].map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table><p>Recorded consumption only; no new expense posted.</p>')}catch(e){setError(errorMessage(e))}}}>Department cost summary</button>
        {cycle.approval_note && <p>Finance approval: {cycle.approval_note}</p>}
      </div>}
    </section>
    {cycle && <section className="mc-card" style={{display:'grid',gridTemplateColumns:'minmax(180px, 280px) minmax(0,1fr)',gap:16}}>
      <aside><h2>Inventories</h2>{cycle.inventories.map(r => <button key={r.id} className="mc-secondary" aria-pressed={r.id === row?.id} style={{display:'block',width:'100%',textAlign:'left',marginBottom:6}} onClick={() => setLocation(r.id)}>{r.location_name} · <span style={signalStyle(operationalStatus(r.status).tone)}>{dateLabel(r.status)}</span></button>)}</aside>
      {row && <main style={{minWidth:0}}><h2>{row.location_name}</h2>
        <form style={{display:'flex',gap:8,marginBottom:12}} onSubmit={e=>{e.preventDefault();setArticleQuery(articleSearch)}}><input aria-label="Search inventory articles" placeholder="Article, group or reference" value={articleSearch} onChange={e=>setArticleSearch(e.target.value)}/><button type="submit" className="mc-secondary">Search</button><button type="button" className="mc-secondary" onClick={()=>{setArticleSearch('');setArticleQuery('')}}>Clear</button></form>
        {row.treatment === 'consumption_zero' ? <>
          <p>Consumption department · Closing inventory 0.0000. Recorded net cost is classified by Finance, not charged again.</p>
          {row.department_cost && <><p>Net recorded consumption: <strong>{row.department_cost.net_cost ?? 'Missing cost evidence'}</strong></p>
            {finance && cycle.status === 'planned' && <label>Accounting treatment<select value={classifications[String(row.id)] || ''} onChange={e=>setClassifications(old=>({...old,[String(row.id)]:e.target.value}))}><option value="">Select treatment</option><option value="expense">Department expense</option><option value="cost_of_sales">Cost of sales</option></select></label>}
            {row.department_cost.classification && <p>Finance classification: {dateLabel(row.department_cost.classification)}</p>}
            {row.department_cost.missing_valuations > 0 && <p role="alert">Resolve {row.department_cost.missing_valuations} missing valuation(s) before approval.</p>}
            <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Date','Reference','Article','Source','Quantity','Unit','Recorded value'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{row.department_cost.lines.filter(l=>matches([l.article,l.sku,l.reference,l.source])).map(l=><tr key={l.id}>{[l.date,l.reference,l.article,dateLabel(l.source),l.quantity,l.unit,l.value ?? 'Missing cost'].map((value,i)=><td key={i} style={{padding:8}}>{value}</td>)}</tr>)}</tbody></table></div>
            <button className="mc-secondary" onClick={()=>{try{const cost=row.department_cost!;printDocument('DEPARTMENT CONSUMPTION — DETAILED',property,'<p>'+escape(row.location_name)+' · '+escape(cycle.cutoff)+'</p><p>Finance treatment: '+escape(cost.classification || 'Pending')+'</p><table><thead><tr><th>Date</th><th>Reference</th><th>Article</th><th>Source</th><th>Quantity</th><th>Unit</th><th>Recorded value</th></tr></thead><tbody>'+cost.lines.filter(l=>matches([l.article,l.sku,l.reference,l.source])).map(l=>'<tr>'+[l.date,l.reference,l.article,dateLabel(l.source),l.quantity,l.unit,l.value ?? 'Missing cost'].map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table><p>Full department net recorded cost: '+escape(cost.net_cost ?? 'Missing valuation')+'</p>')}catch(e){setError(errorMessage(e))}}}>Print detailed department report</button>
          </>}
        </> : <>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
            {editable && row.status === 'count_pending' && <button className="mc-primary" disabled={busy} onClick={() => action('prepare',{inventory:row.id})}>Prepare count sheet</button>}
            {row.status !== 'count_pending' && <button className="mc-secondary" onClick={() => print('count')}>Print blind sheet</button>}
            {editable && row.status !== 'count_pending' && <button className="mc-secondary" disabled={busy} onClick={() => {if(window.confirm('Refresh the snapshot and discard every previous physical count for this location?')) action('refresh',{inventory:row.id,discard_counts:true})}}>Refresh & recount</button>}
            {editable && row.status === 'counting' && <><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><select aria-label="Add unexpected article" value={foundArticle} onChange={e=>setFoundArticle(e.target.value)}><option value="">Add physically found article</option>{app.data.items.filter(item=>item.is_active!==false&&!row.lines.some(line=>line.sku===String(item.sku))&&matches([item.name,item.sku])).map(item=><option key={String(item.id)} value={String(item.id)}>{String(item.name)} · {String(item.sku)}</option>)}</select><input aria-label="Found article physical quantity" type="number" min="0" step="0.0001" value={foundQty} onChange={e=>setFoundQty(e.target.value)}/><button className="mc-secondary" disabled={busy||!foundArticle||!/^\d+(\.\d{1,4})?$/.test(foundQty)||row.lines.some(l=>counts[l.id] !== (l.physical_quantity ?? ''))} onClick={()=>{action('add-article',{inventory:row.id,item:foundArticle,physical_quantity:foundQty},'Additional article counted');setFoundArticle('');setFoundQty('')}}>Add article</button></div><button className="mc-primary" disabled={busy || !row.lines.some(completeDraft)} onClick={() => action('save-count',{inventory:row.id,lines:row.lines.filter(completeDraft).map(l => ({id:l.id,physical_quantity:counts[l.id],batches:(l.batches || []).map(b => ({id:b.id,physical_quantity:batchCounts[b.id]}))}))},'Physical quantities saved')}>Save quantities</button><button className="mc-secondary" disabled={busy || row.lines.some(l => l.physical_quantity === null || changedDraft(l))} onClick={() => {if(row.lines.length || window.confirm('Confirm that the physical location is empty.')) action('submit',{inventory:row.id,confirm_empty:!row.lines.length},'Count submitted for variance review')}}>Submit saved count</button></>}
            {editable && row.status === 'submitted' && <button className="mc-primary" disabled={busy || !row.lines.some(l => notes[l.id]?.trim())} onClick={() => action('investigate',{inventory:row.id,lines:row.lines.filter(l => notes[l.id]?.trim()).map(l => ({id:l.id,note:notes[l.id]}))},'Investigation notes saved')}>Save variance notes</button>}
          </div>
          <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontVariantNumeric:'tabular-nums'}}><thead><tr>{['Item group','Article','Unit','Physical quantity',...(row.status === 'submitted' || row.booked ? ['System','Difference','Unit cost','Difference value','Closing value','Investigation'] : [])].map(h => <th key={h} style={{textAlign:'left',padding:8,borderBottom:'1px solid var(--border)'}}>{h}</th>)}</tr></thead><tbody>
            {row.lines.filter(l => matches([l.article,l.sku,l.item_group])).map(l => <tr key={l.id}>{[l.item_group,l.article,l.unit].map((v,i) => <td key={i} style={{padding:8}}>{v}{i === 1 && (l.batches || []).map(b => <div key={b.id} style={{marginTop:6,fontSize:12}}>Batch {b.batch_number || 'Unlabelled'} · Expiry {b.expiry_date || '—'} {editable && row.status === 'counting' ? <input aria-label={'Batch quantity '+b.id} type="number" min="0" step="0.0001" value={batchCounts[b.id] ?? ''} onChange={e => setBatchCounts(old => ({...old,[b.id]:e.target.value}))} style={{width:95}}/> : <span>Physical: {b.physical_quantity ?? '—'}{b.system_quantity !== undefined && ' · System: '+b.system_quantity}</span>}</div>)}</td>)}<td style={{padding:8}}>{editable && row.status === 'counting' ? <input aria-label={'Physical quantity '+l.article} inputMode="decimal" type="number" min="0" step="0.0001" value={counts[l.id] ?? ''} onChange={e => setCounts(old => ({...old,[l.id]:e.target.value}))} style={{width:110}}/> : l.physical_quantity ?? '—'}</td>
              {(row.status === 'submitted' || row.booked) && <>{[l.system_quantity,l.variance,l.unit_cost,l.variance_value,l.closing_value].map((v,i) => <td key={i} style={{padding:8}}>{i===1||i===3?<span style={{...signalStyle(varianceSignal(v).tone),fontVariantNumeric:'tabular-nums'}}>{v??'Not valued'}{i===1?' · '+varianceSignal(v).label:''}</span>:v??'—'}</td>)}<td>{editable ? <input aria-label={'Investigation '+l.article} value={notes[l.id] ?? ''} onChange={e => setNotes(old => ({...old,[l.id]:e.target.value}))}/> : l.note}</td></>}
            </tr>)}
          </tbody></table></div>
          {!row.lines.length && <p>{row.status === 'count_pending' ? 'Prepare a physical stock snapshot on the cutoff date.' : 'No stock balance articles were found. Physically confirm the empty location before submitting.'}</p>}
        </>}
      </main>}
    </section>}
  </div>
}
