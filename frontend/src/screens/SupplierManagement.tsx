import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'

const text = (value: unknown) => String(value ?? '')

function SupplierTreeIcon({ active = false }: { active?: boolean }) {
  const color = active ? 'var(--accent)' : 'var(--text-muted)'
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block' }}>
    <path d="M3.5 8.2h11.8v8.1H3.5V8.2Z" fill={color} opacity=".18" />
    <path d="M15.3 10.3h3.1l2.1 2.4v3.6h-5.2v-6Z" fill={color} opacity=".28" />
    <path d="M4.4 8.2h10.9v8.1H4.4c-.5 0-.9-.4-.9-.9V9.1c0-.5.4-.9.9-.9Zm10.9 2.1h3.1l2.1 2.4v2.7c0 .5-.4.9-.9.9h-4.3v-6Z" stroke={color} strokeWidth="1.55" strokeLinejoin="round" />
    <circle cx="7.2" cy="17.1" r="1.7" fill="var(--surface)" stroke={color} strokeWidth="1.5" />
    <circle cx="17.7" cy="17.1" r="1.7" fill="var(--surface)" stroke={color} strokeWidth="1.5" />
  </svg>
}

function ArticleTreeIcon({ active = false }: { active?: boolean }) {
  const color = active ? 'var(--accent)' : 'var(--text-faint)'
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block' }}>
    <path d="M5 7.2 12 3l7 4.2v9.6L12 21l-7-4.2V7.2Z" stroke={color} strokeWidth="1.65" strokeLinejoin="round" />
    <path d="m5.3 7.4 6.7 4 6.7-4M12 11.4V21" stroke={color} strokeWidth="1.65" strokeLinejoin="round" />
  </svg>
}

