import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { currencyMoney } from '../lib/theme'
import { businessDate, comparableQuote, rankedQuotes } from '../lib/quotationComparison'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

const text = (value: unknown) => String(value ?? '').trim()
const num = (value: unknown) => {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const key = (value: unknown) => text(value).toLowerCase()

function supplierKey(row: Row) {
  return text(row.supplierId) || key(row.supplier)
}

function articleKeyFromItem(item: Row) {
  return text(item.id) || `name:${key(item.name)}`
}


/**
 * Filled, native folder silhouettes for the category hierarchy.
 * The shared Icon component deliberately maps "folder" to inventory_2
 * because its bundled font omits a real folder glyph.
 */
function TreeFolder({ kind, expanded }: { kind: 'main' | 'sub'; expanded: boolean }) {
  return <span className={`quote-v2-folder-icon is-${kind}`} aria-hidden="true">
    <svg viewBox="0 0 28 24" focusable="false" className="quote-v2-folder-svg">
      <path className="quote-v2-folder-tab" d="M2.4 5.1c0-1.1.9-2 2-2h5.8c.55 0 1.05.23 1.42.63l1.9 2.05h9.9c1.18 0 2.12.94 2.12 2.12v10.54c0 1.52-1.18 2.67-2.7 2.67H5.12c-1.5 0-2.72-1.2-2.72-2.7V5.1Z" />
      {expanded
        ? <path className="quote-v2-folder-face" d="M5.05 9.6h18.7c1.35 0 2.25 1.12 1.93 2.38l-1.83 7.04c-.24.99-1.1 1.64-2.1 1.64H4.2c-1.44 0-2.4-1.28-2.03-2.64l1.77-6.78c.24-.96 1.04-1.64 2.1-1.64Z" />
        : <path className="quote-v2-folder-face" d="M2.4 9.16h23.14v9.26c0 1.52-1.18 2.67-2.7 2.67H5.12c-1.5 0-2.72-1.2-2.72-2.7V9.16Z" />}
      <path className="quote-v2-folder-sheen" d={expanded ? "M5.65 11.7h17.05" : "M4.55 11.2h18.7"} />
    </svg>
  </span>
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
  const today = businessDate()
  const [selectedArticleId, setSelectedArticleId] = useState('')
  const [selectedQuoteId, setSelectedQuoteId] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const activeArticleRef = useRef<HTMLButtonElement | null>(null)

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
    // Sorting is performed after eligibility and base-unit normalization.
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

  // Reveal the selected article on first load and after changing filters.
  useEffect(() => {
    if (!selectedArticleId || !selectedCategory) return
    setExpanded((current) => {
      const categoryId = text(selectedCategory.id)
      const majorId = text(selectedMajor?.id)
      if (current.has(categoryId) && (!majorId || current.has(majorId))) return current
      const next = new Set(current)
      next.add(categoryId)
      if (majorId) next.add(majorId)
      return next
    })
  }, [selectedArticleId, selectedCategory?.id, selectedMajor?.id])

  useEffect(() => {
    if (selectedArticleId) activeArticleRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedArticleId, expanded])
  const articleQuotes = useMemo(() => {
    if (!selectedItem) return []
    return quotesByArticle.get(articleKeyFromItem(selectedItem)) || quotesByArticle.get(`name:${key(selectedItem.name)}`) || []
  }, [quotesByArticle, selectedItem])
  const compared = useMemo(() => articleQuotes.map(quote=>comparableQuote(quote,selectedItem,app.data.itemUnits||[],today)),
    [articleQuotes,selectedItem,app.data.itemUnits,today])
  const filteredQuotes = useMemo(() => compared.filter(row => quoteMatchesFilters(row.quote)), [compared, supplierFilter, statusFilter])
  // The filters also scope recommendations and totals; never recommend a hidden supplier.
  const eligibleQuotes = filteredQuotes.filter(row=>row.eligible)
  const ranked = rankedQuotes(eligibleQuotes)
  const eligibleCurrencies = new Set(eligibleQuotes.map(row=>row.currency))
  const comparisonCurrency = eligibleCurrencies.size===1 ? Array.from(eligibleCurrencies)[0] : ''
  const lowestPrice = ranked[0]?.basePrice ?? 0
  const highestPrice = ranked.length ? Math.max(...ranked.map(row=>row.basePrice)) : 0
  const recommended = ranked[0] || null
  const recommendedQuote = recommended?.quote || null
  const supplierCount = new Set(eligibleQuotes.map(row=>supplierKey(row.quote))).size
  const units = new Set(eligibleQuotes.map(row=>text(row.quote.unit)).filter(Boolean))
  useEffect(() => {
    if (!filteredQuotes.length) {
      setSelectedQuoteId('')
      return
    }
    if (!selectedQuoteId || !filteredQuotes.some((row) => text(row.quote.id) === selectedQuoteId)) {
      const visibleRecommendation = filteredQuotes.find((row) => text(row.quote.id) === text(recommendedQuote?.id))
      setSelectedQuoteId(text((visibleRecommendation || filteredQuotes[0]).quote.id))
    }
  }, [filteredQuotes, recommendedQuote, selectedQuoteId])

  const selectedComparison = filteredQuotes.find((row) => text(row.quote.id) === selectedQuoteId) || compared.find(row=>text(row.quote.id)===text(recommendedQuote?.id)) || null
  const selectedQuote = selectedComparison?.quote || null
  const selectedCurrency = selectedQuote ? text(selectedQuote.currency).toUpperCase() || 'UGX' : 'UGX'
  const selectedValidity = selectedComparison?.expiry || null
  const isRecommended = Boolean(selectedComparison?.eligible && selectedQuote && recommendedQuote && text(selectedQuote.id) === text(recommendedQuote.id))
  const priceDelta = selectedComparison?.eligible && comparisonCurrency && selectedCurrency === comparisonCurrency
    ? Math.max(0, selectedComparison.basePrice - lowestPrice)
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
    return <button key={itemId} ref={active ? activeArticleRef : undefined} aria-pressed={active} type="button" className={`quote-v2-article ${active ? 'is-active' : ''}`} onClick={() => chooseItem(item)}>
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
            return <section key={rootId} className="quote-v2-tree-section"><button type="button" className="quote-v2-tree-root" aria-expanded={open} title={`Major group: ${text(root.name)}`} onClick={() => toggle(rootId)}><Icon name={open ? 'expand_more' : 'chevron_right'} size={16} /><TreeFolder kind="main" expanded={open} /><span>{text(root.name)}</span><small>{rootItems.length + groups.reduce((total, group) => total + (itemsByCategory.get(text(group.id)) || []).filter((item) => eligibleItemIds.has(text(item.id))).length, 0)}</small></button>{open && <div className="quote-v2-tree-children">{rootItems.map(renderArticle)}{groups.map((group) => { const groupId = text(group.id); const groupItems = (itemsByCategory.get(groupId) || []).filter((item) => eligibleItemIds.has(text(item.id))); const groupOpen = expanded.has(groupId); return <div key={groupId} className="quote-v2-tree-group"><button type="button" className="quote-v2-tree-group-btn" aria-expanded={groupOpen} title={`Item group: ${text(group.name)}`} onClick={() => toggle(groupId)}><Icon name={groupOpen ? 'expand_more' : 'chevron_right'} size={15} /><TreeFolder kind="sub" expanded={groupOpen} /><span>{text(group.name)}</span><small>{groupItems.length}</small></button>{groupOpen && <div className="quote-v2-tree-articles">{groupItems.map(renderArticle)}</div>}</div> })}</div>}</section>
          })}
          {!eligibleItems.length && <div className="quote-v2-empty-small"><Icon name="search_off" size={20} /><strong>No matching articles</strong><span>Change the search or filters.</span></div>}
        </div>
      </aside>

      <main className="quote-v2-main">
        {selectedItem ? <>
          <section className="quote-v2-selected-card">
            <div className="quote-v2-selected-top"><div className="quote-v2-product-mark"><Icon name="inventory_2" size={21} /></div><div className="quote-v2-selected-copy"><span>Selected article</span><h2>{text(selectedItem.name)}</h2><p>{[selectedMajor?.name, selectedCategory?.name, text(selectedItem.sku) && `SKU: ${text(selectedItem.sku)}`].filter(Boolean).join(' › ')}</p></div><div className="quote-v2-selected-actions"><button type="button" className="quote-v2-btn secondary" onClick={() => app.openDetail('items', text(selectedItem.id), 'supplierItems')}>View article details</button>{canAdd && <button type="button" className="quote-v2-btn primary" onClick={() => addQuotationForItem(selectedItem)}><Icon name="add" size={15} />Add quotation</button>}</div></div>
            <div className="quote-v2-summary-grid">
              <Summary label="Eligible suppliers" value={String(supplierCount)} sub={`${eligibleQuotes.length} eligible of ${filteredQuotes.length} shown quotations`} />
              <Summary label={`Lowest / ${text(selectedItem.uom) || 'base unit'}`} value={comparisonCurrency && ranked.length ? currencyMoney(lowestPrice, comparisonCurrency) : eligibleCurrencies.size > 1 ? 'Mixed currencies' : '—'} sub={comparisonCurrency && highestPrice > lowestPrice ? `Range up to ${currencyMoney(highestPrice, comparisonCurrency)}` : comparisonCurrency ? 'Normalized eligible price' : 'No comparable price'} />
              <Summary label="Purchase units" value={units.size === 1 ? Array.from(units)[0] : units.size ? `${units.size} options` : '—'} sub={`Base: ${text(selectedItem.uom) || '—'}${units.size > 1 ? ` · ${Array.from(units).slice(0, 3).join(', ')}` : ''}`} />
            </div>
          </section>

          <section className="quote-v2-comparison"><header><div><span>Supplier price comparison</span><h3>Compare quotations</h3></div><small>{filteredQuotes.length} quotation{filteredQuotes.length === 1 ? '' : 's'} · {eligibleQuotes.length} eligible</small></header>
            <p className="quote-v2-table-guidance">Select a supplier to review the full quotation. Scroll sideways for more columns on smaller screens.</p>
            <div className="quote-v2-table-wrap" tabIndex={0} role="region" aria-label="Scrollable supplier quotation comparison">
              <table className="quote-v2-table"><thead><tr><th scope="col">Supplier / reference</th><th scope="col">Purchase unit</th><th scope="col" className="quote-v2-number">Quoted price</th><th scope="col" className="quote-v2-number">Per {text(selectedItem.uom)||'base unit'}</th><th scope="col">Validity</th><th scope="col">Lead time</th></tr></thead>
                <tbody>{filteredQuotes.slice().sort((a,b)=>(a.eligible===b.eligible?0:a.eligible?-1:1) || (a.currency===b.currency?a.basePrice-b.basePrice:0)).map((row) => {
                  const quote=row.quote, quoteId=text(quote.id),selected=selectedQuoteId===quoteId
                  const lowest=Boolean(row.eligible && recommended && row.currency===recommended.currency && row.basePrice===lowestPrice)
                  return <tr key={quoteId} className={`${lowest?'is-lowest':''} ${selected?'is-selected':''}`} aria-selected={selected} onClick={()=>setSelectedQuoteId(quoteId)}>
                    <td><div className="quote-v2-supplier-cell">{lowest&&<span className="quote-v2-lowest-badge">Lowest eligible price</span>}<button type="button" className="quote-v2-supplier-button" aria-pressed={selected} title={text(quote.supplier)} onClick={()=>setSelectedQuoteId(quoteId)}>{text(quote.supplier)||'Unnamed supplier'}</button><small title={text(quote.quotationReference)||'No reference'}>{text(quote.quotationReference) ? `Quote: ${text(quote.quotationReference)}` : 'Quotation reference not recorded'}</small></div></td>
                    <td><div className="quote-v2-uom"><strong>{text(quote.unit)||'—'}</strong><small>{Number.isFinite(row.factor)&&row.factor>0?`1 ${text(quote.unit)} = ${row.factor.toLocaleString('en-UG',{maximumFractionDigits:4})} ${text(selectedItem.uom)}`:'Conversion unavailable'}</small></div></td>
                    <td className="quote-v2-number"><strong className="quote-v2-price">{currencyMoney(quote.price||0,row.currency)}</strong></td>
                    <td className="quote-v2-number"><strong className="quote-v2-price">{Number.isFinite(row.basePrice)&&row.basePrice>0?currencyMoney(row.basePrice,row.currency):'—'}</strong></td>
                    
                    <td><span className={`quote-v2-validity tone-${row.expiry.tone}`} title={text(quote.quotationValidUntil)}>{row.expiry.label}</span>{!row.eligible&&<small className="quote-v2-ineligible">{row.reason}</small>}</td>
                    <td className="quote-v2-lead">{num(quote.leadTime)} day{num(quote.leadTime)===1?'':'s'}</td>
                    
                  </tr>
                })}</tbody>
              </table>{!filteredQuotes.length&&<div className="quote-v2-empty"><Icon name="request_quote" size={24}/><strong>No quotations match</strong><span>Change supplier/status filters or add a quotation.</span></div>}
            </div></section>
            {selectedQuote && <section className="quote-v2-review-panel" aria-label="Selected quotation details">
              <header><span>Selected quotation details</span><strong>{text(selectedQuote.supplier) || 'Supplier'}</strong></header>
              <dl>
                <div><dt>Quotation reference</dt><dd>{text(selectedQuote.quotationReference) || 'Not recorded'}</dd></div>
                <div><dt>Supplier item code</dt><dd>{text(selectedQuote.supplierSku) || 'Not recorded'}</dd></div>
                <div><dt>Effective from</dt><dd>{text(selectedQuote.effectiveFrom).slice(0, 10) || 'Not recorded'}</dd></div>
                <div><dt>Valid until</dt><dd>{text(selectedQuote.quotationValidUntil).slice(0, 10) || 'Not recorded'}</dd></div>
              </dl>
              <p>Eligible quotations are ranked by normalized base-unit price within one currency. Selecting a quotation does not approve an LPO.</p>
            </section>}
        </> : <div className="quote-v2-empty quote-v2-main-empty"><Icon name="inventory_2" size={24} /><strong>Select an article</strong><span>Choose an article from the explorer to compare supplier quotations.</span></div>}
      </main>

      <aside className="quote-v2-decision">
        <section className="quote-v2-decision-card"><header><span>Decision support</span><h3>Why choose this supplier?</h3></header>{selectedQuote ? <><div className="quote-v2-choice"><span className={`quote-v2-choice-icon ${isRecommended ? 'is-best' : ''}`}><Icon name={isRecommended ? 'verified' : 'local_shipping'} size={18} /></span><div><small>{isRecommended ? 'Recommended eligible option' : selectedComparison?.eligible ? 'Selected eligible option' : 'Not eligible for recommendation'}</small><strong>{text(selectedQuote.supplier) || 'Supplier'}</strong><span>{currencyMoney(selectedQuote.price || 0, selectedCurrency)} · {text(selectedQuote.unit) || 'UOM not set'}</span></div></div><div className="quote-v2-checks"><DecisionCheck icon="payments" title="Cost position" value={!selectedComparison?.eligible ? selectedComparison?.reason || 'Not eligible' : isRecommended ? 'Lowest eligible normalized price' : priceDelta > 0 && comparisonCurrency ? `${currencyMoney(priceDelta, comparisonCurrency)} per base unit above lowest` : 'Eligible normalized quote'} tone={isRecommended ? 'good' : !selectedComparison?.eligible ? 'bad' : 'info'} /><DecisionCheck icon="verified_user" title="Supplier record" value={selectedComparison?.eligible ? 'Eligible quotation' : 'Not eligible for recommendation'} tone={selectedComparison?.eligible ? 'good' : 'bad'} /><DecisionCheck icon="event_available" title="Quotation validity" value={selectedValidity?.label || 'Not recorded'} tone={selectedValidity?.tone === 'good' ? 'good' : selectedValidity?.tone === 'bad' ? 'bad' : 'warn'} /><DecisionCheck icon="schedule" title="Lead time" value={`${num(selectedQuote.leadTime)} day${num(selectedQuote.leadTime) === 1 ? '' : 's'}`} tone="info" />{selectedValidity?.days !== null && selectedValidity?.days !== undefined && selectedValidity.days >= 0 && selectedValidity.days <= 7 && <div className="quote-v2-expiry-alert" role="status"><Icon name="warning_amber" size={17}/><span>Quotation expires {selectedValidity.days === 0 ? 'today' : `in ${selectedValidity.days} day${selectedValidity.days === 1 ? '' : 's'}`}. Verify its validity for the intended purchase date.</span></div>}<div className="quote-v2-selection-reason">{isRecommended && ranked.length>1 && ranked[1].basePrice===lowestPrice ? `Price tie resolved by lead time, then quotation validity. ${text(selectedQuote.supplier)} ranks first.` : eligibleCurrencies.size > 1 ? "Eligible quotations use different currencies. Do not compare their nominal prices without an approved exchange rate." : !recommended ? "No currently eligible quotation can be recommended." : isRecommended ? "Lowest comparable eligible base-unit price." : "This selection is shown for review; it is not the recommended quote."}</div></div></> : <div className="quote-v2-empty-small"><Icon name="info" size={19} /><strong>No supplier selected</strong><span>Select a quotation to see decision support.</span></div>}</section>
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
