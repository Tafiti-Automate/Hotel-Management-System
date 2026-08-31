import { useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const text = (value: unknown) => String(value ?? '')
const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-sm)' }

export default function SupplierQuotationManagement() {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [supplier, setSupplier] = useState('')
  const [status, setStatus] = useState('')
  const rows = app.data.supplierItems || []
  const suppliers = app.data.suppliers || []

  const filtered = useMemo(() => rows.filter((row) => {
    const haystack = `${row.supplier} ${row.article} ${row.unit} ${row.quotationReference} ${row.supplierSku}`.toLowerCase()
    const supplierMatch = !supplier || text(row.supplierId) === supplier || text(row.supplier) === supplier
    const statusMatch = !status || text(row.status).toLowerCase() === status
    return (!query || haystack.includes(query.toLowerCase())) && supplierMatch && statusMatch
  }), [query, rows, status, supplier])

  return <div style={{ maxWidth: 1420, margin: '0 auto' }}>
    <header style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:18 }}>
      <div>
        <div style={{ color:'var(--accent)', fontSize: 12, fontWeight:750 }}>Cost Controller · Quotation catalogue</div>
        <h1 style={{ margin:'3px 0 5px', color:'var(--text)', fontSize:29, fontWeight:750 }}>Supplier Quotations</h1>
        <p style={{ margin:0, color:'var(--text-muted)', fontSize:13 }}>Maintain supplier quotations by article and purchase unit. The same article may be supplied by more than one supplier.</p>
      </div>
      <button type="button" onClick={() => app.openCreate('supplierItems', 'Add supplier quotation')} style={primary}><Icon name="add" size={17} />Add supplier quotation</button>
    </header>

    <section style={{ ...card, overflow:'hidden' }}>
      <div style={{ padding:14, display:'flex', gap:9, flexWrap:'wrap', borderBottom:'1px solid var(--border)' }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search supplier, article or quotation number..." style={{ ...control, flex:'1 1 320px', minWidth:240 }} />
        <select value={supplier} onChange={(event) => setSupplier(event.target.value)} style={{ ...control, width:210 }}>
          <option value="">All suppliers</option>
          {suppliers.map((row) => <option key={text(row.id)} value={text(row.id)}>{text(row.name)}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} style={{ ...control, width:150 }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
      </div>

      <div className="supplier-quote-table-head" style={{ display:'grid', gridTemplateColumns:'minmax(170px,1.25fr) minmax(170px,1.25fr) 100px 125px minmax(150px,1fr) 90px 90px 32px', gap:10, padding:'10px 14px', background:'var(--surface-2)', borderBottom:'1px solid var(--border)', color:'var(--text-faint)', fontSize: 12, fontWeight:750, textTransform:'uppercase' }}>
        <span>Supplier</span><span>Article</span><span>Purchase UOM</span><span style={{ textAlign:'right' }}>Quoted Price</span><span>Quotation</span><span>Lead</span><span>Status</span><span />
      </div>

      {filtered.map((row) => <button type="button" key={text(row.id)} onClick={() => app.openEdit(text(row.id))} className="hover-surface2 supplier-quote-row" style={{ width:'100%', display:'grid', gridTemplateColumns:'minmax(170px,1.25fr) minmax(170px,1.25fr) 100px 125px minmax(150px,1fr) 90px 90px 32px', alignItems:'center', gap:10, padding:'12px 14px', border:0, borderBottom:'1px solid var(--border)', background:'transparent', textAlign:'left', cursor:'pointer', font:'inherit' }}>
        <span style={mainText}>{text(row.supplier) || '—'}</span>
        <span style={{ minWidth:0 }}><strong style={mainText}>{text(row.article) || '—'}</strong>{row.category && <span style={subText}>{text(row.category)}</span>}</span>
        <span style={mutedText}>{text(row.unit) || '—'}</span>
        <span style={{ ...mainText, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{money(row.price || 0)}</span>
        <span style={{ minWidth:0 }}><strong style={mainText}>{text(row.quotationReference) || 'Not recorded'}</strong>{row.quotationValidUntil && <span style={subText}>Valid to {text(row.quotationValidUntil)}</span>}</span>
        <span style={mutedText}>{text(row.leadTime || 0)} day{text(row.leadTime)==='1'?'':'s'}</span>
        <Status value={text(row.status)} />
        <Icon name="chevron_right" size={17} color="var(--text-faint)" />
      </button>)}

      {!filtered.length && <div style={{ padding:38, textAlign:'center', color:'var(--text-faint)', fontSize:12.5 }}><Icon name="request_quote" size={25} color="var(--text-faint)" /><div style={{ marginTop:8 }}>No supplier quotations match the current filters.</div></div>}
    </section>

    <div style={{ marginTop:10, color:'var(--text-faint)', fontSize: 12, lineHeight:1.55 }}>Quoted prices are maintained only by the Cost Controller. Procurement selects a supplier and views the approved price without changing it.</div>
  </div>
}

function Status({ value }: { value:string }) {
  const active = value.toLowerCase() === 'active'
  return <span style={{ justifySelf:'start', padding:'4px 8px', borderRadius:999, color:active?'var(--good)':'var(--text-muted)', background:active?'var(--good-soft)':'var(--surface-2)', fontSize: 11.5, fontWeight:750 }}>{value || 'Inactive'}</span>
}

const mainText: CSSProperties = { display:'block', color:'var(--text)', fontSize: 12, fontWeight:650, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }
const mutedText: CSSProperties = { color:'var(--text-muted)', fontSize: 12.25 }
const subText: CSSProperties = { display:'block', marginTop:2, color:'var(--text-faint)', fontSize: 12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }
const control: CSSProperties = { height:38, border:'1px solid var(--border)', borderRadius:7, background:'var(--surface)', color:'var(--text)', padding:'0 10px', font:'inherit', fontSize:12 }
const primary: CSSProperties = { minHeight:38, display:'inline-flex', alignItems:'center', gap:7, padding:'0 14px', border:0, borderRadius:7, background:'var(--accent)', color:'#fff', font:'inherit', fontSize:12, fontWeight:700, cursor:'pointer' }
