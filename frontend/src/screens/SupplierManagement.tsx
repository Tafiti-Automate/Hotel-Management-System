import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'

const text = (value: unknown) => String(value ?? '')
const money = (value: unknown, currency = 'UGX') => {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return '—'
  return `${currency || 'UGX'} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function SupplierIcon({ active = false }: { active?: boolean }) {
  const color = active ? 'var(--accent)' : 'var(--text-muted)'
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block' }}>
    <path d="M3.5 8.2h11.8v8.1H3.5V8.2Z" fill={color} opacity=".18" />
    <path d="M15.3 10.3h3.1l2.1 2.4v3.6h-5.2v-6Z" fill={color} opacity=".28" />
    <path d="M4.4 8.2h10.9v8.1H4.4c-.5 0-.9-.4-.9-.9V9.1c0-.5.4-.9.9-.9Zm10.9 2.1h3.1l2.1 2.4v2.7c0 .5-.4.9-.9.9h-4.3v-6Z" stroke={color} strokeWidth="1.55" strokeLinejoin="round" />
    <circle cx="7.2" cy="17.1" r="1.7" fill="var(--surface)" stroke={color} strokeWidth="1.5" />
    <circle cx="17.7" cy="17.1" r="1.7" fill="var(--surface)" stroke={color} strokeWidth="1.5" />
  </svg>
}


function DashboardGlyph({ kind, tone = 'neutral', size = 18 }: { kind: 'suppliers' | 'quotations' | 'flag'; tone?: 'neutral' | 'good' | 'warning'; size?: number }) {
  const palette = tone === 'warning'
    ? { stroke: '#c7791a', fill: 'rgba(199, 121, 26, .14)' }
    : tone === 'good'
      ? { stroke: '#1f8f54', fill: 'rgba(31, 143, 84, .14)' }
      : { stroke: 'var(--accent)', fill: 'rgba(37, 99, 235, .12)' }

  if (kind === 'suppliers') {
    return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <circle cx="9" cy="9" r="3" fill={palette.fill} stroke={palette.stroke} strokeWidth="1.6" />
      <path d="M4.8 18c.7-2.4 2.5-3.7 4.2-3.7s3.5 1.3 4.2 3.7" stroke={palette.stroke} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="17.2" cy="10.2" r="2.3" fill={palette.fill} stroke={palette.stroke} strokeWidth="1.5" />
      <path d="M14.8 17.3c.5-1.7 1.8-2.7 3.2-2.7 1.2 0 2.4.8 3 2.2" stroke={palette.stroke} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  }

  if (kind === 'quotations') {
    return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <path d="M7 3.8h6l4 4v10.4c0 1-.8 1.8-1.8 1.8H7c-1 0-1.8-.8-1.8-1.8V5.6C5.2 4.6 6 3.8 7 3.8Z" fill={palette.fill} stroke={palette.stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13 3.8v4h4" stroke={palette.stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 11.2h5.5M8.5 14.5h7" stroke={palette.stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  }

  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
    <path d="M12 3.8 20 6.6v5.1c0 4.1-2.4 7.8-8 8.9-5.6-1.1-8-4.8-8-8.9V6.6l8-2.8Z" fill={palette.fill} stroke={palette.stroke} strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M12 8.1v4.2M12 15.8h.01" stroke={palette.stroke} strokeWidth="1.8" strokeLinecap="round" />
  </svg>
}

function ContactGlyph({ kind, size = 18 }: { kind: 'person' | 'phone' | 'mail' | 'location'; size?: number }) {
  const stroke = 'var(--text-muted)'
  const fill = 'rgba(100, 116, 139, .10)'

  if (kind === 'person') {
    return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <circle cx="12" cy="8.2" r="3.1" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <path d="M6.8 18.5c.7-2.7 2.8-4.2 5.2-4.2s4.5 1.5 5.2 4.2" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  }

  if (kind === 'phone') {
    return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <path d="M8.2 4.9h2.7l1.1 3.2-1.6 1.6c.9 1.8 2.2 3.1 4 4l1.6-1.6 3.2 1.1V16c0 .7-.6 1.3-1.3 1.3A12 12 0 0 1 6.9 6.2c0-.7.6-1.3 1.3-1.3Z" fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  }

  if (kind === 'mail') {
    return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <rect x="4" y="6.2" width="16" height="11.6" rx="2" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <path d="M5.5 8l6.5 5.2L18.5 8" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  }

  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
    <path d="M12 20c3.7-3.8 5.5-6.7 5.5-9.2A5.5 5.5 0 1 0 6.5 10.8C6.5 13.3 8.3 16.2 12 20Z" fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="12" cy="10.6" r="1.9" stroke={stroke} strokeWidth="1.5" />
  </svg>
}

type DrawerTab = 'overview' | 'items' | 'contact'

function paymentTermsInfo(value: unknown) {
  const raw = text(value).trim()
  if (!raw) return { label: 'Not recorded', invalid: false }
  const compact = raw.replace(/\s+/g, ' ').trim()
  const lower = compact.toLowerCase()
  const net = lower.match(/^net\s*[- ]?\s*(\d{1,3})(?:\s*days?)?$/)
  if (net) return { label: `Net ${net[1]}`, invalid: false }
  if (lower === 'cod' || lower === 'cash on delivery') return { label: 'Cash on Delivery', invalid: false }
  if (lower === 'due on receipt' || lower === 'immediate') return { label: 'Due on Receipt', invalid: false }
  if (lower === 'prepaid' || lower === 'payment in advance' || lower === 'advance payment') return { label: 'Payment in Advance', invalid: false }

  // These are payment methods rather than credit/payment terms. Do not present them as terms.
  if (['bank', 'bank transfer', 'wire transfer', 'mobile money', 'visa', 'card', 'credit card'].includes(lower)) {
    return { label: 'Needs review', invalid: true }
  }
  return { label: compact, invalid: false }
}

function isExpired(dateValue: unknown) {
  const value = text(dateValue).trim()
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  date.setHours(23, 59, 59, 999)
  return date.getTime() < Date.now()
}

export default function SupplierManagement() {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview')
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
      if (!key) return
      map.set(key, [...(map.get(key) || []), row])
    })
    map.forEach((rows) => rows.sort((a, b) => text(a.article).localeCompare(text(b.article))))
    return map
  }, [supplierItems])

  const activeItemCountBySupplier = useMemo(() => {
    const map = new Map<string, number>()
    quotesBySupplier.forEach((rows, supplierId) => {
      const itemIds = new Set(rows
        .filter((row) => text(row.status).toLowerCase() === 'active')
        .map((row) => text(row.articleId) || text(row.article))
        .filter(Boolean))
      map.set(supplierId, itemIds.size)
    })
    return map
  }, [quotesBySupplier])

  const filtered = useMemo(() => suppliers.filter((supplier) => {
    const supplierId = text(supplier.id)
    const quoteNames = (quotesBySupplier.get(supplierId) || []).map((row) => `${row.article} ${row.articleSku} ${row.category} ${row.supplierSku} ${row.quotationReference}`).join(' ')
    const search = `${supplier.name} ${supplier.tinNumber} ${supplier.registrationNumber} ${supplier.contact} ${supplier.phone} ${supplier.email} ${supplier.paymentTerms} ${quoteNames}`.toLowerCase()
    return (!query || search.includes(query.toLowerCase())) && (!status || text(supplier.status).toLowerCase() === status)
  }), [query, quotesBySupplier, status, suppliers])

  const selected = suppliers.find((supplier) => text(supplier.id) === selectedId) || null
  const selectedPrices = selected ? (quotesBySupplier.get(text(selected.id)) || []) : []
  const selectedActiveQuotes = selectedPrices.filter((row) => text(row.status).toLowerCase() === 'active').length
  const activeSuppliers = suppliers.filter((supplier) => text(supplier.status).toLowerCase() === 'active').length
  const pendingQuotations = supplierItems.filter((row) => text(row.status).toLowerCase() !== 'active').length
  const flaggedActions = useMemo(() => {
    const supplierFlags = suppliers.filter((supplier) => {
      if (text(supplier.status).toLowerCase() !== 'active') return false
      const terms = paymentTermsInfo(supplier.paymentTerms)
      return !text(supplier.tinNumber).trim() || !text(supplier.contact).trim() || !text(supplier.phone).trim() || terms.invalid
    }).length
    const expiredQuotationFlags = supplierItems.filter((row) => text(row.status).toLowerCase() === 'active' && isExpired(row.quotationValidUntil)).length
    return supplierFlags + expiredQuotationFlags
  }, [supplierItems, suppliers])

  useEffect(() => {
    if (!selectedId) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId('')
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [selectedId])

  useEffect(() => {
    if (selectedId && !suppliers.some((supplier) => text(supplier.id) === selectedId)) setSelectedId('')
  }, [selectedId, suppliers])

  const openSupplier = (supplierId: string) => {
    setSelectedId(supplierId)
    setDrawerTab('overview')
  }
  const closeSupplier = () => setSelectedId('')
  const addQuoteFor = (supplierName: string) => app.openCreate('supplierItems', 'Add supplier quotation', undefined, { supplier: supplierName })

  return <div className="enterprise-workspace supplier-management-screen" style={{ width: '100%', maxWidth: 1500, minHeight: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
    <header className="supplier-management-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <h1 style={{ margin: '0 0 5px', color: 'var(--text)', fontSize: 29, fontWeight: 750 }}>Supplier Management</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Manage supplier profiles, supplied articles and current quotations.</p>
      </div>
      {canAddSupplier && <button type="button" onClick={() => app.openCreate('suppliers', 'Register supplier')} style={primary}><Icon name="add" size={17} />Register supplier</button>}
    </header>

    <section className="supplier-kpi-grid" aria-label="Supplier operational metrics">
      <MetricCard kind="suppliers" label="Total Active Suppliers" value={activeSuppliers} hint={`${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'} registered`} tone="good" />
      <MetricCard kind="quotations" label="Pending Quotations" value={pendingQuotations} hint="Inactive quotations requiring review" />
      <MetricCard kind="flag" label="Flagged Action Items" value={flaggedActions} hint="Missing data or expired quotations" tone={flaggedActions ? 'warning' : 'good'} />
    </section>

    <div className="supplier-filter-toolbar">
      <label className="supplier-search-field">
        <Icon name="search" size={18} color="var(--text-faint)" style={{ position: 'absolute', zIndex: 1, left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search supplier, TIN, contact or supplied article…" style={{ ...control, width: '100%', height: 42, paddingLeft: 38, paddingRight: query ? 40 : 12 }} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear supplier search" className="supplier-search-clear"><Icon name="close" size={17} /></button>}
      </label>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter suppliers by status" style={{ ...control, height: 42, minWidth: 170 }}>
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </div>

    <section className="supplier-table-shell" aria-label="Suppliers">
      <div className="supplier-table-scroll">
        <div className="supplier-data-table" role="table" aria-rowcount={filtered.length + 1}>
          <div className="supplier-table-head" role="row">
            <span role="columnheader">Supplier Name</span>
            <span role="columnheader">TIN</span>
            <span role="columnheader">Primary Contact Person</span>
            <span role="columnheader">Payment Terms</span>
            <span role="columnheader" className="supplier-cell-center">Active Items</span>
            <span role="columnheader">Status</span>
          </div>

          {filtered.map((supplier) => {
            const supplierId = text(supplier.id)
            const activeItems = activeItemCountBySupplier.get(supplierId) || 0
            const terms = paymentTermsInfo(supplier.paymentTerms)
            return <div
              key={supplierId}
              role="row"
              tabIndex={0}
              className={`supplier-table-row${selectedId === supplierId ? ' is-selected' : ''}`}
              onClick={() => openSupplier(supplierId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openSupplier(supplierId)
                }
              }}
              aria-label={`Open ${text(supplier.name)} supplier details`}
            >
              <span role="cell" className="supplier-name-cell"><span className="supplier-row-icon"><SupplierIcon active={selectedId === supplierId} /></span><span><strong>{text(supplier.name) || 'Unnamed supplier'}</strong><small>{text(supplier.email) || text(supplier.phone) || 'No contact channel recorded'}</small></span></span>
              <span role="cell" className="supplier-mono-cell">{text(supplier.tinNumber) || '—'}</span>
              <span role="cell"><strong className="supplier-table-primary">{text(supplier.contact) || 'Not recorded'}</strong><small className="supplier-table-secondary">{text(supplier.phone) || 'No phone'}</small></span>
              <span role="cell"><span className={terms.invalid ? 'supplier-review-text' : ''}>{terms.label}</span>{terms.invalid && <small className="supplier-table-secondary">Correct payment terms</small>}</span>
              <span role="cell" className="supplier-cell-center"><strong className="supplier-item-count">{activeItems}</strong></span>
              <span role="cell"><Status value={text(supplier.status)} /></span>
            </div>
          })}

          {!filtered.length && <div className="supplier-empty-state">
            <Icon name="search_off" size={28} color="var(--text-faint)" />
            <strong>No suppliers found</strong>
            <span>Try changing the search text or status filter.</span>
          </div>}
        </div>
      </div>
      <footer className="supplier-table-footer"><span>{filtered.length} shown</span><span>·</span><span>{suppliers.length} total suppliers</span></footer>
    </section>

    {selected && <>
      <div className="supplier-drawer-backdrop" aria-hidden="true" onClick={closeSupplier} />
      <aside className="supplier-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="supplier-drawer-title">
        <header className="supplier-drawer-header">
          <div className="supplier-drawer-title-wrap">
            <span className="supplier-drawer-icon"><SupplierIcon active /></span>
            <div>
              <small>Supplier</small>
              <h2 id="supplier-drawer-title">{text(selected.name) || 'Supplier details'}</h2>
            </div>
          </div>
          <div className="supplier-drawer-actions">
            <Status value={text(selected.status)} />
            {canEditSupplier && <button type="button" onClick={() => app.openEdit(text(selected.id), 'suppliers')} style={secondary}><Icon name="edit" size={16} />Edit</button>}
            <button type="button" onClick={closeSupplier} className="supplier-drawer-close" aria-label="Close supplier details"><Icon name="close" size={21} /></button>
          </div>
        </header>

        <nav className="supplier-drawer-tabs" aria-label="Supplier details tabs">
          <DrawerTabButton active={drawerTab === 'overview'} onClick={() => setDrawerTab('overview')}>Overview</DrawerTabButton>
          <DrawerTabButton active={drawerTab === 'items'} onClick={() => setDrawerTab('items')}>Items &amp; Quotations</DrawerTabButton>
          <DrawerTabButton active={drawerTab === 'contact'} onClick={() => setDrawerTab('contact')}>Contact Details</DrawerTabButton>
        </nav>

        <div className="supplier-drawer-body">
          {drawerTab === 'overview' && <SupplierOverview supplier={selected} activeItems={activeItemCountBySupplier.get(text(selected.id)) || 0} activeQuotes={selectedActiveQuotes} totalQuotes={selectedPrices.length} />}

          {drawerTab === 'items' && <SupplierItemsTab
            supplier={selected}
            rows={selectedPrices}
            canAdd={canAddQuote}
            canEdit={canEditQuote}
            onAdd={() => addQuoteFor(text(selected.name))}
            onAll={() => app.navTo('supplierItems', 'Supplier quotations')}
            onEdit={(id) => app.openEdit(id, 'supplierItems')}
          />}

          {drawerTab === 'contact' && <SupplierContact supplier={selected} />}
        </div>
      </aside>
    </>}
  </div>
}

function MetricCard({ kind, label, value, hint, tone = 'neutral' }: { kind: 'suppliers' | 'quotations' | 'flag'; label: string; value: number; hint: string; tone?: 'neutral' | 'good' | 'warning' }) {
  return <article className={`supplier-kpi-card supplier-kpi-${tone}`}>
    <span className="supplier-kpi-icon"><DashboardGlyph kind={kind} tone={tone} size={19} /></span>
    <div className="supplier-kpi-copy"><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{hint}</small></div>
  </article>
}

function DrawerTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={active ? 'is-active' : ''} onClick={onClick} aria-selected={active} role="tab">{children}</button>
}