export default function SupplierManagement() {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [selectedQuoteId, setSelectedQuoteId] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const suppliers = app.data.suppliers || []
  const supplierItems = app.data.supplierItems || []
  const permissionMetadata = app.user.permissions.length > 0
  const canAddSupplier = app.user.isSuperuser || app.user.permissions.includes('vendors.add_supplier') || (!permissionMetadata && app.user.isStaff)
  const canEditSupplier = app.user.isSuperuser || app.user.permissions.includes('vendors.change_supplier') || (!permissionMetadata && app.user.isStaff)
  const canAddQuote = app.user.isSuperuser || app.user.permissions.includes('inventory.add_supplieritemprice') || (!permissionMetadata && app.user.isStaff)
  const canEditQuote = app.user.isSuperuser || app.user.permissions.includes('inventory.change_supplieritemprice') || (!permissionMetadata && app.user.isStaff)

  const quotesBySupplier = useMemo(() => {
    const map = new Map<string, typeof supplierItems>()
    supplierItems.forEach((row) => {
      const key = text(row.supplierId)
      map.set(key, [...(map.get(key) || []), row])
    })
    map.forEach((rows) => rows.sort((a, b) => text(a.article).localeCompare(text(b.article))))
    return map
  }, [supplierItems])

  const filtered = useMemo(() => suppliers.filter((supplier) => {
    const quoteNames = (quotesBySupplier.get(text(supplier.id)) || []).map((row) => `${row.article} ${row.category} ${row.quotationReference}`).join(' ')
    const search = `${supplier.name} ${supplier.tinNumber} ${supplier.contact} ${supplier.phone} ${supplier.email} ${quoteNames}`.toLowerCase()
    return (!query || search.includes(query.toLowerCase())) && (!status || text(supplier.status).toLowerCase() === status)
  }), [query, quotesBySupplier, status, suppliers])

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId('')
      setSelectedQuoteId('')
      return
    }
    if (!selectedId || !filtered.some((supplier) => text(supplier.id) === selectedId)) {
      const first = text(filtered[0].id)
      setSelectedId(first)
      setExpanded((current) => new Set(current).add(first))
      setSelectedQuoteId('')
    }
  }, [filtered, selectedId])

  const selected = suppliers.find((supplier) => text(supplier.id) === selectedId) || null
  const prices = selected ? (quotesBySupplier.get(text(selected.id)) || []) : []
  const activeQuotes = prices.filter((row) => text(row.status).toLowerCase() === 'active').length
  const activeSuppliers = suppliers.filter((supplier) => text(supplier.status).toLowerCase() === 'active').length

  const chooseSupplier = (supplierId: string) => {
    setSelectedId(supplierId)
    setSelectedQuoteId('')
    setExpanded((current) => new Set(current).add(supplierId))
  }
  const toggleSupplier = (supplierId: string) => setExpanded((current) => {
    const next = new Set(current)
    next.has(supplierId) ? next.delete(supplierId) : next.add(supplierId)
    return next
  })
  const addQuoteFor = (supplierName: string) => app.openCreate('supplierItems', 'Add supplier quotation', undefined, { supplier: supplierName })

  return <div style={{ maxWidth: 1500, margin: '0 auto' }}>
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <h1 style={{ margin: '0 0 5px', color: 'var(--text)', fontSize: 29, fontWeight: 750 }}>Suppliers</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Supplier profiles and supplied articles.</p>
      </div>
      {canAddSupplier && <button type="button" onClick={() => app.openCreate('suppliers', 'Register supplier')} style={primary}><Icon name="add" size={17} />Register supplier</button>}
    </header>

    <div style={{ display: 'flex', gap: 9, marginBottom: 12, flexWrap: 'wrap' }}>
      <label style={{ flex: '1 1 420px', minWidth: 240, position: 'relative' }}>
        <Icon name="search" size={18} color="var(--text-faint)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search supplier, TIN, contact or supplied article…" style={{ ...control, width: '100%', height: 42, paddingLeft: 38 }} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear supplier search" style={{ ...iconButton, position: 'absolute', right: 5, top: 4, border: 0 }}><Icon name="close" size={17} /></button>}
      </label>
      <select value={status} onChange={(event) => setStatus(event.target.value)} style={{ ...control, height: 42, width: 165 }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
    </div>

    <div className="catalogue-layout supplier-explorer-layout" style={{ display: 'grid', gridTemplateColumns: '360px minmax(0,1fr)', minHeight: 600, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
      <aside style={{ minWidth: 0, borderRight: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <div style={panelHeader}><span>Supplier explorer</span><small>{activeSuppliers} active · {suppliers.length} total</small></div>
        <div style={{ padding: '8px 7px' }}>
          {filtered.map((supplier) => {
            const supplierId = text(supplier.id)
            const quotes = quotesBySupplier.get(supplierId) || []
            const open = expanded.has(supplierId)
            const active = selectedId === supplierId
            return <div key={supplierId} style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button type="button" onClick={() => toggleSupplier(supplierId)} aria-label={`${open ? 'Collapse' : 'Expand'} ${text(supplier.name)}`} style={treeToggle}><Icon name={open ? 'expand_more' : 'chevron_right'} size={18} /></button>
                <button type="button" onClick={() => chooseSupplier(supplierId)} style={{ ...treeRow, color: active ? 'var(--accent)' : 'var(--text)', background: active ? 'var(--accent-soft)' : 'transparent', fontWeight: active ? 750 : 680 }}>
                  <SupplierTreeIcon active={active} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text(supplier.name)}</span>
                    <small style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, color: 'var(--text-faint)', fontWeight: 550 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: text(supplier.status).toLowerCase() === 'active' ? 'var(--good)' : 'var(--text-faint)' }} />{text(supplier.status) || 'Inactive'}</small>
                  </span>
                  <small style={{ whiteSpace: 'nowrap' }}>{quotes.length} item{quotes.length === 1 ? '' : 's'}</small>
                </button>
                {canAddQuote && <button type="button" onClick={() => addQuoteFor(text(supplier.name))} title={`Add quotation for ${text(supplier.name)}`} aria-label={`Add quotation for ${text(supplier.name)}`} style={quickAdd}><Icon name="add" size={18} /></button>}
              </div>
              {open && <div style={{ marginLeft: 48, borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
                {quotes.map((row) => {
                  const quoteId = text(row.id)
                  const quoteActive = selectedQuoteId === quoteId
                  return <button type="button" key={quoteId} onClick={() => { chooseSupplier(supplierId); setSelectedQuoteId(quoteId) }} style={{ ...treeLeaf, color: quoteActive ? 'var(--accent)' : 'var(--text-muted)', background: quoteActive ? 'var(--accent-soft)' : 'transparent', fontWeight: quoteActive ? 700 : 560 }}>
                    <ArticleTreeIcon active={quoteActive} />
                    <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text(row.article)}</span><small style={{ display: 'block', marginTop: 1, color: 'var(--text-faint)' }}>{text(row.category) || 'Item group'} · {text(row.unit) || 'Unit'}</small></span>
                  </button>
                })}
                {!quotes.length && <div style={{ padding: '6px 8px 10px', color: 'var(--text-faint)', fontSize: 11.5 }}>No approved article quotations yet.</div>}
              </div>}
            </div>
          })}
          {!filtered.length && <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No suppliers match the current search.</div>}
        </div>
      </aside>

      <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selected ? <>
          <div style={{ ...panelHeader, minHeight: 62, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}><small style={{ display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.05em' }}>Viewing supplier</small><strong style={{ display: 'block', color: 'var(--text)', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text(selected.name)}</strong></div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}><Status value={text(selected.status)} />{canEditSupplier && <button type="button" onClick={() => app.openEdit(text(selected.id), 'suppliers')} style={secondary}><Icon name="edit" size={16} />Edit supplier</button>}</div>
          </div>

          <div style={{ padding: 14, borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8 }} className="supplier-summary-grid">
              <Summary label="Items supplied" value={String(prices.length)} sub={`${activeQuotes} active quotation${activeQuotes === 1 ? '' : 's'}`} />
              <Summary label="TIN" value={text(selected.tinNumber) || '—'} sub={text(selected.registrationNumber) || 'Registration not recorded'} />
              <Summary label="Contact person" value={text(selected.contact) || '—'} sub={text(selected.phone) || 'Phone not recorded'} />
              <Summary label="Payment terms" value={text(selected.paymentTerms) || '—'} sub={text(selected.email) || 'Email not recorded'} />
            </div>
            {selected.address && <div style={{ marginTop: 8, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 12 }}><strong style={{ color: 'var(--text)', marginRight: 7 }}>Address</strong>{text(selected.address)}</div>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--text)', fontSize: 13.5, fontWeight: 750 }}>Items supplied</div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{canAddQuote && <button type="button" onClick={() => addQuoteFor(text(selected.name))} style={primaryCompact}><Icon name="add" size={16} />Add quotation</button>}<button type="button" onClick={() => app.navTo('supplierItems', 'Supplier quotations')} style={secondary}><Icon name="request_quote" size={16} />All quotations</button></div>
          </div>

          <div style={{ overflowX: 'auto', flex: 1 }}>
            <div style={{ minWidth: 680 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,1.45fr) 1fr 110px minmax(130px,1fr) 90px 42px', gap: 8, padding: '0 10px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <span style={headCell}>Article</span><span style={headCell}>Item group</span><span style={headCell}>Purchase UOM</span><span style={headCell}>Supplier reference</span><span style={headCell}>Status</span><span />
              </div>
              {prices.map((row) => {
                const highlighted = selectedQuoteId === text(row.id)
                return <div key={text(row.id)} style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,1.45fr) 1fr 110px minmax(130px,1fr) 90px 42px', gap: 8, alignItems: 'center', minHeight: 58, padding: '0 10px', borderBottom: '1px solid var(--border)', background: highlighted ? 'var(--accent-soft)' : 'transparent' }}>
                  <span style={{ ...bodyCell, display: 'block' }}><strong style={{ display: 'block', color: 'var(--text)' }}>{text(row.article)}</strong><small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)' }}>{text(row.articleSku) || text(row.supplierSku) || 'No reference'}</small></span>
                  <span style={bodyCell}>{text(row.category) || '—'}</span>
                  <span style={bodyCell}>{text(row.unit) || '—'}</span>
                  <span style={{ ...bodyCell, color: 'var(--text)' }}>{text(row.supplierSku) || 'Not recorded'}</span>
                  <span style={bodyCell}><Status value={text(row.status)} /></span>
                  <span style={bodyCell}>{canEditQuote && <button type="button" onClick={() => app.openEdit(text(row.id), 'supplierItems')} title="Edit supplier quotation" style={iconButton}><Icon name="edit" size={16} /></button>}</span>
                </div>
              })}
              {!prices.length && <div style={{ padding: 54, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}><Icon name="request_quote" size={26} color="var(--text-faint)" /><div style={{ marginTop: 8, color: 'var(--text)', fontWeight: 750 }}>No supplier quotations yet</div><div style={{ marginTop: 4 }}>Add the first article quotation for this supplier.</div>{canAddQuote && <button type="button" onClick={() => addQuoteFor(text(selected.name))} style={{ ...primaryCompact, marginTop: 12 }}><Icon name="add" size={16} />Add quotation</button>}</div>}
            </div>
          </div>

          <footer style={{ minHeight: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 11.5 }}><span>{prices.length} supplied item{prices.length === 1 ? '' : 's'}</span><span>·</span><span>{activeQuotes} active quotation{activeQuotes === 1 ? '' : 's'}</span></footer>
        </> : <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}><div><SupplierTreeIcon /><div style={{ marginTop: 10, color: 'var(--text)', fontWeight: 750 }}>Select a supplier</div><div style={{ marginTop: 4, fontSize: 12 }}>Choose a supplier from the explorer to view its profile and quotations.</div></div></div>}
      </section>
    </div>
  </div>
}

function Summary({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div style={{ minWidth: 0, padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}><div style={{ color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.035em' }}>{label}</div><div style={{ marginTop: 4, color: 'var(--text)', fontSize: 13, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>{sub && <div style={{ marginTop: 2, color: 'var(--text-faint)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}</div>
}
function Status({ value }: { value: string }) {
  const active = value.toLowerCase() === 'active'
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, color: active ? 'var(--good)' : 'var(--text-muted)', background: active ? 'var(--good-soft)' : 'var(--surface-3)', fontSize: 11.5, fontWeight: 750 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: active ? 'var(--good)' : 'var(--text-faint)' }} />{value || 'Inactive'}</span>
}

const control: CSSProperties = { height: 38, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12, outline: 'none' }
const primary: CSSProperties = { minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const primaryCompact: CSSProperties = { minHeight: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const secondary: CSSProperties = { minHeight: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: 12, fontWeight: 650, cursor: 'pointer' }
const iconButton: CSSProperties = { width: 34, height: 34, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
const quickAdd: CSSProperties = { width: 34, height: 34, display: 'grid', placeItems: 'center', flex: 'none', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--accent)', cursor: 'pointer' }
const panelHeader: CSSProperties = { minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 13px', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 11.5, fontWeight: 750 }
const treeToggle: CSSProperties = { width: 26, height: 36, display: 'grid', placeItems: 'center', flex: 'none', border: 0, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }
const treeRow: CSSProperties = { minWidth: 0, flex: 1, minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: 0, borderRadius: 7, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 12 }
const treeLeaf: CSSProperties = { width: '100%', minHeight: 42, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: 0, borderRadius: 6, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 11.5 }
const headCell: CSSProperties = { minWidth: 0, minHeight: 40, display: 'flex', alignItems: 'center', padding: '0 8px', color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }
const bodyCell: CSSProperties = { minWidth: 0, display: 'flex', alignItems: 'center', padding: '8px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-muted)', fontSize: 12 }
