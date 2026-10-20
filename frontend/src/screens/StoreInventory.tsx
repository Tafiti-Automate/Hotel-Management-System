import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { createBackendRecord, errorMessage, readBackendRecords, runBackendAction, updateBackendRecord } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'
import '../store-inventory.css'

type InventoryTab = 'overview' | 'gather' | 'groups' | 'locations' | 'history' | 'lists' | 'receipts'

const id = (value: unknown) => String(value ?? '')
const number = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const quantity = (value: unknown) => number(value).toLocaleString('en-UG', { maximumFractionDigits: 2 })
const label = (value: unknown) => id(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Draft'

function time(value: unknown) {
  const raw = id(value)
  if (!raw) return '—'
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })
}

function date(value: unknown) {
  const raw = id(value)
  if (!raw) return '—'
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('en-UG', { day: '2-digit', month: 'short', year: 'numeric' })
}

const tabs: Array<[InventoryTab, string, string]> = [
  ['overview', 'view_list', 'Overview'],
  ['gather', 'inventory', 'Gather Inventory'],
  ['groups', 'account_tree', 'Item Groups'],
  ['locations', 'warehouse', 'Storage Locations'],
  ['history', 'history', 'Inventory History'],
  ['lists', 'format_list_numbered', 'Stock Taking Lists'],
  ['receipts', 'fact_check', 'Counted Receipts'],
]

