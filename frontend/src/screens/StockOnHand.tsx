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
  const [lowOnly, setLowOnly] = useState(false)
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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return balances.filter((row) => {
      if (storeId && id(row.store) !== storeId) return false
      if (lowOnly && !Boolean(row.is_below_reorder) && num(row.quantity_in_stock) > 0) return false
      if (!needle) return true
      return [row.item_name, row.item_sku, row.category_name, row.store_name, row.base_unit_name]
        .some((value) => id(value).toLowerCase().includes(needle))
    })
  }, [balances, storeId, query, lowOnly])

  const inventoryValue = visible.reduce((total, row) => total + num(row.total_value), 0)
  const availableValue = visible.reduce((total, row) => total + num(row.available_value), 0)
  const lowCount = visible.filter((row) => Boolean(row.is_below_reorder)).length
  const stockedCount = visible.filter((row) => num(row.quantity_in_stock) > 0).length
  const selectedStore = storeOptions.find((store) => id(store.id) === storeId)

  return <div className="soh-page">
    <header className="soh-header">
      <div className="soh-title-wrap">
        <span className="soh-title-icon"><Icon name="inventory_2" size={22} /></span>
        <div>
          <div className="soh-eyebrow">Inventory control</div>
          <h1>Stock on Hand</h1>
          <p>Live posted inventory by store. GRN receipts appear here after inventory posting.</p>
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
        <button className={`soh-filter ${lowOnly ? 'active' : ''}`} type="button" onClick={() => setLowOnly((value) => !value)}>
          <Icon name="warning" size={16} />Low stock only
        </button>
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
                  <th>Article</th><th>Store</th><th className="num">SOH</th><th className="num">Reserved</th><th className="num">Available</th><th>UOM</th><th className="num">Amount / unit</th><th className="num">Total value</th><th>Status</th>
                </tr></thead>
                <tbody>{visible.map((row) => <tr key={id(row.id)} onClick={() => setSelected(row)}>
                  <td><strong>{id(row.item_name) || 'Article'}</strong><span>{id(row.item_sku) || '—'}{row.category_name ? ` · ${id(row.category_name)}` : ''}</span></td>
                  <td><strong>{id(row.store_name) || 'Store'}</strong><span>{id(row.branch_name)}</span></td>
                  <td className="num strong">{qty(row.quantity_in_stock)}</td>
                  <td className="num">{qty(row.quantity_reserved)}</td>
                  <td className="num strong">{qty(row.available_quantity)}</td>
                  <td>{id(row.base_unit_name) || '—'}</td>
                  <td className="num">{money(num(row.unit_amount))}</td>
                  <td className="num value">{money(num(row.total_value))}</td>
                  <td><StockStatus row={row} /></td>
                </tr>)}</tbody>
                <tfoot><tr><td colSpan={7}>Total value of displayed Stock on Hand</td><td className="num">{money(inventoryValue)}</td><td /></tr></tfoot>
              </table>
            </div>

            <div className="soh-mobile-list">{visible.map((row) => <button className="soh-mobile-card" key={id(row.id)} onClick={() => setSelected(row)}>
              <div className="soh-mobile-head"><div><strong>{id(row.item_name) || 'Article'}</strong><span>{id(row.item_sku)} · {id(row.store_name)}</span></div><StockStatus row={row} /></div>
              <div className="soh-mobile-metrics"><Metric label="SOH" value={`${qty(row.quantity_in_stock)} ${id(row.base_unit_name)}`} /><Metric label="Available" value={qty(row.available_quantity)} /><Metric label="Amount / unit" value={money(num(row.unit_amount))} /><Metric label="Total" value={money(num(row.total_value))} /></div>
            </button>)}</div>
          </>}
    </section>

    {selected && <><button className="soh-drawer-backdrop" aria-label="Close stock details" onClick={() => setSelected(null)} /><aside className="soh-drawer">
      <div className="soh-drawer-head"><div><span>Stock balance</span><h2>{id(selected.item_name)}</h2><p>{id(selected.item_sku)} · {id(selected.store_name)}</p></div><button onClick={() => setSelected(null)} aria-label="Close"><Icon name="close" size={18} /></button></div>
      <div className="soh-drawer-grid">
        <Detail label="Stock on Hand" value={`${qty(selected.quantity_in_stock)} ${id(selected.base_unit_name)}`} />
        <Detail label="Reserved" value={qty(selected.quantity_reserved)} />
        <Detail label="Available" value={qty(selected.available_quantity)} />
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
