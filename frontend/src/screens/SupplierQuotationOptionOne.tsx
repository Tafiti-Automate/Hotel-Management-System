import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { currencyMoney } from '../lib/theme'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

const text = (value: unknown) => String(value ?? '').trim()
const num = (value: unknown) => {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const key = (value: unknown) => text(value).toLowerCase()

function quoteValidity(value: unknown) {
  const raw = text(value)
  if (!raw) return { label: 'No expiry recorded', tone: 'neutral' as const }
  const target = new Date(`${raw.slice(0, 10)}T23:59:59`)
  if (Number.isNaN(target.getTime())) return { label: raw, tone: 'neutral' as const }
  const days = Math.ceil((target.getTime() - Date.now()) / 86400000)
  if (days < 0) return { label: `Expired ${raw.slice(0, 10)}`, tone: 'bad' as const }
  if (days <= 14) return { label: `Expires ${raw.slice(0, 10)}`, tone: 'warn' as const }
  return { label: `Valid to ${raw.slice(0, 10)}`, tone: 'good' as const }
}

function supplierKey(row: Row) {
  return text(row.supplierId) || key(row.supplier)
}

function articleKeyFromItem(item: Row) {
  return text(item.id) || `name:${key(item.name)}`
}

export default function SupplierQuotationOptionOne() {
  const app = useApp()
  const categories = app.data.categories || []
  const items = app.data.items || []
  const quotes = app.data.supplierItems || []

  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedArticleId, setSelectedArticleId] = useState('')
  const [selectedQuoteId, setSelectedQuoteId] = useState('')
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
      const parentId = text(category.parentId)
      map.set(parentId, [...(map.get(parentId) || []), category])
    })
    map.forEach((entries) => entries.sort((a, b) => text(a.name).localeCompare(text(b.name))))
    return map
  }, [categories])

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, Row[]>()
    items.forEach((item) => {
      const categoryId = text(item.categoryId)
      map.set(categoryId, [...(map.get(categoryId) || []), item])
    })
    map.forEach((entries) => entries.sort((a, b) => text(a.name).localeCompare(text(b.name))))
    return map
  }, [items])

  const quotesByArticle = useMemo(() => {
    const map = new Map<string, Row[]>()
    quotes.forEach((quote) => {
      const idKey = text(quote.articleId)
      const nameKey = `name:${key(quote.article)}`
      const keys = new Set([idKey, nameKey].filter(Boolean))
      keys.forEach((entryKey) => map.set(entryKey, [...(map.get(entryKey) || []), quote]))
    })
    map.forEach((entries) => entries.sort((a, b) => num(a.price) - num(b.price)))
    return map
  }, [quotes])

  const supplierOptions = useMemo(() => {
    const map = new Map<string, string>()
    quotes.forEach((quote) => {
      const id = supplierKey(quote)
      const label = text(quote.supplier)
      if (id && label && !map.has(id)) map.set(id, label)
    })
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [quotes])

  const categoryOptions = useMemo(
    () => categories.slice().sort((a, b) => text(a.name).localeCompare(text(b.name))),
    [categories],
  )

  const categoryMatches = (item: Row) => {
    if (!categoryFilter) return true
    const itemCategory = text(item.categoryId)
    if (itemCategory === categoryFilter) return true
    const category = categories.find((entry) => text(entry.id) === itemCategory)
    return text(category?.parentId) === categoryFilter
  }

  const quoteMatchesFilters = (quote: Row) => {
    if (supplierFilter && supplierKey(quote) !== supplierFilter) return false
    if (statusFilter && key(quote.status) !== statusFilter) return false
    return true
  }

  const normalizedQuery = query.trim().toLowerCase()
  const eligibleItems = useMemo(() => items.filter((item) => {
    if (!categoryMatches(item)) return false
    const itemQuotes = quotesByArticle.get(articleKeyFromItem(item)) || quotesByArticle.get(`name:${key(item.name)}`) || []
    const filteredItemQuotes = itemQuotes.filter(quoteMatchesFilters)
    if ((supplierFilter || statusFilter) && !filteredItemQuotes.length) return false
    if (!normalizedQuery) return true
    const itemText = [item.name, item.sku, item.category, item.categoryPath].map(text).join(' ').toLowerCase()
    if (itemText.includes(normalizedQuery)) return true
    return filteredItemQuotes.some((quote) => [quote.supplier, quote.quotationReference, quote.supplierSku, quote.unit, quote.currency]
      .map(text).join(' ').toLowerCase().includes(normalizedQuery))
  }), [items, categories, categoryFilter, quotesByArticle, supplierFilter, statusFilter, normalizedQuery])

  const eligibleItemIds = useMemo(() => new Set(eligibleItems.map((item) => text(item.id))), [eligibleItems])

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
    if (!eligibleItems.length) {
      setSelectedArticleId('')
      return
    }
    if (!selectedArticleId || !eligibleItems.some((item) => text(item.id) === selectedArticleId)) {
      const withQuotes = eligibleItems.find((item) => {
        const rows = quotesByArticle.get(articleKeyFromItem(item)) || quotesByArticle.get(`name:${key(item.name)}`) || []
        return rows.some(quoteMatchesFilters)
      })
      setSelectedArticleId(text((withQuotes || eligibleItems[0]).id))
    }
  }, [eligibleItems, quotesByArticle, selectedArticleId, supplierFilter, statusFilter])

  const selectedItem = items.find((item) => text(item.id) === selectedArticleId) || null
  const selectedCategory = selectedItem ? categories.find((category) => text(category.id) === text(selectedItem.categoryId)) : null
  const selectedMajor = selectedCategory?.parentId ? categories.find((category) => text(category.id) === text(selectedCategory.parentId)) : null
  const articleQuotes = useMemo(() => {
    if (!selectedItem) return []
    return quotesByArticle.get(articleKeyFromItem(selectedItem)) || quotesByArticle.get(`name:${key(selectedItem.name)}`) || []
  }, [quotesByArticle, selectedItem])
  const filteredQuotes = useMemo(() => articleQuotes.filter(quoteMatchesFilters), [articleQuotes, supplierFilter, statusFilter])
  const activeQuotes = filteredQuotes.filter((quote) => key(quote.status) === 'active')
  const currencies = new Set(activeQuotes.map((quote) => text(quote.currency).toUpperCase() || 'UGX'))
  const comparisonCurrency = currencies.size === 1 ? Array.from(currencies)[0] : ''
  const lowestPrice = comparisonCurrency && activeQuotes.length ? Math.min(...activeQuotes.map((quote) => num(quote.price))) : 0
  const highestPrice = comparisonCurrency && activeQuotes.length ? Math.max(...activeQuotes.map((quote) => num(quote.price))) : 0
  const recommendedQuote = comparisonCurrency
    ? activeQuotes.find((quote) => num(quote.price) === lowestPrice) || activeQuotes[0] || filteredQuotes[0]
    : activeQuotes[0] || filteredQuotes[0]
  const supplierCount = new Set(activeQuotes.map(supplierKey)).size
  const units = new Set(activeQuotes.map((quote) => text(quote.unit)).filter(Boolean))

  useEffect(() => {
    if (!filteredQuotes.length) {
      setSelectedQuoteId('')
      return
    }
    if (!selectedQuoteId || !filteredQuotes.some((quote) => text(quote.id) === selectedQuoteId)) {
      setSelectedQuoteId(text(recommendedQuote?.id || filteredQuotes[0].id))
    }
  }, [filteredQuotes, recommendedQuote, selectedQuoteId])

  const selectedQuote = filteredQuotes.find((quote) => text(quote.id) === selectedQuoteId) || recommendedQuote || null
  const selectedCurrency = selectedQuote ? text(selectedQuote.currency).toUpperCase() || 'UGX' : 'UGX'
  const selectedValidity = selectedQuote ? quoteValidity(selectedQuote.quotationValidUntil) : null
  const isRecommended = Boolean(selectedQuote && recommendedQuote && text(selectedQuote.id) === text(recommendedQuote.id))
  const priceDelta = selectedQuote && comparisonCurrency && selectedCurrency === comparisonCurrency
    ? Math.max(0, num(selectedQuote.price) - lowestPrice)
    : 0

  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

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

  const addQuotationForItem = (item: Row) => app.openCreate('supplierItems', 'Add supplier quotation', undefined, { article: text(item.name) })

  const renderArticle = (item: Row) => {
    const itemId = text(item.id)
    if (!eligibleItemIds.has(itemId)) return null
    const quoteCount = (quotesByArticle.get(articleKeyFromItem(item)) || quotesByArticle.get(`name:${key(item.name)}`) || []).length
    const active = selectedArticleId === itemId
    return <button key={itemId} type="button" className={`quote-v2-article ${active ? 'is-active' : ''}`} onClick={() => chooseItem(item)}>
      <span className="quote-v2-article-icon"><Icon name="inventory_2" size={15} /></span>
      <span className="quote-v2-article-copy"><strong>{text(item.name)}</strong><small>{text(item.sku) || 'No SKU'}</small></span>
      <span className="quote-v2-article-count">{quoteCount}</span>
    </button>
  }

  return <div className="quote-v2">
    <header className="quote-v2-pagehead">
      <div>
        <span className="quote-v2-eyebrow">Procurement · Supplier sourcing</span>
        <h1>Supplier Quotations</h1>
        <p>Compare supplier prices, purchase units, quotation validity and lead times before procurement continues.</p>
      </div>
      <div className="quote-v2-filters" aria-label="Quotation filters">
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category"><option value="">All categories</option>{categoryOptions.map((category) => <option key={text(category.id)} value={text(category.id)}>{text(category.name)}</option>)}</select>
        <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} aria-label="Filter by supplier"><option value="">All suppliers</option>{supplierOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
      </div>
    </header>

    <div className="quote-v2-layout">
      <aside className="quote-v2-explorer">
        <div className="quote-v2-explorer-head"><div><strong>Articles</strong><small>{eligibleItems.length} visible · {quotes.length} quotes</small></div>{canAdd && <button type="button" className="quote-v2-icon-btn" onClick={() => app.openCreate('supplierItems', 'Add supplier quotation')} title="Add supplier quotation"><Icon name="add" size={17} /></button>}</div>
        <label className="quote-v2-search"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search article, SKU or quote…" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={15} /></button>}</label>
        <div className="quote-v2-tree">
          {roots.map((root) => {
            const rootId = text(root.id)
            const rootItems = (itemsByCategory.get(rootId) || []).filter((item) => eligibleItemIds.has(text(item.id)))
            const groups = (childrenByParent.get(rootId) || []).filter((group) => (itemsByCategory.get(text(group.id)) || []).some((item) => eligibleItemIds.has(text(item.id))))
            if (!rootItems.length && !groups.length) return null
            const open = expanded.has(rootId)
            return <section key={rootId} className="quote-v2-tree-section"><button type="button" className="quote-v2-tree-root" onClick={() => toggle(rootId)}><Icon name={open ? 'expand_more' : 'chevron_right'} size={16} /><Icon name="folder" size={15} /><span>{text(root.name)}</span><small>{rootItems.length + groups.reduce((total, group) => total + (itemsByCategory.get(text(group.id)) || []).filter((item) => eligibleItemIds.has(text(item.id))).length, 0)}</small></button>{open && <div className="quote-v2-tree-children">{rootItems.map(renderArticle)}{groups.map((group) => { const groupId = text(group.id); const groupItems = (itemsByCategory.get(groupId) || []).filter((item) => eligibleItemIds.has(text(item.id))); const groupOpen = expanded.has(groupId); return <div key={groupId} className="quote-v2-tree-group"><button type="button" className="quote-v2-tree-group-btn" onClick={() => toggle(groupId)}><Icon name={groupOpen ? 'expand_more' : 'chevron_right'} size={15} /><Icon name="folder" size={14} /><span>{text(group.name)}</span><small>{groupItems.length}</small></button>{groupOpen && <div className="quote-v2-tree-articles">{groupItems.map(renderArticle)}</div>}</div> })}</div>}</section>
          })}
          {!eligibleItems.length && <div className="quote-v2-empty-small"><Icon name="search_off" size={20} /><strong>No matching articles</strong><span>Change the search or filters.</span></div>}
        </div>
      </aside>

      <main className="quote-v2-main">
        {selectedItem ? <>
          <section className="quote-v2-selected-card">
            <div className="quote-v2-selected-top"><div className="quote-v2-product-mark"><Icon name="inventory_2" size={21} /></div><div className="quote-v2-selected-copy"><span>Selected article</span><h2>{text(selectedItem.name)}</h2><p>{[selectedMajor?.name, selectedCategory?.name, text(selectedItem.sku) && `SKU: ${text(selectedItem.sku)}`].filter(Boolean).join(' › ')}</p></div><div className="quote-v2-selected-actions"><button type="button" className="quote-v2-btn secondary" onClick={() => app.openDetail('items', text(selectedItem.id), 'supplierItems')}>View article details</button>{canAdd && <button type="button" className="quote-v2-btn primary" onClick={() => addQuotationForItem(selectedItem)}><Icon name="add" size={15} />Add quotation</button>}</div></div>
            <div className="quote-v2-summary-grid"><Summary label="Supplier options" value={String(supplierCount)} sub={`${activeQuotes.length} active quotation${activeQuotes.length === 1 ? '' : 's'}`} /><Summary label="Lowest active price" value={comparisonCurrency ? currencyMoney(lowestPrice, comparisonCurrency) : currencies.size > 1 ? 'Multiple currencies' : '—'} sub={comparisonCurrency && highestPrice > lowestPrice ? `Range to ${currencyMoney(highestPrice, comparisonCurrency)}` : 'Current active catalogue'} /><Summary label="Purchase UOM" value={units.size === 1 ? Array.from(units)[0] : units.size ? `${units.size} options` : '—'} sub={Array.from(units).slice(0, 2).join(', ') || 'No active UOM'} /><Summary label="Base unit" value={text(selectedItem.uom) || '—'} sub={`SKU: ${text(selectedItem.sku) || 'not recorded'}`} /></div>
          </section>

          <section className="quote-v2-comparison"><header><div><span>Supplier price comparison</span><h3>Compare quotations</h3></div><small>{filteredQuotes.length} quotation{filteredQuotes.length === 1 ? '' : 's'}</small></header><div className="quote-v2-table-wrap"><table className="quote-v2-table"><thead><tr><th>Supplier</th><th>Purchase UOM</th><th>Quoted price</th><th>Quotation</th><th>Validity</th><th>Lead time</th><th>Action</th></tr></thead><tbody>{filteredQuotes.map((quote) => { const quoteId = text(quote.id); const rowCurrency = text(quote.currency).toUpperCase() || 'UGX'; const lowest = Boolean(comparisonCurrency) && key(quote.status) === 'active' && rowCurrency === comparisonCurrency && num(quote.price) === lowestPrice; const selected = selectedQuoteId === quoteId; const validity = quoteValidity(quote.quotationValidUntil); return <tr key={quoteId} className={`${lowest ? 'is-lowest' : ''} ${selected ? 'is-selected' : ''}`}><td><div className="quote-v2-supplier-cell">{lowest && <span className="quote-v2-lowest-badge">Lowest price</span>}<strong>{text(quote.supplier) || 'Unnamed supplier'}</strong><small>{text(quote.supplierSku) || 'No supplier reference'}</small></div></td><td>{text(quote.unit) || '—'}</td><td><strong className="quote-v2-price">{currencyMoney(quote.price || 0, rowCurrency)}</strong></td><td><div className="quote-v2-ref"><strong>{text(quote.quotationReference) || 'Not recorded'}</strong><small>{quote.effectiveFrom ? `From ${text(quote.effectiveFrom).slice(0, 10)}` : 'No effective date'}</small></div></td><td><span className={`quote-v2-validity tone-${validity.tone}`}>{validity.label}</span></td><td>{num(quote.leadTime)} day{num(quote.leadTime) === 1 ? '' : 's'}</td><td><button type="button" className={`quote-v2-select-btn ${selected ? 'is-selected' : ''}`} onClick={() => setSelectedQuoteId(quoteId)}>{selected ? 'Selected' : 'Select'}</button></td></tr> })}</tbody></table>{!filteredQuotes.length && <div className="quote-v2-empty"><Icon name="request_quote" size={24} /><strong>No quotations match</strong><span>Change the supplier/status filters or add a new quotation for this article.</span>{canAdd && <button type="button" className="quote-v2-btn primary" onClick={() => addQuotationForItem(selectedItem)}>Add quotation</button>}</div>}</div></section>
        </> : <div className="quote-v2-empty quote-v2-main-empty"><Icon name="inventory_2" size={24} /><strong>Select an article</strong><span>Choose an article from the explorer to compare supplier quotations.</span></div>}
      </main>

      <aside className="quote-v2-decision">
        <section className="quote-v2-decision-card"><header><span>Decision support</span><h3>Why choose this supplier?</h3></header>{selectedQuote ? <><div className="quote-v2-choice"><span className={`quote-v2-choice-icon ${isRecommended ? 'is-best' : ''}`}><Icon name={isRecommended ? 'verified' : 'local_shipping'} size={18} /></span><div><small>{isRecommended ? 'Recommended option' : 'Selected option'}</small><strong>{text(selectedQuote.supplier) || 'Supplier'}</strong><span>{currencyMoney(selectedQuote.price || 0, selectedCurrency)} · {text(selectedQuote.unit) || 'UOM not set'}</span></div></div><div className="quote-v2-checks"><DecisionCheck icon="payments" title="Cost position" value={isRecommended ? 'Lowest active price' : priceDelta > 0 && comparisonCurrency ? `${currencyMoney(priceDelta, comparisonCurrency)} above lowest` : 'Price comparison available'} tone={isRecommended ? 'good' : 'info'} /><DecisionCheck icon="verified_user" title="Supplier record" value={key(selectedQuote.status) === 'active' ? 'Active quotation' : 'Quotation not active'} tone={key(selectedQuote.status) === 'active' ? 'good' : 'warn'} /><DecisionCheck icon="event_available" title="Quotation validity" value={selectedValidity?.label || 'Not recorded'} tone={selectedValidity?.tone === 'good' ? 'good' : selectedValidity?.tone === 'bad' ? 'bad' : 'warn'} /><DecisionCheck icon="schedule" title="Lead time" value={`${num(selectedQuote.leadTime)} day${num(selectedQuote.leadTime) === 1 ? '' : 's'}`} tone="info" /></div></> : <div className="quote-v2-empty-small"><Icon name="info" size={19} /><strong>No supplier selected</strong><span>Select a quotation to see decision support.</span></div>}</section>
        <section className="quote-v2-actions-card"><header><span>Quick actions</span></header><button type="button" className="quote-v2-action primary" onClick={() => app.navTo('workflow-procure', 'Procurement workbench')}><Icon name="shopping_cart" size={16} /><span>Open Procurement Workbench</span><Icon name="arrow_forward" size={14} /></button>{selectedQuote && canEdit && <button type="button" className="quote-v2-action" onClick={() => app.openEdit(text(selectedQuote.id), 'supplierItems')}><Icon name="edit" size={16} /><span>Edit selected quotation</span><Icon name="chevron_right" size={14} /></button>}{selectedItem && canAdd && <button type="button" className="quote-v2-action" onClick={() => addQuotationForItem(selectedItem)}><Icon name="add" size={16} /><span>Add quotation for article</span><Icon name="chevron_right" size={14} /></button>}</section>
        <section className="quote-v2-note"><Icon name="info" size={16} /><p>Price selection is decision support only. Procurement workflow, approval rules and LPO controls remain unchanged.</p></section>
      </aside>
    </div>
  </div>
}

function Summary({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="quote-v2-summary"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
}

function DecisionCheck({ icon, title, value, tone }: { icon: string; title: string; value: string; tone: 'good' | 'warn' | 'bad' | 'info' }) {
  return <div className={`quote-v2-check tone-${tone}`}><span><Icon name={icon} size={15} /></span><div><strong>{title}</strong><small>{value}</small></div></div>
}
