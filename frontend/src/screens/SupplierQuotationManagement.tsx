import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { money } from '../lib/theme'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

const text = (value: unknown) => String(value ?? '')
const number = (value: unknown) => Number(value || 0)

function FolderIcon({ open = false, active = false, size = 18 }: { open?: boolean; active?: boolean; size?: number }) {
  const color = active ? 'var(--accent)' : 'var(--text-muted)'
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block' }}>
    <path d="M3.5 6.4c0-1 .8-1.8 1.8-1.8h4l1.7 1.8h7.7c1 0 1.8.8 1.8 1.8v1H3.5V6.4Z" fill={color} opacity={open ? .7 : .56} />
    {open
      ? <path d="M3.9 9.2h16.6c.8 0 1.4.7 1.2 1.5L19.1 18c-.2.8-.9 1.3-1.7 1.3H5.8c-.8 0-1.4-.5-1.6-1.2l-1.5-7c-.2-.9.4-1.9 1.2-1.9Z" fill={color} />
      : <path d="M3.5 8.8h17v8.3c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8V8.8Z" fill={color} />}
  </svg>
}

function ArticleIcon({ active = false }: { active?: boolean }) {
  const color = active ? 'var(--accent)' : 'var(--text-faint)'
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block' }}>
    <path d="M5 7.2 12 3l7 4.2v9.6L12 21l-7-4.2V7.2Z" stroke={color} strokeWidth="1.65" strokeLinejoin="round" />
    <path d="m5.3 7.4 6.7 4 6.7-4M12 11.4V21" stroke={color} strokeWidth="1.65" strokeLinejoin="round" />
  </svg>
}

function quoteValidity(value: unknown) {
  const raw = text(value)
  if (!raw) return { label: 'No expiry recorded', tone: 'neutral' as const }
  const target = new Date(`${raw.slice(0, 10)}T23:59:59`)
  if (Number.isNaN(target.getTime())) return { label: raw, tone: 'neutral' as const }
  const now = new Date()
  const days = Math.ceil((target.getTime() - now.getTime()) / 86400000)
  if (days < 0) return { label: `Expired ${raw.slice(0, 10)}`, tone: 'bad' as const }
  if (days <= 14) return { label: `Expires ${raw.slice(0, 10)}`, tone: 'warn' as const }
  return { label: `Valid to ${raw.slice(0, 10)}`, tone: 'good' as const }
}

