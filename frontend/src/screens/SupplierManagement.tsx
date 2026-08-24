import { useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-sm)' }
const text = (value: unknown) => String(value || '')

export default function SupplierManagement() {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const suppliers = app.data.suppliers || []
  const filtered = useMemo(() => suppliers.filter((supplier) => {
    const search = `${supplier.name} ${supplier.tinNumber} ${supplier.contact} ${supplier.phone} ${supplier.email}`.toLowerCase()
    return (!query || search.includes(query.toLowerCase())) && (!status || text(supplier.status).toLowerCase() === status)
  }), [query, status, suppliers])
  const selected = suppliers.find((supplier) => text(supplier.id) === selectedId) || null
  const prices = selected ? app.data.supplierItems.filter((row) => text(row.supplierId) === text(selected.id)) : []

  return <div style={{ maxWidth: 1420, margin: '0 auto' }}>
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
      <div><div style={{ color: 'var(--accent)', fontSize: 11.5, fontWeight: 750 }}>Cost Controller · Supplier master</div><h1 style={{ margin: '3px 0 5px', color: 'var(--text)', fontSize: 29, fontWeight: 750 }}>Suppliers</h1><p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Register vetted suppliers and maintain the quotation-backed items they supply.</p></div>
      <button type="button" onClick={() => app.openCreate('suppliers', 'Register supplier')} style={primary}><Icon name="add" size={17} />Register supplier</button>
    </header>

    <div className="supplier-master-grid" style={{ display: 'grid', gridTemplateColumns: selected ? 'minmax(500px,1fr) minmax(360px,.8fr)' : '1fr', gap: 14, alignItems: 'start' }}>
      <section style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: 14, display: 'flex', gap: 9, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 280px', minWidth: 220, position: 'relative' }}><Icon name="search" size={18} color="var(--text-faint)" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search supplier, TIN, contact or email..." style={{ ...control, paddingLeft: 36 }} /></label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...control, width: 150 }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </div>
        <div className="supplier-table-head" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.3fr) 1fr 1fr 90px 30px', gap: 10, padding: '10px 15px', color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 750, textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}><span>Supplier</span><span>TIN / Contact</span><span>Items supplied</span><span>Status</span><span /></div>
        {filtered.map((supplier) => {
          const quoteCount = app.data.supplierItems.filter((row) => text(row.supplierId) === text(supplier.id)).length
          const active = selectedId === text(supplier.id)
          return <button key={text(supplier.id)} type="button" onClick={() => setSelectedId(text(supplier.id))} className="hover-surface2" style={{ width:'100%', display:'grid', gridTemplateColumns:'minmax(180px,1.3fr) 1fr 1fr 90px 30px', gap:10, alignItems:'center', padding:'12px 15px', border:0, borderBottom:'1px solid var(--border)', background:active?'var(--accent-soft)':'transparent', textAlign:'left', cursor:'pointer', font:'inherit' }}>
            <span style={{ minWidth: 0 }}><strong style={{ display:'block', color:'var(--text)', fontSize:12.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{text(supplier.name)}</strong><span style={{ display:'block', marginTop:3, color:'var(--text-faint)', fontSize:10.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{text(supplier.email) || text(supplier.phone) || 'No contact recorded'}</span></span>
            <span style={{ color:'var(--text-muted)', fontSize:11.5 }}><span style={{ display:'block' }}>{text(supplier.tinNumber) || 'TIN not recorded'}</span><span style={{ display:'block', marginTop:2, color:'var(--text-faint)' }}>{text(supplier.contact) || 'No contact person'}</span></span>
            <span style={{ color:'var(--text)', fontSize:11.5, fontWeight:650 }}>{quoteCount} article{quoteCount===1?'':'s'}</span>
            <Status value={text(supplier.status)} />
            <Icon name="chevron_right" size={18} color="var(--text-faint)" />
          </button>
        })}
        {!filtered.length && <div style={{ padding: 38, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12.5 }}>No suppliers match the current filters.</div>}
      </section>

      {selected && <aside style={{ ...card, overflow: 'hidden', position: 'sticky', top: 0 }}>
        <div style={{ padding: 18, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}><div><div style={{ color:'var(--text-faint)', fontSize:10.5, fontWeight:750, textTransform:'uppercase' }}>Supplier profile</div><h2 style={{ margin:'4px 0 4px', color:'var(--text)', fontSize:20 }}>{text(selected.name)}</h2><Status value={text(selected.status)} /></div><button type="button" onClick={() => app.openEdit(text(selected.id))} style={secondary}><Icon name="edit" size={16} />Edit</button></div>
          <div style={{ marginTop: 15, display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:8 }}>
            <Info label="TIN" value={selected.tinNumber} /><Info label="Contact person" value={selected.contact} /><Info label="Phone" value={selected.phone} /><Info label="Email" value={selected.email} /><Info label="Payment terms" value={selected.paymentTerms} /><Info label="Address" value={selected.address} />
          </div>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:10 }}><div><div style={{ color:'var(--text)', fontSize:13.5, fontWeight:750 }}>Items & quotations</div><div style={{ marginTop:2, color:'var(--text-faint)', fontSize:10.5 }}>Only quotation-backed supplier/article prices</div></div><button type="button" onClick={() => app.navTo('supplierItems','Supplier quotations')} style={link}>Open catalogue <Icon name="arrow_forward" size={14} /></button></div>
          <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
            <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.25fr) .7fr .8fr', gap:8, padding:'8px 10px', color:'var(--text-faint)', background:'var(--surface-2)', fontSize:10, fontWeight:750, textTransform:'uppercase' }}><span>Article</span><span>UOM</span><span>Current quote</span></div>
            {prices.slice(0,8).map((row) => <div key={text(row.id)} style={{ display:'grid', gridTemplateColumns:'minmax(0,1.25fr) .7fr .8fr', gap:8, padding:'10px', borderTop:'1px solid var(--border)', fontSize:11.5 }}><span><strong style={{ color:'var(--text)' }}>{text(row.article)}</strong><span style={{ display:'block', marginTop:2, color:'var(--text-faint)', fontSize:10 }}>{text(row.quotationReference) ? `Quote ${text(row.quotationReference)}` : 'Quotation reference not recorded'}</span></span><span style={{ color:'var(--text-muted)' }}>{text(row.unit) || '—'}</span><span style={{ color:'var(--text)', fontWeight:700 }}>{money(row.price || 0)}</span></div>)}
            {!prices.length && <div style={{ padding:18, color:'var(--text-faint)', fontSize:11.5 }}>No supplier-item quotation has been registered yet.</div>}
          </div>
        </div>
      </aside>}
    </div>
  </div>
}

function Info({ label, value }: { label:string; value:unknown }) { return <div style={{ padding:'9px 10px', border:'1px solid var(--border)', borderRadius:7, background:'var(--surface-2)', minWidth:0 }}><div style={{ color:'var(--text-faint)', fontSize:9.5, fontWeight:750, textTransform:'uppercase' }}>{label}</div><div style={{ marginTop:3, color:'var(--text)', fontSize:11.5, fontWeight:650, overflow:'hidden', textOverflow:'ellipsis' }}>{text(value) || '—'}</div></div> }
function Status({ value }: { value:string }) { const active=value.toLowerCase()==='active'; return <span style={{ display:'inline-flex', padding:'4px 8px', borderRadius:999, color:active?'var(--good)':'var(--text-muted)', background:active?'var(--good-soft)':'var(--surface-2)', fontSize:9.5, fontWeight:750 }}>{value || 'Inactive'}</span> }
const control: CSSProperties = { height:38, border:'1px solid var(--border)', borderRadius:7, background:'var(--surface)', color:'var(--text)', padding:'0 10px', font:'inherit', fontSize:12 }
const primary: CSSProperties = { minHeight:38, display:'inline-flex', alignItems:'center', gap:7, padding:'0 14px', border:0, borderRadius:7, background:'var(--accent)', color:'#fff', font:'inherit', fontSize:12, fontWeight:700, cursor:'pointer' }
const secondary: CSSProperties = { minHeight:34, display:'inline-flex', alignItems:'center', gap:6, padding:'0 10px', border:'1px solid var(--border)', borderRadius:7, background:'var(--surface)', color:'var(--text-muted)', font:'inherit', fontSize:11.5, fontWeight:650, cursor:'pointer' }
const link: CSSProperties = { border:0, background:'transparent', color:'var(--accent)', display:'inline-flex', alignItems:'center', gap:4, font:'inherit', fontSize:10.5, fontWeight:700, cursor:'pointer' }