export default function StoreInventory() {
  const app = useApp()
  const [tab, setTab] = useState<InventoryTab>('overview')
  const [counts, setCounts] = useState<Row[]>([])
  const [countItems, setCountItems] = useState<Row[]>([])
  const [stores, setStores] = useState<Row[]>([])
  const [balances, setBalances] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [newStore, setNewStore] = useState('')
  const [newNote, setNewNote] = useState('')
  const [physical, setPhysical] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [countResult, itemResult, storeResult, balanceResult] = await Promise.allSettled([
        readBackendRecords('stock-counts'),
        readBackendRecords('stock-count-items'),
        readBackendRecords('stores'),
        readBackendRecords('inventory-balances'),
      ])
      if (countResult.status === 'rejected') throw countResult.reason
      if (itemResult.status === 'rejected') throw itemResult.reason
      setCounts(countResult.value)
      setCountItems(itemResult.value)
      setStores(storeResult.status === 'fulfilled' ? storeResult.value : [])
      setBalances(balanceResult.status === 'fulfilled' ? balanceResult.value : [])
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Manage Inventory unavailable', detail)
    } finally {
      setLoading(false)
    }
  }, [app.showWorkflowAlert])

  useEffect(() => { void load() }, [load])

  const orderedCounts = useMemo(
    () => counts.slice().sort((left, right) => id(right.created_at).localeCompare(id(left.created_at))),
    [counts],
  )
  const selected = orderedCounts.find((count) => id(count.id) === selectedId) || orderedCounts[0] || null
  const selectedItems = useMemo(
    () => selected ? countItems.filter((line) => id(line.stock_count) === id(selected.id)) : [],
    [countItems, selected],
  )
  const storeById = useMemo(() => new Map(stores.map((store) => [id(store.id), store])), [stores])
  const currentStore = selected ? storeById.get(id(selected.store)) : undefined
  const categoryRows = useMemo(() => app.data.categories.slice().sort((left, right) => id(left.name).localeCompare(id(right.name))), [app.data.categories])
  const itemById = useMemo(() => new Map(app.data.items.map((item) => [id(item.id), item])), [app.data.items])
  const countableBalanceTotal = selected ? balances.filter((row) => id(row.store) === id(selected.store)).length : 0
  const varianceLines = selectedItems.filter((line) => number(line.physical_quantity) !== number(line.system_quantity))

  useEffect(() => {
    if (!selected) return
    const values: Record<string, string> = {}
    selectedItems.forEach((line) => { values[id(line.id)] = id(line.physical_quantity) })
    setPhysical(values)
  }, [selected?.id, selectedItems.length])

  const execute = async (operation: () => Promise<unknown>, success: string) => {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      await operation()
      await load()
      await app.refreshData()
      app.showToast(success)
      return true
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Inventory action could not be completed', detail)
      return false
    } finally {
      setBusy(false)
    }
  }

  const createCount = async () => {
    if (!newStore) {
      app.showWorkflowAlert('Choose a store', 'Select the Cost Center / Store for this inventory session.', 'warning')
      return
    }
    const saved = await execute(
      () => createBackendRecord('stock-counts', { store: newStore, note: newNote.trim() }),
      'Inventory session opened',
    )
    if (saved) {
      setNewNote('')
      setTab('gather')
    }
  }

  const savePhysical = async () => {
    const changed = selectedItems.filter((line) => id(physical[id(line.id)]) !== id(line.physical_quantity))
    if (!changed.length) {
      app.showToast('No counted quantities changed')
      return
    }
    await execute(
      () => Promise.all(changed.map((line) => updateBackendRecord('stock-count-items', id(line.id), {
        physical_quantity: number(physical[id(line.id)]),
      }))),
      `${changed.length} counted receipt${changed.length === 1 ? '' : 's'} saved`,
    )
  }

  const printList = (count: Row) => {
    const lines = countItems.filter((line) => id(line.stock_count) === id(count.id))
    const escape = (value: unknown) => id(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const popup = window.open('', '_blank', 'width=960,height=720')
    if (!popup) {
      app.showWorkflowAlert('Print blocked', 'Allow pop-ups for this site, then print the stock-taking list again.', 'warning')
      return
    }
    const store = storeById.get(id(count.store))
    popup.document.write(`<html><head><title>${escape(count.count_no)} Stock Taking List</title><style>@page{size:A4;margin:16mm}body{font:12px Arial;color:#0f172a}header{display:flex;justify-content:space-between;border-bottom:2px solid #1d4ed8;padding-bottom:12px}h1{margin:0;font-size:20px}p{margin:4px 0;color:#475569}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left}th{background:#eff6ff;font-size:10px;text-transform:uppercase}.write{height:31px}.signatures{display:flex;justify-content:space-between;gap:24px;margin-top:54px}.signatures span{width:31%;border-top:1px solid #334155;padding-top:7px}</style></head><body><header><div><h1>Stock Taking List</h1><p>${escape(count.count_no)} · ${escape(store?.name || 'Store')} · ${escape(date(count.count_date))}</p></div><p>Prepared ${escape(date(count.created_at))} ${escape(time(count.created_at))}</p></header><table><thead><tr><th>#</th><th>Article</th><th>System Qty</th><th>Physical Qty</th><th>Count note</th></tr></thead><tbody>${lines.map((line, index) => `<tr><td>${index + 1}</td><td>${escape(itemById.get(id(line.item))?.name || line.item_name || 'Article')}</td><td>${escape(quantity(line.system_quantity))}</td><td class="write"></td><td class="write"></td></tr>`).join('') || '<tr><td colspan="5">Populate this session before printing its count sheet.</td></tr>'}</tbody></table><div class="signatures"><span>Counted by</span><span>Checked by</span><span>Store Keeper</span></div><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }

  return <div className="store-inventory-page" aria-busy={loading}>
    <header className="store-inventory-header">
      <div className="store-inventory-title"><span><Icon name="fact_check" size={22} /></span><div><small>Store Keeper</small><h1>Manage Inventory</h1><p>Inventory sessions, counted receipts and controlled stock variance posting.</p></div></div>
      <button type="button" className="store-inventory-refresh" disabled={loading || busy} onClick={() => void load()}><Icon name="refresh" size={16} />{loading ? 'Refreshing…' : 'Refresh'}</button>
    </header>

    {error && <div className="store-inventory-error" role="alert"><Icon name="error" size={17} />{error}</div>}

    <nav className="store-inventory-tabs" aria-label="Manage Inventory">
      {tabs.map(([key, icon, title]) => <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon name={icon} size={16} />{title}</button>)}
    </nav>

    {loading ? <Empty icon="progress_activity" title="Loading inventory sessions" text="Reading inventory sessions and counted receipts from Stores…" /> : <>
      {tab === 'overview' && <Overview counts={orderedCounts} stores={storeById} select={(count) => { setSelectedId(id(count.id)); setTab('gather') }} />}
      {tab === 'gather' && <Gather
        counts={orderedCounts}
        stores={stores}
        selected={selected}
        items={selectedItems}
        currentStore={currentStore}
        countableBalanceTotal={countableBalanceTotal}
        physical={physical}
        busy={busy}
        newStore={newStore}
        newNote={newNote}
        setNewStore={setNewStore}
        setNewNote={setNewNote}
        setSelectedId={setSelectedId}
        setPhysical={setPhysical}
        createCount={createCount}
        savePhysical={savePhysical}
        action={(action, success) => selected && void execute(() => runBackendAction('stock-counts', id(selected.id), action), success)}
      />}
      {tab === 'groups' && <ItemGroups rows={categoryRows} />}
      {tab === 'locations' && <Locations rows={stores} branches={app.data.branches} balances={balances} />}
      {tab === 'history' && <History counts={orderedCounts} stores={storeById} select={(count) => { setSelectedId(id(count.id)); setTab('receipts') }} />}
      {tab === 'lists' && <TakingLists counts={orderedCounts} stores={storeById} items={countItems} print={printList} select={(count) => { setSelectedId(id(count.id)); setTab('gather') }} />}
      {tab === 'receipts' && <Receipts selected={selected} lines={selectedItems} itemById={itemById} varianceLines={varianceLines} select={(count) => { setSelectedId(id(count.id)); setTab('gather') }} counts={orderedCounts} />}
    </>}
  </div>
}

function Overview({ counts, stores, select }: { counts: Row[]; stores: Map<string, Row>; select: (count: Row) => void }) {
  return <section className="store-inventory-card"><div className="store-inventory-section-head"><div><small>Inventory</small><h2>Inventory overview</h2><p>Every stock count is a dated, auditable session.</p></div><span>{counts.length} session{counts.length === 1 ? '' : 's'}</span></div><div className="store-inventory-table-wrap"><table className="store-inventory-table"><thead><tr><th>Inventory</th><th>Cost Center / Store</th><th>Date</th><th>Time</th><th>Info</th><th>Inventory Type</th><th>Status</th></tr></thead><tbody>{counts.map((count) => <tr key={id(count.id)} onClick={() => select(count)}><td><strong>{id(count.count_no)}</strong></td><td>{id(stores.get(id(count.store))?.name) || 'Assigned store'}</td><td>{date(count.count_date)}</td><td>{time(count.created_at)}</td><td>{id(count.note) || '—'}</td><td>Full stock take</td><td><Status value={count.status} /></td></tr>)}</tbody></table></div>{!counts.length && <Empty icon="inventory" title="No inventory session yet" text="Open a stock-taking session from Gather Inventory." />}</section>
}

function Gather({ counts, stores, selected, items, currentStore, countableBalanceTotal, physical, busy, newStore, newNote, setNewStore, setNewNote, setSelectedId, setPhysical, createCount, savePhysical, action }: {
  counts: Row[]; stores: Row[]; selected: Row | null; items: Row[]; currentStore?: Row; countableBalanceTotal: number; physical: Record<string, string>; busy: boolean; newStore: string; newNote: string; setNewStore: (value: string) => void; setNewNote: (value: string) => void; setSelectedId: (value: string) => void; setPhysical: (value: Record<string, string>) => void; createCount: () => Promise<void>; savePhysical: () => Promise<void>; action: (action: string, success: string) => void
}) {
  return <div className="store-inventory-gather-grid"><section className="store-inventory-card store-inventory-new"><div className="store-inventory-section-head"><div><small>New Inventory</small><h2>Gather Inventory</h2><p>Create a new store inventory session. Its date and time are system-recorded.</p></div></div><label>Cost Center / Store<select value={newStore} onChange={(event) => setNewStore(event.target.value)}><option value="">Choose assigned store</option>{stores.map((store) => <option key={id(store.id)} value={id(store.id)}>{id(store.name)}</option>)}</select></label><label>Info / count note<textarea value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="e.g. October month-end count" /></label><button type="button" className="store-inventory-primary" disabled={busy || !newStore} onClick={() => void createCount()}><Icon name="add" size={16} />Open Inventory</button><div className="store-inventory-session-list"><small>Recent sessions</small>{counts.slice(0, 8).map((count) => <button type="button" key={id(count.id)} className={id(selected?.id) === id(count.id) ? 'active' : ''} onClick={() => setSelectedId(id(count.id))}><span><strong>{id(count.count_no)}</strong><em>{date(count.count_date)}</em></span><Status value={count.status} /></button>)}</div></section>
    <section className="store-inventory-card store-inventory-count-sheet">{!selected ? <Empty icon="format_list_numbered" title="Select an inventory session" text="Choose an existing session or open a new one to gather physical quantities." /> : <><div className="store-inventory-section-head"><div><small>Counted Receipts</small><h2>{id(selected.count_no)}</h2><p>{id(currentStore?.name) || 'Assigned store'} · {date(selected.count_date)} · {id(selected.note) || 'No count note'}</p></div><Status value={selected.status} /></div><div className="store-inventory-count-actions"><span>{items.length ? `${items.length} Article${items.length === 1 ? '' : 's'} on the count sheet` : `${countableBalanceTotal} balance record${countableBalanceTotal === 1 ? '' : 's'} ready to populate`}</span>{!items.length && ['draft', 'in_progress'].includes(id(selected.status)) && <button type="button" className="store-inventory-secondary" disabled={busy} onClick={() => action('populate', 'Count sheet populated from live stock')}><Icon name="playlist_add" size={16} />Populate Count Sheet</button>}</div>{items.length > 0 && <><div className="store-inventory-table-wrap"><table className="store-inventory-table store-inventory-count-table"><thead><tr><th>Article</th><th>System Qty</th><th>Physical Qty</th><th>Variance</th></tr></thead><tbody>{items.map((line) => { const variance = number(physical[id(line.id)]) - number(line.system_quantity); return <tr key={id(line.id)}><td><strong>{id(line.item_name) || id(line.item)}</strong><small>{id(line.item_sku)}</small></td><td>{quantity(line.system_quantity)}</td><td><input aria-label={`Physical quantity for ${id(line.item_name) || id(line.item)}`} type="number" min="0" step="0.01" disabled={!['draft', 'in_progress'].includes(id(selected.status))} value={physical[id(line.id)] ?? ''} onChange={(event) => setPhysical({ ...physical, [id(line.id)]: event.target.value })} /></td><td className={variance === 0 ? '' : variance < 0 ? 'variance-negative' : 'variance-positive'}>{variance > 0 ? '+' : ''}{quantity(variance)}</td></tr> })}</tbody></table></div><footer className="store-inventory-flow-actions">{['draft', 'in_progress'].includes(id(selected.status)) && <><button type="button" className="store-inventory-secondary" disabled={busy} onClick={() => void savePhysical()}><Icon name="save" size={16} />Save Counted Receipts</button><button type="button" className="store-inventory-primary" disabled={busy} onClick={() => action('submit', 'Inventory submitted for approval')}><Icon name="send" size={16} />Submit Inventory</button></>}{id(selected.status) === 'submitted' && <button type="button" className="store-inventory-primary" disabled={busy} onClick={() => action('approve', 'Inventory approved')}><Icon name="approval" size={16} />Approve Inventory</button>}{id(selected.status) === 'approved' && <button type="button" className="store-inventory-primary" disabled={busy} onClick={() => action('apply', 'Approved inventory variances posted')}><Icon name="published_with_changes" size={16} />Apply Variances</button>}</footer></>}</>}</section></div>
}

function ItemGroups({ rows }: { rows: Row[] }) {
  const majorGroups = rows.filter((row) => !id(row.parentId))
  return <section className="store-inventory-card"><div className="store-inventory-section-head"><div><small>Catalogue</small><h2>Item Groups</h2><p>Major Group → Item Group classification used when gathering and analysing inventory.</p></div></div><div className="store-inventory-groups">{majorGroups.map((major) => <article key={id(major.id)}><header><Icon name="folder" size={17} /><strong>{id(major.name)}</strong><span>Major Group</span></header><div>{rows.filter((row) => id(row.parentId) === id(major.id)).map((group) => <p key={id(group.id)}><Icon name="subdirectory_arrow_right" size={15} /><span>{id(group.name)}</span><small>{number(group.itemsCount)} article{number(group.itemsCount) === 1 ? '' : 's'}</small></p>)}{!rows.some((row) => id(row.parentId) === id(major.id)) && <p className="empty">No Item Groups configured.</p>}</div></article>)}</div>{!rows.length && <Empty icon="account_tree" title="No item groups visible" text="Item Groups are maintained in the catalogue and appear here when available to the Store Keeper." />}</section>
}

function Locations({ rows, branches, balances }: { rows: Row[]; branches: Row[]; balances: Row[] }) {
  return <section className="store-inventory-card"><div className="store-inventory-section-head"><div><small>Store Setup</small><h2>Storage Locations</h2><p>Assigned store locations used for stock balances and inventory sessions.</p></div></div><div className="store-inventory-table-wrap"><table className="store-inventory-table"><thead><tr><th>Storage Location</th><th>Cost Center / Branch</th><th>Address</th><th>Articles Stored</th><th>Status</th></tr></thead><tbody>{rows.map((store) => <tr key={id(store.id)}><td><strong>{id(store.name)}</strong>{store.is_default && <small>Default issuing store</small>}</td><td>{id(branches.find((branch) => id(branch.id) === id(store.branch))?.name) || '—'}</td><td>{id(store.address) || '—'}</td><td>{balances.filter((balance) => id(balance.store) === id(store.id)).length}</td><td><Status value={store.is_active === false ? 'inactive' : 'active'} /></td></tr>)}</tbody></table></div>{!rows.length && <Empty icon="warehouse" title="No assigned storage locations" text="A Store Keeper only sees the locations explicitly assigned to their account." />}</section>
}

function History({ counts, stores, select }: { counts: Row[]; stores: Map<string, Row>; select: (count: Row) => void }) {
  const history = counts.filter((count) => ['submitted', 'approved', 'applied', 'cancelled'].includes(id(count.status)))
  return <section className="store-inventory-card"><div className="store-inventory-section-head"><div><small>Inventory History</small><h2>Completed and submitted stock counts</h2><p>Open a historic count to review its captured receipt quantities and variance status.</p></div></div><div className="store-inventory-table-wrap"><table className="store-inventory-table"><thead><tr><th>Inventory</th><th>Store</th><th>Count Date</th><th>Recorded</th><th>Info</th><th>Status</th></tr></thead><tbody>{history.map((count) => <tr key={id(count.id)} onClick={() => select(count)}><td><strong>{id(count.count_no)}</strong></td><td>{id(stores.get(id(count.store))?.name)}</td><td>{date(count.count_date)}</td><td>{date(count.created_at)} {time(count.created_at)}</td><td>{id(count.note) || '—'}</td><td><Status value={count.status} /></td></tr>)}</tbody></table></div>{!history.length && <Empty icon="history" title="No completed inventory history" text="Submitted and applied inventory sessions will appear here." />}</section>
}

function TakingLists({ counts, stores, items, print, select }: { counts: Row[]; stores: Map<string, Row>; items: Row[]; print: (count: Row) => void; select: (count: Row) => void }) {
  return <section className="store-inventory-card"><div className="store-inventory-section-head"><div><small>Stock Taking Lists</small><h2>Printable stock count sheets</h2><p>Print a blank count sheet for a populated inventory session, then record the physical results in Gather Inventory.</p></div></div><div className="store-inventory-list-grid">{counts.map((count) => { const itemCount = items.filter((line) => id(line.stock_count) === id(count.id)).length; return <article key={id(count.id)}><span><Icon name="format_list_numbered" size={18} /></span><div><strong>{id(count.count_no)}</strong><p>{id(stores.get(id(count.store))?.name)} · {date(count.count_date)}</p><small>{itemCount ? `${itemCount} Article${itemCount === 1 ? '' : 's'} populated` : 'Awaiting count-sheet population'}</small></div><footer><button type="button" onClick={() => select(count)}>Open</button><button type="button" disabled={!itemCount} onClick={() => print(count)}><Icon name="print" size={15} />Print</button></footer></article> })}</div>{!counts.length && <Empty icon="format_list_numbered" title="No stock-taking lists" text="Create an inventory session first, then populate it from live stock." />}</section>
}

function Receipts({ selected, lines, itemById, varianceLines, counts, select }: { selected: Row | null; lines: Row[]; itemById: Map<string, Row>; varianceLines: Row[]; counts: Row[]; select: (count: Row) => void }) {
  return <div className="store-inventory-receipts-grid"><section className="store-inventory-card"><div className="store-inventory-section-head"><div><small>Inventory Session</small><h2>Counted Receipts</h2><p>Captured physical quantities and the calculated difference from the system quantity.</p></div></div><div className="store-inventory-session-list receipts">{counts.map((count) => <button type="button" key={id(count.id)} className={id(selected?.id) === id(count.id) ? 'active' : ''} onClick={() => select(count)}><span><strong>{id(count.count_no)}</strong><em>{date(count.count_date)}</em></span><Status value={count.status} /></button>)}</div></section><section className="store-inventory-card store-inventory-receipt-detail">{!selected ? <Empty icon="fact_check" title="Select an inventory session" text="Choose a stock count to review its counted receipts." /> : <><div className="store-inventory-section-head"><div><small>{varianceLines.length ? 'Variance detected' : 'Counted quantity'}</small><h2>{id(selected.count_no)}</h2><p>{lines.length} counted receipt{lines.length === 1 ? '' : 's'} · {varianceLines.length} variance{varianceLines.length === 1 ? '' : 's'}</p></div><Status value={selected.status} /></div><div className="store-inventory-table-wrap"><table className="store-inventory-table"><thead><tr><th>Article</th><th>System Qty</th><th>Physical Qty</th><th>Variance</th><th>Note</th></tr></thead><tbody>{lines.map((line) => { const variance = number(line.physical_quantity) - number(line.system_quantity); return <tr key={id(line.id)}><td><strong>{id(line.item_name) || id(itemById.get(id(line.item))?.name) || 'Article'}</strong></td><td>{quantity(line.system_quantity)}</td><td>{quantity(line.physical_quantity)}</td><td className={variance === 0 ? '' : variance < 0 ? 'variance-negative' : 'variance-positive'}>{variance > 0 ? '+' : ''}{quantity(variance)}</td><td>{id(line.note) || '—'}</td></tr> })}</tbody></table></div>{!lines.length && <Empty icon="receipt_long" title="No counted receipts" text="Populate the selected session and record the physical quantity for each Article." />}</>}</section></div>
}

function Status({ value }: { value: unknown }) {
  const raw = id(value).toLowerCase()
  const tone = raw === 'applied' || raw === 'active' ? 'good' : raw === 'submitted' || raw === 'approved' || raw === 'in_progress' ? 'info' : raw === 'cancelled' || raw === 'inactive' ? 'bad' : 'neutral'
  return <span className={`store-inventory-status ${tone}`}>{label(value)}</span>
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="store-inventory-empty"><span><Icon name={icon} size={21} /></span><strong>{title}</strong><p>{text}</p></div>
}
