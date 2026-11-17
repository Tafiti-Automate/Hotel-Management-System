import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useApp } from '../state/AppContext'
import { cfg, type EntityKey } from '../lib/data'
import { canAccessRoute } from '../lib/access'
import { Icon } from './Icon'
import RecordDetailDrawer from './RecordDetailDrawer'
import { fetchCommandDocument, searchGlobalCommands, type GlobalCommandHit } from '../lib/api'

const routeItems = [
  ['dashboard', 'Dashboard', 'space_dashboard'],
  ['workflow-stores', 'Stores', 'warehouse'],
  ['workflow-procure', 'Procurement', 'shopping_cart_checkout'],
  ['workflow-pay', 'Finance', 'payments'],
  ['approval-inbox', 'Approval inbox', 'approval'],
  ['new-store-request', 'New store request', 'assignment_add'],
  ['incoming-pickup', 'Confirm pickup', 'fact_check'],
  ['grn-posting', 'GRN posting', 'move_to_inbox'],
  ['purchasing-workbench','PR-to-PO workbench','shopping_cart'],
  ['purchasing-quotes','Supplier price quotes','request_quote'],
  ['purchasing-pr-new','New purchase requisition','add_shopping_cart'],
  ['receiving-po-detail','Blind receiving','local_shipping'],
  ['receiving-return-new','Return to supplier','assignment_return'],
  ['finance-invoice-matching','3-way invoice matching','fact_check'],
  ['finance-budgets','Monthly budgets','table_chart'],
  ['finance-period-close','Month-end closing','lock'],
  ['admin-cost-centers','Cost centers','warehouse'],
  ['admin-authorisation-rules','Authorisation rules','rule'],
  ['admin-articles','Article master','inventory_2'],
  ['pos-reconciliation','POS reconciliation','point_of_sale'],
  ['waste-new','Record waste','delete_sweep'],
  ['transfer-dispatch', 'Transfer fulfillment', 'local_shipping'],
  ['recipes-production', 'Recipe costing', 'menu_book'],
  ['pos-control', 'POS reconciliation', 'point_of_sale'],
  ['finance-governance', 'Budgets & period close', 'account_balance'],
  ['storeRequisitions', 'Store requisitions', 'assignment'],
  ['requisitions', 'Purchase requisitions', 'request_quote'],
  ['orders', 'Purchase orders', 'receipt_long'],
  ['grns', 'Goods receipts', 'move_to_inbox'],
  ['balances', 'Stock balances', 'equalizer'],
  ['ledgers', 'Stock ledger', 'menu_book'],
  ['items', 'Article catalogue', 'inventory_2'],
  ['suppliers', 'Suppliers', 'local_shipping'],
  ['employees', 'Employees', 'badge'],
  ['reports', 'Reports', 'bar_chart'],
  ['audit-log', 'Audit log', 'history'],
] as const

interface SearchRecord {
  entity: EntityKey
  id: string
  title: string
  meta: string
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<GlobalCommandHit[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<{
    hit: GlobalCommandHit
    record: Record<string, unknown>
  } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const resultButtons = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const frame = window.requestAnimationFrame(() => input.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose])

