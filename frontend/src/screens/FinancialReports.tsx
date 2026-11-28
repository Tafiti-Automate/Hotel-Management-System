import { useState } from 'react'
import { readBackendPayload, readBackendRecords, createBackendRecord, runBackendAction, errorMessage } from '../lib/api'
import { useApp } from '../state/AppContext'
import { roleKey } from '../lib/access'
import type { Row } from '../lib/data'

const root = 'financial-reports'
const sections = [
  ['profit_and_loss', 'Profit and Loss Statement'],
  ['balance_sheet', 'Balance Sheet'],
  ['cash_flow', 'Cash Flow Statement (direct classification)'],
  ['trial_balance', 'Trial Balance'],
  ['accounts', 'Chart of Accounts'],
  ['journals', 'Financial Reconciliation / Journal Register'],
  ['fixed_assets', 'Fixed Assets Depreciation Schedule'],
  ['asset_register', 'Fixed Asset Register'],
  ['asset_reconciliation', 'Fixed Asset Reconciliation'],
]
const assetCategories = [["land","Land & Lease","0"],["building","Buildings","4"],["computers","Computers","20"],["furniture","Furniture","20"],["gym","Gym Equipment","5"],["vehicles","Vehicles","20"],["others","Others","20"],["generators","Generators","10"],["laundry","Laundry Equipment","10"],["kitchen","Kitchen Appliances","10"],["refrigeration","Refrigeration & ACs","10"],["machinery","Machinery","10"],["telephone","Telephones & Mobile Sets","10"],["playground","Playground Equipment","10"],["office","Office Equipment","10"]] as const
const assetSections = ['fixed_assets', 'asset_register', 'asset_reconciliation']
const today = () => new Date().toISOString().slice(0, 10)