function SupplierOverview({ supplier, activeItems, activeQuotes, totalQuotes }: { supplier: Record<string, any>; activeItems: number; activeQuotes: number; totalQuotes: number }) {
  const terms = paymentTermsInfo(supplier.paymentTerms)
  return <div className="supplier-tab-section">
    <div className="supplier-section-heading">
      <div><h3>Supplier overview</h3><p>Core registration and commercial information.</p></div>
    </div>

    <div className="supplier-field-grid">
      <FieldSlot label="TIN" value={text(supplier.tinNumber) || 'Not recorded'} mono />
      <FieldSlot label="Registration number" value={text(supplier.registrationNumber) || 'Not recorded'} mono />
      <FieldSlot label="Payment terms" value={terms.label} warning={terms.invalid ? 'The stored value appears to be a payment method. Update it to terms such as Net 30.' : undefined} />
      <FieldSlot label="Address" value={text(supplier.address) || 'Not recorded'} wide />
    </div>

    <div className="supplier-overview-stats">
      <MiniStat label="Active items" value={activeItems} />
      <MiniStat label="Active quotations" value={activeQuotes} />
      <MiniStat label="Quotation records" value={totalQuotes} />
    </div>
  </div>
}

function SupplierContact({ supplier }: { supplier: Record<string, any> }) {
  return <div className="supplier-tab-section">
    <div className="supplier-section-heading"><div><h3>Contact details</h3><p>Primary contact information for supplier communication.</p></div></div>
    <div className="supplier-contact-list">
      <ContactRow kind="person" label="Primary contact person" value={text(supplier.contact) || 'Not recorded'} />
      <ContactRow kind="phone" label="Phone" value={text(supplier.phone) || 'Not recorded'} />
      <ContactRow kind="mail" label="Email" value={text(supplier.email) || 'Not recorded'} />
      <ContactRow kind="location" label="Address" value={text(supplier.address) || 'Not recorded'} />
    </div>
  </div>
}