export default function SupplierQuotationManagement() {
  const app = useApp()
  const categories = app.data.categories || []
  const items = app.data.items || []
  const rows = app.data.supplierItems || []
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [selectedArticleId, setSelectedArticleId] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const permissionMetadata = app.user.permissions.length > 0
  const canAdd = app.user.isSuperuser || app.user.permissions.includes('inventory.add_supplieritemprice') || (!permissionMetadata && app.user.isStaff)
  const canEdit = app.user.isSuperuser || app.user.permissions.includes('inventory.change_supplieritemprice') || (!permissionMetadata && app.user.isStaff)

  const roots = useMemo(
    () => categories.filter((category) => !category.parentId).sort((a, b) => text(a.name).localeCompare(text(b.name))),
    [categories],
  )
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Row[]>()
    categories.filter((category) => category.parentId).forEach((category) => {
      const key = text(category.parentId)
      map.set(key, [...(map.get(key) || []), category])
    })
    map.forEach((entries) => entries.sort((a, b) => text(a.name).localeCompare(text(b.name))))
    return map
  }, [categories])
  const itemsByCategory = useMemo(() => {
    const map = new Map<string, Row[]>()
    items.forEach((item) => {
      const key = text(item.categoryId)
      map.set(key, [...(map.get(key) || []), item])
    })
    map.forEach((entries) => entries.sort((a, b) => text(a.name).localeCompare(text(b.name))))
    return map
  }, [items])
  const quotesByArticle = useMemo(() => {
    const map = new Map<string, Row[]>()
    rows.forEach((row) => {
      const key = text(row.articleId) || `name:${text(row.article).toLowerCase()}`
      map.set(key, [...(map.get(key) || []), row])
    })
    map.forEach((entries) => entries.sort((a, b) => number(a.price) - number(b.price)))
    return map
  }, [rows])

  const normalizedQuery = query.trim().toLowerCase()
  const matchingItemIds = useMemo(() => {
    if (!normalizedQuery) return null
    const result = new Set<string>()
    items.forEach((item) => {
      const itemId = text(item.id)
      const quotes = quotesByArticle.get(itemId) || []
      const haystack = [item.name, item.sku, item.category, item.categoryPath, ...quotes.flatMap((quote) => [quote.supplier, quote.quotationReference, quote.supplierSku, quote.unit])].map(text).join(' ').toLowerCase()
      if (haystack.includes(normalizedQuery)) result.add(itemId)
    })
    return result
  }, [items, normalizedQuery, quotesByArticle])

  const visibleItem = (item: Row) => !matchingItemIds || matchingItemIds.has(text(item.id))
  const visibleChildren = (rootId: string) => (childrenByParent.get(rootId) || []).filter((child) => (itemsByCategory.get(text(child.id)) || []).some(visibleItem))

  useEffect(() => {
    if (!expanded.size && roots.length) {
      const next = new Set<string>()
      roots.forEach((root) => next.add(text(root.id)))
      const firstGroup = childrenByParent.get(text(roots[0]?.id))?.[0]
      if (firstGroup) next.add(text(firstGroup.id))
      setExpanded(next)
    }
  }, [childrenByParent, expanded.size, roots])

  useEffect(() => {
    const eligible = items.filter(visibleItem)
    if (!eligible.length) {
      setSelectedArticleId('')
      return
    }
    if (!selectedArticleId || !eligible.some((item) => text(item.id) === selectedArticleId)) {
      const firstWithQuote = eligible.find((item) => (quotesByArticle.get(text(item.id)) || []).length > 0) || eligible[0]
      setSelectedArticleId(text(firstWithQuote.id))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchingItemIds, items, quotesByArticle, selectedArticleId])

  const selectedItem = items.find((item) => text(item.id) === selectedArticleId) || null
  const selectedCategory = selectedItem ? categories.find((category) => text(category.id) === text(selectedItem.categoryId)) : null
  const selectedMajor = selectedCategory?.parentId ? categories.find((category) => text(category.id) === text(selectedCategory.parentId)) : null
  const articleQuotes = selectedItem ? (quotesByArticle.get(text(selectedItem.id)) || []) : []
  const filteredQuotes = articleQuotes.filter((row) => !status || text(row.status).toLowerCase() === status)
  const activeQuotes = articleQuotes.filter((row) => text(row.status).toLowerCase() === 'active')
  const lowestPrice = activeQuotes.length ? Math.min(...activeQuotes.map((row) => number(row.price))) : 0
  const highestPrice = activeQuotes.length ? Math.max(...activeQuotes.map((row) => number(row.price))) : 0
  const supplierCount = new Set(activeQuotes.map((row) => text(row.supplierId) || text(row.supplier))).size
  const units = new Set(activeQuotes.map((row) => text(row.unit)).filter(Boolean))

  const chooseItem = (item: Row) => {
    setSelectedArticleId(text(item.id))
    const category = categories.find((entry) => text(entry.id) === text(item.categoryId))
    setExpanded((current) => {
      const next = new Set(current)
      if (category) next.add(text(category.id))
      if (category?.parentId) next.add(text(category.parentId))
      return next
    })
  }
  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  const addQuotationForItem = (item: Row) => app.openCreate('supplierItems', 'Add supplier quotation', undefined, { article: text(item.name) })

  return <div style={{ maxWidth: 1500, margin: '0 auto' }}>
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <h1 style={{ margin: '0 0 5px', color: 'var(--text)', fontSize: 29, fontWeight: 750 }}>Supplier Quotations</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Select an article to compare supplier prices, purchase units, quotation validity and lead times.</p>
      </div>
      {canAdd && <button type="button" onClick={() => app.openCreate('supplierItems', 'Add supplier quotation')} style={primary}><Icon name="add" size={17} />Add supplier quotation</button>}
    </header>

    <div style={{ display: 'flex', gap: 9, marginBottom: 12, flexWrap: 'wrap' }}>
      <label style={{ flex: '1 1 480px', minWidth: 240, position: 'relative' }}>
        <Icon name="search" size={18} color="var(--text-faint)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search article, SKU, supplier or quotation number…" style={{ ...control, width: '100%', height: 42, paddingLeft: 38 }} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear quotation search" style={{ ...iconButton, position: 'absolute', right: 5, top: 4, border: 0 }}><Icon name="close" size={17} /></button>}
      </label>
      <select value={status} onChange={(event) => setStatus(event.target.value)} style={{ ...control, height: 42, width: 165 }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
    </div>

    <div className="catalogue-layout quotation-explorer-layout" style={{ display: 'grid', gridTemplateColumns: '365px minmax(0,1fr)', minHeight: 620, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
      <aside style={{ minWidth: 0, borderRight: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <div style={panelHeader}><span>Article explorer</span><small>{items.length} article{items.length === 1 ? '' : 's'} · {rows.length} quote{rows.length === 1 ? '' : 's'}</small></div>
        <div style={{ padding: '8px 7px' }}>
          {roots.map((root) => {
            const rootId = text(root.id)
            const groups = normalizedQuery ? visibleChildren(rootId) : (childrenByParent.get(rootId) || [])
            if (normalizedQuery && !groups.length) return null
            const open = expanded.has(rootId)
            return <div key={rootId} style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button type="button" onClick={() => toggle(rootId)} aria-label={`${open ? 'Collapse' : 'Expand'} ${text(root.name)}`} style={treeToggle}><Icon name={open ? 'expand_more' : 'chevron_right'} size={18} /></button>
                <button type="button" onClick={() => toggle(rootId)} style={{ ...treeRow, fontWeight: 750, color: 'var(--text)' }}><FolderIcon open={open} /><span style={{ flex: 1 }}>{text(root.name)}</span><small>{groups.length} group{groups.length === 1 ? '' : 's'}</small></button>
              </div>
              {open && groups.map((group) => {
                const groupId = text(group.id)
                const groupItems = (itemsByCategory.get(groupId) || []).filter(visibleItem)
                if (normalizedQuery && !groupItems.length) return null
                const groupOpen = expanded.has(groupId)
                return <div key={groupId}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button type="button" onClick={() => toggle(groupId)} aria-label={`${groupOpen ? 'Collapse' : 'Expand'} ${text(group.name)}`} style={{ ...treeToggle, marginLeft: 18 }}><Icon name={groupOpen ? 'expand_more' : 'chevron_right'} size={18} /></button>
                    <button type="button" onClick={() => toggle(groupId)} style={{ ...treeRow, width: 'calc(100% - 18px)', color: 'var(--text-muted)', fontWeight: 650 }}><FolderIcon open={groupOpen} size={17} /><span style={{ flex: 1 }}>{text(group.name)}</span><small>{groupItems.length}</small></button>
                  </div>
                  {groupOpen && <div style={{ marginLeft: 49, borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
                    {groupItems.map((item) => {
                      const itemId = text(item.id)
                      const active = selectedArticleId === itemId
                      const quoteCount = (quotesByArticle.get(itemId) || []).length
                      return <div key={itemId} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <button type="button" onClick={() => chooseItem(item)} style={{ ...treeLeaf, flex: 1, minWidth: 0, color: active ? 'var(--accent)' : 'var(--text-muted)', background: active ? 'var(--accent-soft)' : 'transparent', fontWeight: active ? 700 : 560 }}>
                          <ArticleIcon active={active} />
                          <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text(item.name)}</span><small style={{ display: 'block', marginTop: 1, color: active ? 'var(--accent)' : 'var(--text-faint)', fontWeight: 520 }}>{text(item.sku)}</small></span>
                          <small style={{ whiteSpace: 'nowrap' }}>{quoteCount} quote{quoteCount === 1 ? '' : 's'}</small>
                        </button>
                        {canAdd && <button type="button" onClick={() => addQuotationForItem(item)} title={`Add quotation for ${text(item.name)}`} aria-label={`Add quotation for ${text(item.name)}`} style={quickAdd}><Icon name="add" size={17} /></button>}
                      </div>
                    })}
                  </div>}
                </div>
              })}
            </div>
          })}
          {normalizedQuery && matchingItemIds?.size === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}><Icon name="search_off" size={24} color="var(--text-faint)" /><div style={{ marginTop: 8, fontWeight: 700, color: 'var(--text)' }}>No matching articles</div><div style={{ marginTop: 3 }}>Try another article, supplier or quotation reference.</div></div>}
        </div>
      </aside>

      <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selectedItem ? <>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}><div style={{ color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.045em' }}>Selected article</div><h2 style={{ margin: '3px 0 2px', color: 'var(--text)', fontSize: 19, fontWeight: 750 }}>{text(selectedItem.name)}</h2><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{[selectedMajor?.name, selectedCategory?.name, selectedItem.sku].filter(Boolean).map(text).join(' › ')}</div></div>
              {canAdd && <button type="button" onClick={() => addQuotationForItem(selectedItem)} style={primaryCompact}><Icon name="add" size={16} />Add quotation for this article</button>}
            </div>
            <div className="supplier-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginTop: 12 }}>
              <Summary label="Supplier options" value={String(supplierCount)} sub={`${activeQuotes.length} active quotation${activeQuotes.length === 1 ? '' : 's'}`} />
              <Summary label="Lowest active price" value={activeQuotes.length ? money(lowestPrice) : '—'} sub={activeQuotes.length > 1 && highestPrice !== lowestPrice ? `Range to ${money(highestPrice)}` : 'Current quotation catalogue'} />
              <Summary label="Purchase UOMs" value={String(units.size || 0)} sub={Array.from(units).slice(0, 2).join(', ') || 'No active UOM'} />
              <Summary label="Base unit" value={text(selectedItem.uom) || '—'} sub={`SKU ${text(selectedItem.sku) || 'not recorded'}`} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--text)', fontSize: 13.5, fontWeight: 750 }}>Supplier price comparison</div>
            <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{filteredQuotes.length} quotation{filteredQuotes.length === 1 ? '' : 's'}</span>
          </div>

          <div style={{ overflowX: 'auto', flex: 1 }}>
            <div style={{ minWidth: 900 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,1.4fr) 100px 125px minmax(145px,1fr) 145px 90px 90px 42px', gap: 8, padding: '0 10px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <span style={headCell}>Supplier</span><span style={headCell}>Purchase UOM</span><span style={{ ...headCell, justifyContent: 'flex-end' }}>Quoted Price</span><span style={headCell}>Quotation</span><span style={headCell}>Validity</span><span style={headCell}>Lead</span><span style={headCell}>Status</span><span />
              </div>
              {filteredQuotes.map((row) => {
                const active = text(row.status).toLowerCase() === 'active'
                const lowest = active && activeQuotes.length > 1 && number(row.price) === lowestPrice
                const validity = quoteValidity(row.quotationValidUntil)
                return <div key={text(row.id)} style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,1.4fr) 100px 125px minmax(145px,1fr) 145px 90px 90px 42px', gap: 8, alignItems: 'center', minHeight: 62, padding: '0 10px', borderBottom: '1px solid var(--border)', background: lowest ? 'var(--good-soft)' : 'transparent' }}>
                  <span style={{ ...bodyCell, display: 'block' }}><strong style={{ display: 'block', color: 'var(--text)' }}>{text(row.supplier) || '—'}</strong><small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)' }}>{text(row.supplierSku) || 'No supplier reference'}</small></span>
                  <span style={bodyCell}>{text(row.unit) || '—'}</span>
                  <span style={{ ...bodyCell, justifyContent: 'flex-end', color: 'var(--text)', fontWeight: 760 }}><span>{money(row.price || 0)}</span>{lowest && <span style={bestBadge}>Lowest</span>}</span>
                  <span style={{ ...bodyCell, display: 'block' }}><strong style={{ display: 'block', color: 'var(--text)' }}>{text(row.quotationReference) || 'Not recorded'}</strong><small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)' }}>{row.effectiveFrom ? `From ${text(row.effectiveFrom).slice(0, 10)}` : 'Effective date not recorded'}</small></span>
                  <span style={bodyCell}><Validity value={validity} /></span>
                  <span style={bodyCell}>{number(row.leadTime)} day{number(row.leadTime) === 1 ? '' : 's'}</span>
                  <span style={bodyCell}><Status value={text(row.status)} /></span>
                  <span style={bodyCell}>{canEdit && <button type="button" onClick={() => app.openEdit(text(row.id), 'supplierItems')} title="Edit supplier quotation" style={iconButton}><Icon name="edit" size={16} /></button>}</span>
                </div>
              })}
              {!filteredQuotes.length && <div style={{ padding: 54, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}><Icon name="request_quote" size={27} color="var(--text-faint)" /><div style={{ marginTop: 8, color: 'var(--text)', fontWeight: 750 }}>No quotations for this article</div><div style={{ marginTop: 4 }}>{status ? 'No quotations match the selected status.' : 'Add supplier quotations to start comparing prices.'}</div>{canAdd && !status && <button type="button" onClick={() => addQuotationForItem(selectedItem)} style={{ ...primaryCompact, marginTop: 12 }}><Icon name="add" size={16} />Add quotation</button>}</div>}
            </div>
          </div>

          <footer style={{ minHeight: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 11.5 }}><span>{articleQuotes.length} quotation{articleQuotes.length === 1 ? '' : 's'} recorded</span><span>·</span><span>{supplierCount} active supplier option{supplierCount === 1 ? '' : 's'}</span></footer>
        </> : <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}><div><ArticleIcon /><div style={{ marginTop: 10, color: 'var(--text)', fontWeight: 750 }}>Select an article</div><div style={{ marginTop: 4, fontSize: 12 }}>Choose an article from the explorer to compare supplier quotations.</div></div></div>}
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

function Validity({ value }: { value: ReturnType<typeof quoteValidity> }) {
  const palette = value.tone === 'bad'
    ? { color: 'var(--bad)', background: 'var(--bad-soft)' }
    : value.tone === 'warn'
      ? { color: 'var(--warn)', background: 'var(--warn-soft)' }
      : value.tone === 'good'
        ? { color: 'var(--good)', background: 'var(--good-soft)' }
        : { color: 'var(--text-muted)', background: 'var(--surface-3)' }
  return <span style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%', padding: '4px 7px', borderRadius: 999, color: palette.color, background: palette.background, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{value.label}</span>
}

const control: CSSProperties = { height: 38, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12, outline: 'none' }
const primary: CSSProperties = { minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const primaryCompact: CSSProperties = { minHeight: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const iconButton: CSSProperties = { width: 34, height: 34, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
const quickAdd: CSSProperties = { width: 32, height: 32, display: 'grid', placeItems: 'center', flex: 'none', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--accent)', cursor: 'pointer' }
const panelHeader: CSSProperties = { minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 13px', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 11.5, fontWeight: 750 }
const treeToggle: CSSProperties = { width: 26, height: 36, display: 'grid', placeItems: 'center', flex: 'none', border: 0, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }
const treeRow: CSSProperties = { minWidth: 0, flex: 1, minHeight: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', border: 0, borderRadius: 7, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 12, background: 'transparent' }
const treeLeaf: CSSProperties = { minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: 0, borderRadius: 6, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 11.5 }
const headCell: CSSProperties = { minWidth: 0, minHeight: 40, display: 'flex', alignItems: 'center', padding: '0 8px', color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }
const bodyCell: CSSProperties = { minWidth: 0, display: 'flex', alignItems: 'center', padding: '8px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-muted)', fontSize: 12 }
const bestBadge: CSSProperties = { marginLeft: 6, display: 'inline-flex', padding: '2px 6px', borderRadius: 999, background: 'var(--good)', color: '#fff', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.025em' }