  useEffect(() => {
    const normalized = query.trim()
    if (!open || normalized.length < 2) {
      setRemote([])
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const handle = window.setTimeout(() => {
      void searchGlobalCommands(normalized).then((matches) => {
        if (alive) setRemote(matches)
      }).catch(() => {
        if (alive) setRemote([])
      }).finally(() => {
        if (alive) setSearching(false)
      })
    }, 250)
    return () => { alive = false; window.clearTimeout(handle) }
  }, [query, open])

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const routes = routeItems
      .filter(([route, label]) => canAccessRoute(app.user, route) && (!normalizedQuery || label.toLowerCase().includes(normalizedQuery)))
      .slice(0, 7)
    const records: SearchRecord[] = []

    if (normalizedQuery.length >= 2) {
      Object.entries(app.data).forEach(([entity, rows]) => {
        if (!cfg[entity] || !canAccessRoute(app.user, entity) || records.length >= 12) return
        for (const row of rows || []) {
          const searchableText = Object.values(row)
            .filter((value) => typeof value === 'string' || typeof value === 'number')
            .join(' ')
            .toLowerCase()
          if (searchableText.includes(normalizedQuery)) {
            records.push({
              entity: entity as EntityKey,
              id: String(row.id),
              title: String(row.name || row.reference || row.number || row.id),
              meta: cfg[entity].title,
            })
          }
          if (records.length >= 12) break
        }
      })
    }

    return { routes, records }
  }, [query, app.data, app.user])

  if (!open && !selected) return null

  const resultCount = results.routes.length + results.records.length + remote.length
  const focusResult = (index: number) => {
    if (!resultCount) return
    resultButtons.current[(index + resultCount) % resultCount]?.focus()
  }
  const openRoute = (route: string, label: string) => {
    app.navTo(route, label)
    onClose()
  }
  const openDocument = (hit: GlobalCommandHit) => {
    setSelected({
      hit,
      record: {
        id: hit.id, reference: hit.reference, status: hit.status,
        description: hit.subtitle, source: hit.title,
      },
    })
    onClose()
    void fetchCommandDocument(hit).then((record) => {
      setSelected((current) => current?.hit.id === hit.id
        ? { ...current, record }
        : current)
    }).catch((cause) => {
      setSelected((current) => current?.hit.id === hit.id
        ? { ...current, record: { ...current.record, detail: String(cause) } }
        : current)
    })
  }

  const handleInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusResult(0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusResult(resultCount - 1)
    } else if (event.key === 'Tab' && event.shiftKey && resultCount) {
      event.preventDefault()
      focusResult(resultCount - 1)
    }
  }
  const handleResultKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusResult(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (index === 0) input.current?.focus()
      else focusResult(index - 1)
    } else if (event.key === 'Tab' && !event.shiftKey && index === resultCount - 1) {
      event.preventDefault()
      input.current?.focus()
    } else if (event.key === 'Tab' && event.shiftKey && index === 0) {
      event.preventDefault()
      input.current?.focus()
    }
  }

  return <>
    {open && <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Global search">
      <div className="command-input">
        <Icon name="search" size={21} />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKey}
          placeholder="Search PO, GRN, transfer, article or page…"
          aria-label="Search system"
        />
        <kbd>Esc</kbd>
      </div>

      <div className="command-body">
        <div className="command-section-title">Pages</div>
        {results.routes.map(([route, label, icon], index) => <button
          ref={(node) => { resultButtons.current[index] = node }}
          type="button"
          key={route}
          className="command-result"
          onKeyDown={(event) => handleResultKey(event, index)}
          onClick={() => openRoute(route, label)}
        >
          <span><Icon name={icon} size={18} /></span>
          <div><b>{label}</b><small>Open</small></div>
          <Icon name="arrow_forward" size={16} />
        </button>)}

        {results.records.length > 0 && <>
          <div className="command-section-title">Records</div>
          {results.records.map((record, recordIndex) => {
            const index = results.routes.length + recordIndex
            return <button
              ref={(node) => { resultButtons.current[index] = node }}
              type="button"
              key={`${record.entity}-${record.id}`}
              className="command-result"
              onKeyDown={(event) => handleResultKey(event, index)}
              onClick={() => {
                app.openDetail(record.entity, record.id, record.entity)
                onClose()
              }}
            >
              <span><Icon name={cfg[record.entity].icon} size={18} /></span>
              <div><b>{record.title}</b><small>{record.meta}</small></div>
              <Icon name="open_in_new" size={16} />
            </button>
          })}
        </>}

        {remote.length > 0 && <>
          <div className="command-section-title">Live documents & articles</div>
          {remote.map((hit, remoteIndex) => {
            const index = results.routes.length + results.records.length + remoteIndex
            return <button
              ref={(node) => { resultButtons.current[index] = node }}
              type="button"
              key={hit.kind + '-' + hit.id}
              className="command-result"
              onKeyDown={(event) => handleResultKey(event, index)}
              onClick={() => openDocument(hit)}
            >
              <span><Icon name={hit.kind === 'order' ? 'receipt_long' : hit.kind === 'grn' ? 'move_to_inbox' : hit.kind === 'transfer' ? 'sync_alt' : 'inventory_2'} size={18} /></span>
              <div><b>{hit.reference || hit.title}</b><small>{hit.title} · {hit.subtitle}</small></div>
              <Icon name="open_in_new" size={16} />
            </button>
          })}
        </>}
        {searching && <div className="command-section-title">Searching live records…</div>}
        {!searching && !results.routes.length && !results.records.length && !remote.length && <div className="command-empty">
          <Icon name="search_off" size={25} />
          <b>No results found</b>
          <small>Try a reference, supplier, employee, article or page name.</small>
        </div>}
      </div>

      <footer className="command-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>Enter</kbd> Open</span>
        <span>Search respects your role permissions</span>
      </footer>
    </section>
  </div>}
    {selected && <RecordDetailDrawer
      title={selected.hit.title}
      subtitle={selected.hit.reference}
      record={selected.record}
      onClose={() => setSelected(null)}
    />}
  </>
}