export default function FinancialReports() {
  const app = useApp()
  const role = roleKey(app.user)
  const [section, setSection] = useState('profit_and_loss')
  const [start, setStart] = useState(() => today().slice(0, 8) + '01')
  const [end, setEnd] = useState(today)
  const [data, setData] = useState<Record<string, Row[]>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [asset, setAsset] = useState({tag:'', name:'', category:'land', opening_date:'', cost:'', opening_depreciation:'0', residual_value:'0', annual_rate:'0', cost_account:'', accumulated_account:'', expense_account:'', evidence:''})
  const [account, setAccount] = useState({ code: '', name: '', kind: 'asset', report_group: '', is_cash: false })
  const [journal, setJournal] = useState({ source_key: '', business_date: today(), evidence: '', is_opening: false, cash_activity: '' })
  const [lines, setLines] = useState([{ account: '', debit: '0', credit: '0' }, { account: '', debit: '0', credit: '0' }])
  async function refresh() {
    setError('')
    setBusy(true)
    setData({})
    try {
      if (section === 'accounts' || section === 'journals') {
        const records = await readBackendRecords(root + '/' + section)
        setData({ [section]: records })
      } else if (assetSections.includes(section)) {
        setData(await readBackendPayload(root + '/assets?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end)))
      } else {
        setData(await readBackendPayload(root + '/statements?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end)))
      }
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const rows = data[section] || []
  const columns = rows.length ? Object.keys(rows[0]).filter(k => k !== 'id') : []
  const cell = (v: unknown) => typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
  function exportCsv() {
    const quote = (value: unknown) => '"' + cell(value).replace(/^[=+@-](?=[^0-9])/, "'$&").replace(/"/g, '""') + '"'
    const csv = [columns.map(quote).join(','), ...rows.map(r => columns.map(c => quote(r[c])).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}))
    const link = document.createElement('a'); link.href = url; link.download = section + '-provisional.csv'; link.click(); URL.revokeObjectURL(url)
  }
  return <section className="p-4 space-y-4">
    <h1 className="text-xl font-semibold">Financial Reports</h1>
    <p>Property: {app.user.branchName || 'Assigned property'} · UGX · Provisional internal ledger only</p>
    <p role="status">Operational source posting, verified opening balances and reconciliation are required before statements can be finalized.</p>
    <div className="flex flex-wrap gap-3 items-end">
      <label>Report <select value={section} disabled={busy} onChange={e=>{setSection(e.target.value);setData({});setError('')}}>{sections.map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>From <input type="date" value={start} onChange={e=>{setStart(e.target.value);setData({})}} /></label>
      <label>To <input type="date" value={end} onChange={e=>{setEnd(e.target.value);setData({})}} /></label>
      <button type="button" disabled={busy} onClick={()=>void refresh()}>{busy?'Loading…':'Load report'}</button>
      <button type="button" disabled={!rows.length||busy} onClick={exportCsv}>Export CSV</button>
      <button type="button" disabled={!rows.length||busy} onClick={()=>window.print()}>Print</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {section==='asset_register' && role==='financial manager' && <form className="space-y-2" onSubmit={e=>{e.preventDefault();void mutate(()=>createBackendRecord(root+'/assets',asset))}}>
      <h2 className="font-semibold">Register verified opening asset</h2>
      <label>Category <select value={asset.category} onChange={e=>{const c=assetCategories.find(r=>r[0]===e.target.value);setAsset({...asset,category:e.target.value,annual_rate:c?.[2]||'0'})}}>{assetCategories.map(([k,n,r])=><option key={k} value={k}>{n} ({r}%)</option>)}</select></label>
      {(['tag','name','opening_date','cost','opening_depreciation','residual_value','annual_rate','cost_account','accumulated_account','expense_account','evidence'] as const).map(k=><label key={k} className="block">{k.replace(/_/g,' ')} <input required value={asset[k]} type={k==='opening_date'?'date':'text'} onChange={e=>setAsset({...asset,[k]:e.target.value})}/></label>)}
      <p>Confirm the policy and account codes. Registration does not create an opening journal.</p>
      <button disabled={busy}>Register asset</button>
    </form>}
    {section==='asset_register' && rows.length>0 && <div className="space-y-2"><h2>Prepare next monthly depreciation</h2>{rows.map(r=><div key={String(r.id)}>{cell(r.tag)} · {cell(r.next_month_end)} <button disabled={busy||Boolean(r.pending_journal)} onClick={()=>void mutate(()=>runBackendAction(root+'/assets',String(r.id),'depreciation',{period_end:String(r.next_month_end)}))}>{r.pending_journal?'Journal pending':'Prepare depreciation'}</button></div>)}<p>Approve and post prepared depreciation in the journal register.</p></div>}
    {section==='accounts' && role==='financial manager' && <form className="space-y-2" onSubmit={e=>{e.preventDefault();void mutate(()=>createBackendRecord(root+'/accounts',account))}}>
      <h2 className="font-semibold">Create ledger account</h2>
      <label>Code <input required maxLength={50} value={account.code} onChange={e=>setAccount({...account,code:e.target.value})}/></label>
      <label>Name <input required value={account.name} onChange={e=>setAccount({...account,name:e.target.value})}/></label>
      <label>Type <select value={account.kind} onChange={e=>setAccount({...account,kind:e.target.value,is_cash:false})}>{['asset','liability','equity','revenue','expense'].map(k=><option key={k}>{k}</option>)}</select></label>
      <label>Report group <input required value={account.report_group} onChange={e=>setAccount({...account,report_group:e.target.value})}/></label>
      <label><input type="checkbox" disabled={account.kind!=='asset'} checked={account.is_cash} onChange={e=>setAccount({...account,is_cash:e.target.checked})}/> Cash equivalent</label>
      <button disabled={busy}>Create account</button>
    </form>}
    {section==='journals' && <form className="space-y-2" onSubmit={e=>{e.preventDefault();void mutate(()=>createBackendRecord(root+'/journals',{...journal,lines}))}}>
      <h2 className="font-semibold">Prepare reconciliation journal</h2>
      <label>Unique source reference <input required value={journal.source_key} onChange={e=>setJournal({...journal,source_key:e.target.value})}/></label>
      <label>Business date <input type="date" required value={journal.business_date} onChange={e=>setJournal({...journal,business_date:e.target.value})}/></label>
      <label>Evidence / reason <textarea required value={journal.evidence} onChange={e=>setJournal({...journal,evidence:e.target.value})}/></label>
      <label><input type="checkbox" checked={journal.is_opening} onChange={e=>setJournal({...journal,is_opening:e.target.checked,cash_activity:''})}/> Verified opening balance</label>
      <label>Cash activity <select disabled={journal.is_opening} value={journal.cash_activity} onChange={e=>setJournal({...journal,cash_activity:e.target.value})}>{['','operating','investing','financing','internal_transfer'].map(k=><option key={k} value={k}>{k||'Non-cash'}</option>)}</select></label>
      {lines.map((line,i)=><div key={i} className="flex flex-wrap gap-2">{(['account','debit','credit'] as const).map(k=><label key={k}>{k}<input required value={line[k]} inputMode={k==='account'?'text':'decimal'} onChange={e=>setLines(old=>old.map((r,j)=>j===i?{...r,[k]:e.target.value}:r))}/></label>)}<button type="button" disabled={lines.length<=2} onClick={()=>setLines(old=>old.filter((_,j)=>j!==i))}>Remove line</button></div>)}
      <button type="button" disabled={lines.length>=200} onClick={()=>setLines([...lines,{account:'',debit:'0',credit:'0'}])}>Add line</button>
      <button disabled={busy}>Prepare journal</button>
    </form>}
    {data.notices?.map((n,i)=><p key={i}>{cell(n.label)}</p>)}
    {rows.length>0 && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{columns.map(c=><th key={c} className="text-left p-2">{c.replace(/_/g,' ')}</th>)}{section==='journals'&&<th>Action</th>}</tr></thead><tbody>{rows.map((r,i)=><tr key={String(r.id||i)} className="border-b">{columns.map(c=><td key={c} className="p-2 tabular-nums">{cell(r[c])}</td>)}{section==='journals'&&<td>{role==='general manager'&&r.status==='draft'&&<button disabled={busy} onClick={()=>void mutate(()=>runBackendAction(root+'/journals',String(r.id),'approve'))}>Approve</button>}{role==='financial manager'&&r.status==='approved'&&<button disabled={busy} onClick={()=>void mutate(()=>runBackendAction(root+'/journals',String(r.id),'post'))}>Post</button>}</td>}</tr>)}</tbody></table></div>}
    {!rows.length && !busy && <p>No report loaded or no records available.</p>}
  </section>
}