function SupplierItemsTab({ supplier, rows, canAdd, canEdit, onAdd, onAll, onEdit }: { supplier: Record<string, any>; rows: any[]; canAdd: boolean; canEdit: boolean; onAdd: () => void; onAll: () => void; onEdit: (id: string) => void }) {
  return <div className="supplier-tab-section supplier-items-section">
    <div className="supplier-section-heading supplier-items-heading">
      <div><h3>Items &amp; quotations</h3><p>Articles supplied by {text(supplier.name)} and their current quotation records.</p></div>
      <div className="supplier-inline-actions">
        {canAdd && <button type="button" onClick={onAdd} style={primaryCompact}><Icon name="add" size={16} />Add quotation</button>}
        <button type="button" onClick={onAll} style={secondary}><Icon name="request_quote" size={16} />All quotations</button>
      </div>
    </div>

    <div className="supplier-items-table-wrap">
      <div className="supplier-items-table" role="table">
        <div className="supplier-items-head" role="row">
          <span role="columnheader">Item SKU</span>
          <span role="columnheader">Name</span>
          <span role="columnheader">UOM</span>
          <span role="columnheader">Reference No.</span>
          <span role="columnheader">Quoted Price</span>
          <span role="columnheader">Status</span>
          <span aria-hidden="true" />
        </div>
        {rows.map((row) => <div className="supplier-items-row" role="row" key={text(row.id)}>
          <span role="cell" className="supplier-mono-cell">{text(row.articleSku) || '—'}</span>
          <span role="cell"><strong className="supplier-table-primary">{text(row.article) || 'Unnamed article'}</strong><small className="supplier-table-secondary">{text(row.category) || 'No item group'}</small></span>
          <span role="cell">{text(row.unit) || '—'}</span>
          <span role="cell" className="supplier-mono-cell">{text(row.supplierSku) || text(row.quotationReference) || '—'}</span>
          <span role="cell"><strong className="supplier-table-primary">{money(row.price, text(row.currency) || 'UGX')}</strong>{row.quotationValidUntil && <small className={`supplier-table-secondary${isExpired(row.quotationValidUntil) ? ' is-expired' : ''}`}>{isExpired(row.quotationValidUntil) ? 'Expired ' : 'Valid to '}{text(row.quotationValidUntil)}</small>}</span>
          <span role="cell"><Status value={text(row.status)} /></span>
          <span role="cell">{canEdit && <button type="button" onClick={() => onEdit(text(row.id))} title="Edit supplier quotation" aria-label={`Edit ${text(row.article)} quotation`} className="supplier-item-edit"><Icon name="edit" size={16} /></button>}</span>
        </div>)}
        {!rows.length && <div className="supplier-drawer-empty"><Icon name="request_quote" size={28} color="var(--text-faint)" /><strong>No supplied items yet</strong><span>This supplier does not yet have an article quotation.</span>{canAdd && <button type="button" onClick={onAdd} style={{ ...primaryCompact, marginTop: 10 }}><Icon name="add" size={16} />Add quotation</button>}</div>}
      </div>
    </div>
  </div>
}

