import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { errorMessage, readBackendRecords } from '../lib/api'
import type { Row } from '../lib/data'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'
import '../stock-on-hand.css'

const id = (value: unknown) => String(value ?? '')
const num = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const qty = (value: unknown) => num(value).toLocaleString('en-UG', { maximumFractionDigits: 2 })

function updatedAt(value: unknown) {
  const raw = id(value)
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('en-UG', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function StockOnHand() {
  const app = useApp()
  const [balances, setBalances] = useState<Row[]>([])
  const [stores, setStores] = useState<Row[]>([])
  const [storeId, setStoreId] = useState('')
  const [query, setQuery] = useState('')
  const [articleId, setArticleId] = useState('')
  const [majorGroup, setMajorGroup] = useState('')
  const [category, setCategory] = useState('')
  const [stockState, setStockState] = useState<'all' | 'positive' | 'zero' | 'below-minimum'>('all')
  const [sortBy, setSortBy] = useState<'article' | 'store' | 'quantity' | 'value'>('article')
  const [lowOnly, setLowOnly] = useState(false)
  const [withSubStores, setWithSubStores] = useState(false)
  const [sortByStore, setSortByStore] = useState(false)
  const [useBaseUnits, setUseBaseUnits] = useState(true)
  const [evaluation, setEvaluation] = useState<'ave' | 'price' | 'epi' | 'exp'>('ave')
  const [optionsOpen, setOptionsOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Row | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [balanceResult, storeResult] = await Promise.allSettled([
        readBackendRecords('inventory-balances'),
        readBackendRecords('stores'),
      ])
      if (balanceResult.status === 'rejected') throw balanceResult.reason
      setBalances(balanceResult.value)
      if (storeResult.status === 'fulfilled') setStores(storeResult.value)
      else setStores([])
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Stock on Hand unavailable', detail)
    } finally {
      setLoading(false)
    }
  }, [app.showWorkflowAlert])

  useEffect(() => { void load() }, [load])

  const storeOptions = useMemo(() => {
    if (stores.length) return stores
    const unique = new Map<string, Row>()
    balances.forEach((row) => {
      const key = id(row.store)
      if (key && !unique.has(key)) unique.set(key, { id: key, name: id(row.store_name) || 'Store' })
    })
    return Array.from(unique.values())
  }, [balances, stores])

  const categoryOptions = useMemo(() => Array.from(new Set(
    balances.map((row) => id(row.category_name)).filter(Boolean),
  )).sort((left, right) => left.localeCompare(right)), [balances])

  const majorGroups = useMemo(
    () => app.data.categories.filter((row) => !id(row.parentId)).slice().sort((left, right) => id(left.name).localeCompare(id(right.name))),
    [app.data.categories],
  )
  const categoryToMajor = useMemo(() => {
    const map = new Map<string, string>()
    app.data.categories.forEach((row) => {
      if (!id(row.parentId)) map.set(id(row.name), id(row.name))
      else {
        const parent = app.data.categories.find((candidate) => id(candidate.id) === id(row.parentId))
        if (parent) map.set(id(row.name), id(parent.name))
      }
    })
    return map
  }, [app.data.categories])
  const itemGroups = useMemo(
    () => categoryOptions.filter((name) => !majorGroup || categoryToMajor.get(name) === majorGroup),
    [categoryOptions, categoryToMajor, majorGroup],
  )
  const articleOptions = useMemo(() => {
    const options = new Map<string, { id: string; label: string }>()
    balances.forEach((row) => {
      const key = id(row.item)
      if (!key || options.has(key)) return
      options.set(key, { id: key, label: `${id(row.item_name) || 'Article'}${row.item_sku ? ` · ${id(row.item_sku)}` : ''}` })
    })
    return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label))
  }, [balances])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = balances.filter((row) => {
      if (storeId && id(row.store) !== storeId) return false
      if (articleId && id(row.item) !== articleId) return false
      if (majorGroup && categoryToMajor.get(id(row.category_name)) !== majorGroup) return false
      if (category && id(row.category_name) !== category) return false
      if (lowOnly && !Boolean(row.is_below_reorder)) return false
      if (stockState === 'positive' && num(row.quantity_in_stock) <= 0) return false
      if (stockState === 'zero' && num(row.quantity_in_stock) !== 0) return false
      if (stockState === 'below-minimum' && !Boolean(row.is_below_reorder)) return false
      if (!needle) return true
      return [row.item_name, row.item_sku, row.category_name, row.store_name, row.base_unit_name]
        .some((value) => id(value).toLowerCase().includes(needle))
    })
    return filtered.sort((left, right) => {
      if (sortBy === 'quantity') return num(left.quantity_in_stock) - num(right.quantity_in_stock)
      if (sortBy === 'value') return num(right.total_value) - num(left.total_value)
      if (sortBy === 'store') return id(left.store_name).localeCompare(id(right.store_name)) || id(left.item_name).localeCompare(id(right.item_name))
      return id(left.item_name).localeCompare(id(right.item_name)) || id(left.store_name).localeCompare(id(right.store_name))
    })
  }, [balances, storeId, articleId, majorGroup, category, categoryToMajor, query, lowOnly, stockState, sortBy])

  const inventoryValue = visible.reduce((total, row) => total + num(row.total_value), 0)
  const availableValue = visible.reduce((total, row) => total + num(row.available_value), 0)
  const lowCount = visible.filter((row) => Boolean(row.is_below_reorder)).length
  const stockedCount = visible.filter((row) => num(row.quantity_in_stock) > 0).length
  const selectedStore = storeOptions.find((store) => id(store.id) === storeId)
  const articleUnit = (row: Row) => {
    if (useBaseUnits) return null
    return app.data.itemUnits.find((unit) => id(unit.itemId) === id(row.item) && num(unit.conversionFactor) > 1 && ['Issue unit', 'Alternate unit', 'Purchase unit'].includes(id(unit.role))) || null
  }
  const displayQuantity = (row: Row, value: unknown) => {
    const unit = articleUnit(row)
    return qty(num(value) / (unit ? num(unit.conversionFactor) : 1))
  }
  const displayUnit = (row: Row) => id(articleUnit(row)?.unit) || id(row.base_unit_name) || '—'

  return <div className="soh-page">
    <header className="soh-header">
      <div className="soh-title-wrap">
        <span className="soh-title-icon"><Icon name="inventory_2" size={22} /></span>
        <div>
          <div className="soh-eyebrow">Inventory control</div>
          <h1>Stock on Hand</h1>
          <p>Live posted inventory by store. Filter the stock position the same way Stores controls Stock on Hand.</p>
        </div>
      </div>
      <button className="soh-refresh" type="button" onClick={() => void load()} disabled={loading}>
        <Icon name="refresh" size={16} />{loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </header>

    {error && <div className="soh-error"><Icon name="error" size={17} />{error}</div>}

    <section className="soh-kpis" aria-label="Stock summary">
      <Kpi label="Inventory value" value={money(inventoryValue)} detail={selectedStore ? id(selectedStore.name) : 'All visible stores'} />
      <Kpi label="Available value" value={money(availableValue)} detail="Excludes reserved stock" />
      <Kpi label="Stocked Articles" value={String(stockedCount)} detail={`${visible.length} balance record${visible.length === 1 ? '' : 's'}`} />
      <Kpi label="Low / reorder" value={String(lowCount)} detail="Needs Store Keeper attention" warn={lowCount > 0} />
    </section>

    <section className="soh-options" aria-label="Stock on Hand Control options">
      <button type="button" className="soh-options-title" onClick={() => setOptionsOpen((value) => !value)} aria-expanded={optionsOpen}>
        <span><Icon name="tune" size={17} /><strong>Option: SOH Control</strong><small>Cost Center / Store, Article and stock position criteria</small></span>
        <Icon name={optionsOpen ? 'expand_less' : 'expand_more'} size={18} />
      </button>
      {optionsOpen && <div className="soh-option-grid">
        <div className="soh-option-fields">
          <label>Cost Center / Store<select value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="">All assigned stores</option>{storeOptions.map((store) => <option key={id(store.id)} value={id(store.id)}>{id(store.name)}</option>)}</select></label>
          <div className="soh-option-checks"><label><input type="checkbox" checked={withSubStores} onChange={(event) => setWithSubStores(event.target.checked)} />With Sub Cost Centers</label><label><input type="checkbox" checked={sortByStore} onChange={(event) => { setSortByStore(event.target.checked); setSortBy(event.target.checked ? 'store' : 'article') }} />Sort by Cost Center / Store</label></div>
          <label>Over Group<select value={majorGroup} onChange={(event) => { setMajorGroup(event.target.value); setCategory('') }}><option value="">All Over Groups</option>{majorGroups.map((group) => <option key={id(group.id)} value={id(group.name)}>{id(group.name)}</option>)}</select></label>
          <label>Major Group<select value={majorGroup} onChange={(event) => { setMajorGroup(event.target.value); setCategory('') }}><option value="">All Major Groups</option>{majorGroups.map((group) => <option key={id(group.id)} value={id(group.name)}>{id(group.name)}</option>)}</select></label>
          <label>Item Group<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All Item Groups</option>{itemGroups.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <label>Article<select value={articleId} onChange={(event) => setArticleId(event.target.value)}><option value="">All Articles</option>{articleOptions.map((article) => <option key={article.id} value={article.id}>{article.label}</option>)}</select></label>
          <label>Storage Location<select value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="">All Storage Locations</option>{storeOptions.map((store) => <option key={id(store.id)} value={id(store.id)}>{id(store.name)}</option>)}</select></label>
        </div>
        <div className="soh-option-sets">
          <fieldset><legend>Show</legend><label><input type="radio" checked readOnly />Articles</label><label className="disabled"><input type="radio" disabled />Deposits</label></fieldset>
          <fieldset><legend>Use</legend><label><input type="radio" checked={useBaseUnits} onChange={() => setUseBaseUnits(true)} />Base Units</label><label><input type="radio" checked={!useBaseUnits} onChange={() => setUseBaseUnits(false)} />Units</label></fieldset>
          <fieldset className="soh-filter-set"><legend>Filter</legend><label><input type="checkbox" checked={stockState === 'positive'} onChange={(event) => setStockState(event.target.checked ? 'positive' : 'all')} />SOH &gt; 0</label><label><input type="checkbox" checked={stockState === 'zero'} onChange={(event) => setStockState(event.target.checked ? 'zero' : 'all')} />SOH = 0</label><label><input type="checkbox" checked={lowOnly || stockState === 'below-minimum'} onChange={(event) => { setLowOnly(event.target.checked); if (!event.target.checked && stockState === 'below-minimum') setStockState('all') }} />SOH &lt; MIN</label><label><input type="checkbox" checked={stockState === 'below-minimum'} onChange={(event) => setStockState(event.target.checked ? 'below-minimum' : 'all')} />SOH &lt; OPT</label><label className="disabled"><input type="checkbox" disabled />Only closed Articles</label><label><input type="checkbox" checked={Boolean(storeId)} onChange={(event) => { if (!event.target.checked) setStoreId('') }} />Articles with Storage Loc.</label></fieldset>
          <fieldset><legend>Sorted by</legend><label><input type="radio" checked={sortBy === 'article'} onChange={() => setSortBy('article')} />Article</label><label><input type="radio" checked={sortBy === 'store'} onChange={() => setSortBy('store')} />Storage Location</label><label><input type="radio" checked={sortBy === 'quantity'} onChange={() => setSortBy('quantity')} />Lowest SOH</label><label><input type="radio" checked={sortBy === 'value'} onChange={() => setSortBy('value')} />Stock Value</label></fieldset>
          <fieldset><legend>Evaluation by</legend><label><input type="radio" checked={evaluation === 'ave'} onChange={() => setEvaluation('ave')} />AVE</label><label><input type="radio" checked={evaluation === 'price'} onChange={() => setEvaluation('price')} />Price</label><label><input type="radio" checked={evaluation === 'epi'} onChange={() => setEvaluation('epi')} />EPI</label><label><input type="radio" checked={evaluation === 'exp'} onChange={() => setEvaluation('exp')} />Exp.</label></fieldset>
        </div>
        <footer className="soh-option-footer"><span>{withSubStores ? 'Assigned stores are included in this control.' : 'Live results only include stores assigned to your account.'}</span><button type="button" onClick={() => setOptionsOpen(false)}>Apply</button></footer>
      </div>}
    </section>

    <section className="soh-panel">
      <div className="soh-toolbar">
        <div className="soh-search">
          <Icon name="search" size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Article, SKU, category or store…" />
        </div>
        <select className="soh-store-select" value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          <option value="">All stores</option>
          {storeOptions.map((store) => <option key={id(store.id)} value={id(store.id)}>{id(store.name)}</option>)}
        </select>
        <select className="soh-store-select" aria-label="Filter by item group" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All item groups</option>
          {categoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="soh-store-select" aria-label="Filter by stock position" value={stockState} onChange={(event) => setStockState(event.target.value as typeof stockState)}>
          <option value="all">All stock positions</option>
          <option value="positive">SOH &gt; 0</option>
          <option value="zero">SOH = 0</option>
          <option value="below-minimum">SOH at / below minimum</option>
        </select>
        <button className={`soh-filter ${lowOnly ? 'active' : ''}`} type="button" onClick={() => setLowOnly((value) => !value)}>
          <Icon name="warning" size={16} />Low stock only
        </button>
        <select className="soh-store-select soh-sort-select" aria-label="Sort stock results" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
          <option value="article">Sort: Article</option>
          <option value="store">Sort: Store</option>
          <option value="quantity">Sort: Lowest SOH</option>
          <option value="value">Sort: Highest value</option>
        </select>
      </div>

      <div className="soh-store-tabs" aria-label="Store filter">
        <button className={!storeId ? 'active' : ''} onClick={() => setStoreId('')}>All stores</button>
        {storeOptions.map((store) => <button key={id(store.id)} className={storeId === id(store.id) ? 'active' : ''} onClick={() => setStoreId(id(store.id))}>{id(store.name)}</button>)}
      </div>

      {loading ? <Empty icon="progress_activity" title="Loading stock balances" text="Reading posted inventory from Stores…" />
        : !visible.length ? <Empty icon="inventory_2" title="No stock balances found" text="Try another store or filter. Newly received goods appear after the GRN is posted to inventory." />
          : <>
            <div className="soh-table-wrap">
              <table className="soh-table">
                <thead><tr>
                  <th>Article</th><th>Store</th><th className="num">SOH</th><th className="num">Reserved</th><th className="num">Available</th><th>UOM</th><th className="num">Amount / unit</th><th className="num">{evaluation === 'exp' ? 'Expiry value' : evaluation === 'epi' ? 'EPI value' : evaluation === 'price' ? 'Price value' : 'AVE value'}</th><th>Status</th>
                </tr></thead>
                <tbody>{visible.map((row) => <tr key={id(row.id)} onClick={() => setSelected(row)}>
                  <td><strong>{id(row.item_name) || 'Article'}</strong><span>{id(row.item_sku) || '—'}{row.category_name ? ` · ${id(row.category_name)}` : ''}</span></td>
                  <td><strong>{id(row.store_name) || 'Store'}</strong><span>{id(row.branch_name)}</span></td>
                  <td className="num strong">{displayQuantity(row, row.quantity_in_stock)}</td>
                  <td className="num">{displayQuantity(row, row.quantity_reserved)}</td>
                  <td className="num strong">{displayQuantity(row, row.available_quantity)}</td>
                  <td>{displayUnit(row)}</td>
                  <td className="num">{money(num(row.unit_amount))}</td>
                  <td className="num value">{money(num(row.total_value))}</td>
                  <td><StockStatus row={row} /></td>
                </tr>)}</tbody>
                <tfoot><tr><td colSpan={7}>Total value of displayed Stock on Hand</td><td className="num">{money(inventoryValue)}</td><td /></tr></tfoot>
              </table>
            </div>

            <div className="soh-mobile-list">{visible.map((row) => <button className="soh-mobile-card" key={id(row.id)} onClick={() => setSelected(row)}>
              <div className="soh-mobile-head"><div><strong>{id(row.item_name) || 'Article'}</strong><span>{id(row.item_sku)} · {id(row.store_name)}</span></div><StockStatus row={row} /></div>
              <div className="soh-mobile-metrics"><Metric label="SOH" value={`${displayQuantity(row, row.quantity_in_stock)} ${displayUnit(row)}`} /><Metric label="Available" value={displayQuantity(row, row.available_quantity)} /><Metric label="Amount / unit" value={money(num(row.unit_amount))} /><Metric label="Total" value={money(num(row.total_value))} /></div>
            </button>)}</div>
          </>}
    </section>

    {selected && <><button className="soh-drawer-backdrop" aria-label="Close stock details" onClick={() => setSelected(null)} /><aside className="soh-drawer">
      <div className="soh-drawer-head"><div><span>Stock balance</span><h2>{id(selected.item_name)}</h2><p>{id(selected.item_sku)} · {id(selected.store_name)}</p></div><button onClick={() => setSelected(null)} aria-label="Close"><Icon name="close" size={18} /></button></div>
      <div className="soh-drawer-grid">
        <Detail label="Stock on Hand" value={`${displayQuantity(selected, selected.quantity_in_stock)} ${displayUnit(selected)}`} />
        <Detail label="Reserved" value={displayQuantity(selected, selected.quantity_reserved)} />
        <Detail label="Available" value={displayQuantity(selected, selected.available_quantity)} />
        <Detail label="Amount / unit" value={money(num(selected.unit_amount))} />
        <Detail label="Total stock value" value={money(num(selected.total_value))} strong />
        <Detail label="Available value" value={money(num(selected.available_value))} />
        <Detail label="Reorder level" value={qty(selected.reorder_level)} />
        <Detail label="Last received" value={id(selected.last_received_date) || '—'} />
        <Detail label="Last balance update" value={updatedAt(selected.last_updated)} />
        <Detail label="Cost basis" value="Weighted current GRN batch cost" />
      </div>
      <div className="soh-drawer-note"><Icon name="info" size={16} /><span>Amount / unit is the weighted cost of the remaining received batches. Total value = current SOH × amount / unit.</span></div>
    </aside></>}
  </div>
}

function Kpi({ label, value, detail, warn = false }: { label: string; value: string; detail: string; warn?: boolean }) {
  return <div className={`soh-kpi ${warn ? 'warn' : ''}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}
function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function Detail({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div><span>{label}</span><strong className={strong ? 'accent' : ''}>{value}</strong></div> }
function StockStatus({ row }: { row: Row }) {
  const zero = num(row.quantity_in_stock) <= 0
  const low = Boolean(row.is_below_reorder)
  return <span className={`soh-status ${zero ? 'zero' : low ? 'low' : 'good'}`}>{zero ? 'Out of stock' : low ? 'Low stock' : 'In stock'}</span>
}
function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="soh-empty"><span><Icon name={icon} size={22} /></span><strong>{title}</strong><p>{text}</p></div>
}