function FieldSlot({ label, value, mono = false, wide = false, warning }: { label: string; value: string; mono?: boolean; wide?: boolean; warning?: string }) {
  return <div className={`supplier-field-slot${wide ? ' is-wide' : ''}`}>
    <span>{label}</span>
    <strong className={mono ? 'supplier-mono-cell' : ''}>{value}</strong>
    {warning && <small className="supplier-field-warning"><Icon name="warning" size={15} />{warning}</small>}
  </div>
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="supplier-mini-stat"><strong>{value.toLocaleString()}</strong><span>{label}</span></div>
}

function ContactRow({ kind, label, value }: { kind: 'person' | 'phone' | 'mail' | 'location'; label: string; value: string }) {
  return <div className="supplier-contact-row"><span className="supplier-contact-icon"><ContactGlyph kind={kind} size={19} /></span><div><span>{label}</span><strong>{value}</strong></div></div>
}

function Status({ value }: { value: string }) {
  const active = value.toLowerCase() === 'active'
  return <span className={`supplier-status ${active ? 'is-active' : 'is-inactive'}`}><span />{value || 'Inactive'}</span>
}

const control: CSSProperties = { height: 38, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12, outline: 'none' }
const primary: CSSProperties = { minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const primaryCompact: CSSProperties = { minHeight: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const secondary: CSSProperties = { minHeight: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: 12, fontWeight: 650, cursor: 'pointer' }
