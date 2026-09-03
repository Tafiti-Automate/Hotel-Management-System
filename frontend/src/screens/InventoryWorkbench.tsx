import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { HelpLabel } from '../components/HelpLabel'
import { createBackendRecord, deleteBackendPath, errorMessage, readBackendRecords, runBackendAction, updateBackendRecord } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

type Tab = 'requests' | 'issues' | 'transfers' | 'adjustments' | 'counts' | 'returns' | 'reorder' | 'batches' | 'consumption'
type SupplyTask = 'prepare' | 'department' | 'stores' | 'shortage' | 'issue'
const inventoryPaths = {
  requests: 'store-requisitions', requestItems: 'store-requisition-items',
  storeOptions: 'store-requisitions/store-options',
  issues: 'stock-issues', issueItems: 'stock-issue-items',
  transfers: 'stock-transfers', transferItems: 'stock-transfer-items',
  adjustments: 'stock-adjustments', adjustmentItems: 'stock-adjustment-items',
  counts: 'stock-counts', countItems: 'stock-count-items',
  returns: 'store-returns', returnItems: 'store-return-items',
  consumption: 'department-consumption',
  reorder: 'reorder-rules',
  batches: 'inventory-batches',
  balances: 'inventory-balances',
}

const pathViewPermissions: Record<keyof typeof inventoryPaths, string> = {
  requests: 'inventory.view_storerequisition',
  requestItems: 'inventory.view_storerequisitionitem',
  storeOptions: 'inventory.view_storerequisition',
  issues: 'inventory.view_stockissue',
  issueItems: 'inventory.view_stockissueitem',
  transfers: 'inventory.view_stocktransfer',
  transferItems: 'inventory.view_stocktransferitem',
  adjustments: 'inventory.view_stockadjustment',
  adjustmentItems: 'inventory.view_stockadjustmentitem',
  counts: 'inventory.view_stockcount',
  countItems: 'inventory.view_stockcountitem',
  returns: 'inventory.view_storereturn',
  returnItems: 'inventory.view_storereturnitem',
  consumption: 'inventory.view_departmentconsumption',
  reorder: 'inventory.view_reorderrule',
  batches: 'inventory.view_inventorybatch',
  balances: 'inventory.view_inventorybalance',
}

const tabPermissions: Record<Tab, { view: string; change?: string }> = {
  requests: { view: 'inventory.view_storerequisition', change: 'inventory.change_storerequisition' },
  issues: { view: 'inventory.view_stockissue', change: 'inventory.change_stockissue' },
  transfers: { view: 'inventory.view_stocktransfer', change: 'inventory.change_stocktransfer' },
  adjustments: { view: 'inventory.view_stockadjustment', change: 'inventory.change_stockadjustment' },
  counts: { view: 'inventory.view_stockcount', change: 'inventory.change_stockcount' },
  returns: { view: 'inventory.view_storereturn', change: 'inventory.change_storereturn' },
  reorder: { view: 'inventory.view_reorderrule', change: 'inventory.change_reorderrule' },
  batches: { view: 'inventory.view_inventorybatch' },
  consumption: { view: 'inventory.view_departmentconsumption' },
}

const blank = Object.fromEntries(Object.keys(inventoryPaths).map((key) => [key, []])) as Record<string, Row[]>
const id = (value: unknown) => String(value || '')
const num = (value: unknown) => Number(value || 0)

function isReadyForProcurement(request: Row, requestItems: Row[]): boolean {
  if (id(request.status).trim().toLowerCase() !== 'submitted' || !id(request.store)) return false
  const lines = requestItems.filter((line) => id(line.requisition) === id(request.id))
  const everyLineDecided = lines.length > 0 && lines.every(
    (line) => num(line.quantity_approved) > 0 || Boolean(id(line.storekeeper_comment).trim()),
  )
  const carriesQuantity = lines.some((line) => num(line.quantity_approved) > 0)
  return everyLineDecided && carriesQuantity
}

export default function InventoryWorkbench() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>('requests')
  const [data, setData] = useState(blank)
  const [form, setForm] = useState<Row>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<Row | null>(null)
  const [supplyPathHint, setSupplyPathHint] = useState('')
  const operationRunning = useRef(false)
  const can = useCallback(
    (permission: string) => app.user.isSuperuser || app.user.permissions.includes(permission),
    [app.user.isSuperuser, app.user.permissions],
  )
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const entries = await Promise.all(Object.entries(inventoryPaths).map(async ([key, path]) => {
        const typedKey = key as keyof typeof inventoryPaths
        return can(pathViewPermissions[typedKey]) ? [key, await readBackendRecords(path)] : [key, []]
      }))
      setData(Object.fromEntries(entries))
    }
    catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
  }, [can])
  useEffect(() => { void load() }, [load])
  useEffect(() => { setForm({}); setError(''); setSelectedRecord(null) }, [tab])
  useEffect(() => {
    if (!app.inventoryDraftId) return
    setTab('requests')
    setSupplyPathHint('prepare')
    setForm({ request: app.inventoryDraftId })
    app.consumeInventoryDraft()
  }, [app.inventoryDraftId, app.consumeInventoryDraft])
  const scopedData = useMemo(() => {
    if (!app.currentBranch) return data
    // The backend already scopes department employees to their own branch and records.
    // Requesters are not allowed to read the Stores endpoint, so app.data.locations is
    // legitimately empty for them. Never erase valid requisitions just because the
    // browser cannot load store master data.
    if (app.data.locations.length === 0) return data
    const stores = new Set(app.data.locations.map((row) => id(row.id)))
    const next = { ...data }
    const currentRole = String(app.user.role || '').trim().toLowerCase()
    next.requests = data.requests.filter((row) => {
      // Submitted Department requests are an inbox for Store Keepers. They must
      // remain visible before the destination store has been confirmed.
      if (currentRole === 'store keeper' && id(row.status).toLowerCase() === 'submitted') return true
      return stores.has(id(row.store)) || stores.has(id(row.storeId))
    })
    next.issues = data.issues.filter((row) => stores.has(id(row.store)))
    next.transfers = data.transfers.filter((row) => stores.has(id(row.from_store)) || stores.has(id(row.to_store)))
    next.adjustments = data.adjustments.filter((row) => stores.has(id(row.store)))
    next.counts = data.counts.filter((row) => stores.has(id(row.store)))
    next.returns = data.returns.filter((row) => stores.has(id(row.store)))
    next.reorder = data.reorder.filter((row) => !row.store || stores.has(id(row.store)))
    next.batches = data.batches.filter((row) => stores.has(id(row.store)))
    next.balances = data.balances.filter((row) => stores.has(id(row.store)))
    const requestIds = new Set(next.requests.map((row) => id(row.id)))
    const issueIds = new Set(next.issues.map((row) => id(row.id)))
    const transferIds = new Set(next.transfers.map((row) => id(row.id)))
    const adjustmentIds = new Set(next.adjustments.map((row) => id(row.id)))
    const countIds = new Set(next.counts.map((row) => id(row.id)))
    const returnIds = new Set(next.returns.map((row) => id(row.id)))
    next.requestItems = data.requestItems.filter((row) => requestIds.has(id(row.requisition)))
    next.issueItems = data.issueItems.filter((row) => issueIds.has(id(row.issue)))
    next.transferItems = data.transferItems.filter((row) => transferIds.has(id(row.stock_transfer)))
    next.adjustmentItems = data.adjustmentItems.filter((row) => adjustmentIds.has(id(row.stock_adjustment)))
    next.countItems = data.countItems.filter((row) => countIds.has(id(row.stock_count)))
    next.returnItems = data.returnItems.filter((row) => returnIds.has(id(row.store_return)))
    return next
  }, [app.currentBranch, app.data.locations, app.user.role, data])
  const execute = async (operation: () => Promise<unknown>, success: string, nextForm: Row = {}) => {
    if (operationRunning.current) return false
    operationRunning.current = true
    setBusy(true); setError('')
    try {
      await operation()
      await load()
      app.refreshData()
      setForm(nextForm)
      app.showToast(success)
      return true
    }
    catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Action could not be completed', detail)
      return false
    }
    finally { operationRunning.current = false; setBusy(false) }
  }
  const tabs: Array<[Tab, string, string]> = ([
    ['requests', 'assignment', 'Department requests'], ['issues', 'outbox', 'Pick & issue'],
    ['transfers', 'sync_alt', 'Transfers'], ['adjustments', 'tune', 'Adjustments'],
    ['counts', 'inventory', 'Stock counts'], ['returns', 'assignment_return', 'Returns'],
    ['reorder', 'notification_important', 'Reorder queue'], ['batches', 'inventory_2', 'Batches & expiry'],
    ['consumption', 'monitoring', 'Consumption'],
  ] as Array<[Tab, string, string]>).filter(([key]) => can(tabPermissions[key].view))
  useEffect(() => {
    if (tabs.length && !tabs.some(([key]) => key === tab)) setTab(tabs[0][0])
  }, [tab, tabs])
  const changePermission = tabPermissions[tab].change
  const canChangeTab = Boolean(changePermission && can(changePermission))
  const role = String(app.user.role || '').toLowerCase()
  const isAdministrator = app.user.isSuperuser || role === 'system administrator'
  const isDepartmentHead = role === 'department head'
  const isStoresApprover = isAdministrator || role === 'store keeper'
  const otherTabs = role === 'store keeper' || isDepartmentHead || role === 'requester' ? [] : tabs.filter(([key]) => !['requests', 'issues'].includes(key))
  const requestRoleStage: SupplyTask = isStoresApprover ? 'stores' : isDepartmentHead ? 'department' : 'prepare'
  const supplyPathActive = supplyPathHint || (tab === 'issues' ? 'issue' : tab === 'requests' ? requestRoleStage : '')
  const readyForProcurementCount = scopedData.requests.filter(
    (request) => isReadyForProcurement(request, scopedData.requestItems),
  ).length
  const selectSupplyStep = (key: string) => {
    setSupplyPathHint(key)
    setForm({})
    setSelectedRecord(null)
    setTab(key === 'issue' ? 'issues' : 'requests')
  }
  const common = { app, data: scopedData, form, setForm, busy, execute }
  const requesterPreparing = role === 'requester' && tab === 'requests' && supplyPathActive === 'prepare'
  const requesterEditingDraft = requesterPreparing && Boolean(form.request)
  const showSupplyNavigation = (can(tabPermissions.requests.view) || can(tabPermissions.issues.view))
    && (isStoresApprover || (!isDepartmentHead && role !== 'requester'))
  const selectInventoryRecord = (row: Row) => {
    if (requesterPreparing && ['draft', 'rejected'].includes(id(row.status).trim().toLowerCase())) {
      setForm({ request: id(row.id) })
      return
    }
    setSelectedRecord(row)
  }
  const createRequesterRequisition = async () => {
    if (operationRunning.current) return
    operationRunning.current = true
    setBusy(true); setError('')
    try {
      const saved = await createBackendRecord('store-requisitions', { purpose: '', required_date: null })
      await load()
      app.refreshData()
      setForm({ request: id(saved.id || saved.apiId) })
      app.showToast('New Department Requisition created')
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Could not start requisition', detail)
    } finally {
      operationRunning.current = false
      setBusy(false)
    }
  }
  const departmentPendingCount = scopedData.requests.filter((row: Row) => id(row.status) === 'pending_department_approval').length
  return <div className="enterprise-workspace inventory-workbench" style={{ maxWidth: 1460, margin: '0 auto' }} aria-busy={loading}>
    {isDepartmentHead ? <header className="department-approval-page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <h1 style={{ margin: '0 0 5px', color: 'var(--text)', fontSize: 29, fontWeight: 750 }}>Department Approvals</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>{departmentPendingCount ? `${departmentPendingCount} request${departmentPendingCount === 1 ? '' : 's'} need your attention.` : 'Review department requisitions and previous decisions.'}</p>
      </div>
      <button type="button" className="inventory-refresh-button" onClick={() => void load()} disabled={loading} style={secondary}><Icon name="refresh" size={17} />{loading ? 'Refreshing…' : 'Refresh'}</button>
    </header> : <section className="workbench-hero inventory-workbench-hero" style={{ ...card, padding: 20, display: 'flex', alignItems: 'center', gap: 13, marginBottom: 15 }}>
      <span className="inventory-workbench-hero-icon" style={hero}><Icon name={role === 'requester' ? 'assignment' : 'warehouse'} size={24} color="#fff" /></span>
      <div className="inventory-workbench-hero-copy"><div style={eyebrow}>{role === 'requester' ? 'Requisitions' : 'Inventory'}</div><h1 style={{ margin: '3px 0', fontSize: 23 }}>{isStoresApprover ? 'Store Keeper Queue' : 'My Requisitions'}</h1><div style={muted}>{role === 'store keeper' ? 'HOD-approved requisitions ready for store processing.' : isStoresApprover ? 'Review inventory requests.' : 'Create and track department requisitions.'}</div></div>
      <button type="button" className="inventory-refresh-button" onClick={() => void load()} disabled={loading} style={{ ...secondary, marginLeft: 'auto' }}><Icon name="refresh" size={17} />{loading ? 'Refreshing…' : 'Refresh'}</button>
    </section>}
    {(showSupplyNavigation || otherTabs.length > 0) && <nav className="inventory-workbench-navigation" aria-label="Inventory workspace navigation">
      {showSupplyNavigation && <section className="inventory-nav-group" aria-labelledby="request-workflow-heading">
        <div className="inventory-nav-group-copy"><div id="request-workflow-heading">Request workflow</div><small>Move requests through their assigned stage.</small></div>
        <div className="inventory-nav-actions">
          {!isStoresApprover && !isDepartmentHead && role !== 'requester' && <button type="button" className="inventory-nav-button" aria-pressed={supplyPathActive === 'prepare'} onClick={() => selectSupplyStep('prepare')} style={{ ...tabButton, background: supplyPathActive === 'prepare' ? 'var(--accent-soft)' : 'var(--surface)', color: supplyPathActive === 'prepare' ? 'var(--accent)' : 'var(--text-muted)', borderColor: supplyPathActive === 'prepare' ? 'var(--accent)' : 'var(--border)' }}><Icon name="assignment" size={17} />My requisitions</button>}
          {isStoresApprover && <button type="button" className="inventory-nav-button" aria-pressed={supplyPathActive === 'stores'} onClick={() => selectSupplyStep('stores')} style={{ ...tabButton, background: supplyPathActive === 'stores' ? 'var(--accent-soft)' : 'var(--surface)', color: supplyPathActive === 'stores' ? 'var(--accent)' : 'var(--text-muted)', borderColor: supplyPathActive === 'stores' ? 'var(--accent)' : 'var(--border)' }}><Icon name="assignment" size={17} />Department requests ({scopedData.requests.filter((row: Row) => id(row.status) === 'submitted').length})</button>}
          {isAdministrator && <button type="button" className="inventory-nav-button" aria-pressed={supplyPathActive === 'shortage'} onClick={() => selectSupplyStep('shortage')} style={{ ...tabButton, background: supplyPathActive === 'shortage' ? 'var(--accent-soft)' : 'var(--surface)', color: supplyPathActive === 'shortage' ? 'var(--accent)' : 'var(--text-muted)', borderColor: supplyPathActive === 'shortage' ? 'var(--accent)' : 'var(--border)' }}><Icon name="shopping_cart_checkout" size={17} />Forward to Procurement ({readyForProcurementCount})</button>}
        </div>
      </section>}
      {otherTabs.length > 0 && <section className="inventory-nav-group" aria-labelledby="inventory-operations-heading">
        <div className="inventory-nav-group-copy"><div id="inventory-operations-heading">Inventory operations</div><small>Manage stock movement, controls and visibility.</small></div>
        <div className="inventory-nav-actions">{otherTabs.map(([key, icon, label]) => <button type="button" className="inventory-nav-button" aria-pressed={tab === key && !supplyPathHint} key={key} onClick={() => { setSupplyPathHint(''); setTab(key) }} style={{ ...tabButton, background: tab === key ? 'var(--accent-soft)' : 'var(--surface)', color: tab === key ? 'var(--accent)' : 'var(--text-muted)', borderColor: tab === key ? 'var(--accent)' : 'var(--border)' }}><Icon name={icon} size={17} />{label}</button>)}</div>
      </section>}
    </nav>}
    {error && <div className="inventory-error-banner" role="alert" style={{ ...card, padding: 12, color: 'var(--bad)', fontSize: 12, marginBottom: 14 }}><Icon name="error" size={18} color="var(--bad)" /><span>{error}</span></div>}
    {loading ? <section className="inventory-loading-state" style={card} role="status" aria-live="polite"><div><span className="inventory-loading-line inventory-loading-line-title" /><span className="inventory-loading-line" /></div><div className="inventory-loading-rows"><span /><span /><span /></div><span className="sr-only">Loading inventory controls…</span></section> : isDepartmentHead ? (
      <DepartmentApprovalWorkspace app={app} data={scopedData} busy={busy} execute={execute} selected={selectedRecord} onSelect={setSelectedRecord} />
    ) : role === 'store keeper' && tab === 'requests' && supplyPathActive === 'stores' ? (
      <StoreKeeperRequestWorkspace app={app} data={scopedData} busy={busy} execute={execute} selected={selectedRecord} onSelect={setSelectedRecord} />
    ) : requesterEditingDraft ? (
      <RequestPanel {...common} stage="prepare" />
    ) : requesterPreparing ? (
      <Records tab={tab} data={scopedData} app={app} stage={supplyPathActive} onSelect={selectInventoryRecord} onNewRequisition={() => void createRequesterRequisition()} />
    ) : <div className="workbench-grid inventory-workbench-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(350px,.7fr)', gap: 16, alignItems: 'start' }}>
      <Records tab={tab} data={scopedData} app={app} stage={supplyPathActive} onSelect={selectInventoryRecord} />
      <aside className="workbench-action-panel" style={{ ...card, padding: 18 }}>
        {!canChangeTab && !['batches', 'consumption'].includes(tab) && <ReadOnlyPanel title="Read-only access" note="View only." />}
        {canChangeTab && tab === 'requests' && <RequestPanel {...common} stage={(supplyPathActive || requestRoleStage) as SupplyTask} />}
        {canChangeTab && tab === 'issues' && <IssuePanel {...common} />}
        {canChangeTab && tab === 'transfers' && <TransferPanel {...common} />}
        {canChangeTab && tab === 'adjustments' && <AdjustmentPanel {...common} />}
        {canChangeTab && tab === 'counts' && <CountPanel {...common} />}
        {canChangeTab && tab === 'returns' && <ReturnPanel {...common} />}
        {canChangeTab && tab === 'reorder' && <ReorderPanel {...common} />}
        {tab === 'batches' && <ReadOnlyPanel title="Batch and expiry visibility" note="Batch, expiry and available quantity records." />}
        {tab === 'consumption' && <ReadOnlyPanel title="Department consumption" note="Department usage and cost records." />}
      </aside>
    </div>}
    {selectedRecord && !isDepartmentHead && !(role === 'store keeper' && tab === 'requests' && supplyPathActive === 'stores') && <InventoryRecordDrawer tab={tab} row={selectedRecord} data={scopedData} app={app} close={() => setSelectedRecord(null)} />}
  </div>
}


function DepartmentApprovalWorkspace({ app, data, busy, execute, selected, onSelect }: {
  app: any
  data: Record<string, Row[]>
  busy: boolean
  execute: (operation: () => Promise<unknown>, success: string, nextForm?: Row) => Promise<boolean>
  selected: Row | null
  onSelect: (row: Row | null) => void
}) {
  const [query, setQuery] = useState('')
  const [date, setDate] = useState('')
  const [section, setSection] = useState<'pending' | 'history'>('pending')
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [lineRejectReasons, setLineRejectReasons] = useState<Record<string, string>>({})
  const unitNames = new Map<string, string>(app.data.uoms.map((row: Row): [string, string] => [id(row.id), id(row.name)]))
  const pending = data.requests.filter((row: Row) => id(row.status) === 'pending_department_approval')
  const history = data.requests.filter((row: Row) => {
    const status = id(row.status)
    return status !== 'draft' && status !== 'pending_department_approval'
  })
  const formatDate = (value: unknown) => {
    if (!value) return '—'
    const parsed = new Date(id(value))
    if (Number.isNaN(parsed.getTime())) return id(value)
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  const requester = (row: Row) => employeeName(app, row.requested_by) || 'Requester'
  const linesFor = useCallback((row: Row) => data.requestItems.filter((line: Row) => id(line.requisition) === id(row.id)), [data.requestItems])
  const currentRows = section === 'pending' ? pending : history
  const visible = currentRows.filter((row: Row) => {
    const lines = linesFor(row)
    const haystack = [id(row.requisition_no), requester(row), ...lines.map((line) => itemName(app, line.item))].join(' ').toLowerCase()
    const rowDate = id(row.created_at || row.request_date).slice(0, 10)
    return (!query || haystack.includes(query.toLowerCase())) && (!date || rowDate === date)
  })
  const visibleSelectionKey = visible.map((row: Row) => id(row.id)).join('|')
  const activeSelected = selected && visible.some((row: Row) => id(row.id) === id(selected.id)) ? selected : null
  const approvedCount = history.filter((row: Row) => Boolean(row.department_approved_at)).length
  const rejectedCount = history.filter((row: Row) => id(row.status) === 'rejected' && !row.department_approved_at).length

  useEffect(() => {
    if (activeSelected || !visible.length) {
      if (!visible.length && selected) onSelect(null)
      return
    }
    onSelect(visible[0])
  }, [activeSelected, onSelect, selected, visibleSelectionKey])

  useEffect(() => {
    if (!activeSelected) { setQuantities({}); setLineRejectReasons({}); return }
    const next: Record<string, string> = {}
    const reasons: Record<string, string> = {}
    linesFor(activeSelected).forEach((line: Row) => {
      const value = line.hod_approved_quantity ?? line.base_quantity_requested ?? line.quantity_requested ?? 0
      next[id(line.id)] = id(value)
      reasons[id(line.id)] = id(line.rejection_reason)
    })
    setQuantities(next)
    setLineRejectReasons(reasons)
  }, [activeSelected, linesFor])

  const closeDecision = () => { setDecision(null); setReason('') }
  const approve = async () => {
    if (!activeSelected || busy) return
    const lines = linesFor(activeSelected)
    const payload = lines.map((line: Row) => {
      const approvedQuantity = num(quantities[id(line.id)])
      return {
        id: id(line.id),
        approved_quantity: approvedQuantity,
        rejected: approvedQuantity === 0,
        rejection_reason: approvedQuantity === 0 ? id(lineRejectReasons[id(line.id)]).trim() : '',
      }
    })
    const ok = await execute(
      () => runBackendAction('store-requisitions', id(activeSelected.id), 'department-approve', { comments: '', items: payload }),
      `Requisition ${id(activeSelected.requisition_no)} approved and sent to the Store Keeper`,
    )
    if (ok) { closeDecision(); onSelect(null); setSection('pending') }
  }
  const reject = async () => {
    if (!activeSelected || busy || !reason.trim()) return
    const ok = await execute(
      () => runBackendAction('store-requisitions', id(activeSelected.id), 'reject', { reason: reason.trim() }),
      `Requisition ${id(activeSelected.requisition_no)} rejected`,
    )
    if (ok) { closeDecision(); onSelect(null); setSection('pending') }
  }
  const lines = activeSelected ? linesFor(activeSelected) : []
  const isPending = Boolean(activeSelected && id(activeSelected.status) === 'pending_department_approval')
  const validQuantities = isPending && lines.length > 0 && lines.every((line: Row) => {
    const value = num(quantities[id(line.id)])
    const requested = num(line.base_quantity_requested || line.quantity_requested)
    return value >= 0 && value <= requested && (value > 0 || Boolean(id(lineRejectReasons[id(line.id)]).trim()))
  }) && lines.some((line: Row) => num(quantities[id(line.id)]) > 0)
  const changeSection = (next: 'pending' | 'history') => {
    closeDecision()
    setSection(next)
    onSelect(null)
  }

  return <div className="department-approval-workspace">
    <section className="approval-overview-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 9, marginBottom: 12 }}>
      <ApprovalSummaryCard icon="pending_actions" label="Awaiting review" value={String(pending.length)} note="Requires your decision" tone="warn" />
      <ApprovalSummaryCard icon="task_alt" label="HOD approved" value={String(approvedCount)} note="Sent forward in workflow" tone="good" />
      <ApprovalSummaryCard icon="cancel" label="Rejected" value={String(rejectedCount)} note="Stopped at department review" tone="bad" />
      <ApprovalSummaryCard icon="history" label="Decision history" value={String(history.length)} note="Read-only audit record" />
    </section>

    <div className="department-approval-layout" style={{ display: 'grid', gridTemplateColumns: '370px minmax(0,1fr)', minHeight: 650, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
      <aside className="department-approval-queue" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <div style={{ minHeight: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <div><strong style={{ display: 'block', color: 'var(--text)', fontSize: 12.5 }}>Approval queue</strong><small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)', fontSize: 10.5 }}>{visible.length} of {currentRows.length} shown</small></div>
          <div className="approval-section-tabs" style={{ display: 'flex', gap: 4 }}>
            <button type="button" aria-pressed={section === 'pending'} onClick={() => changeSection('pending')} style={{ ...approvalTab, color: section === 'pending' ? 'var(--accent)' : 'var(--text-muted)', background: section === 'pending' ? 'var(--accent-soft)' : 'var(--surface)' }}>Pending {pending.length}</button>
            <button type="button" aria-pressed={section === 'history'} onClick={() => changeSection('history')} style={{ ...approvalTab, color: section === 'history' ? 'var(--accent)' : 'var(--text-muted)', background: section === 'history' ? 'var(--accent-soft)' : 'var(--surface)' }}>History</button>
          </div>
        </div>

        <div className="hod-approval-filters" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 132px', gap: 7, padding: 9, borderBottom: '1px solid var(--border)' }}>
          <label style={{ position: 'relative', minWidth: 0 }}>
            <Icon name="search" size={17} color="var(--text-faint)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input aria-label="Search approvals" placeholder="Search requests…" value={query} onChange={(event) => setQuery(event.target.value)} style={{ ...control, paddingLeft: 34, paddingRight: query ? 32 : 10 }} />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear approval search" style={{ position: 'absolute', right: 4, top: 3, width: 32, height: 32, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }}><Icon name="close" size={16} /></button>}
          </label>
          <input aria-label="Filter approvals by date" title="Filter by request date" type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ ...control, minWidth: 0 }} />
          {(query || date) && <button type="button" onClick={() => { setQuery(''); setDate('') }} style={{ gridColumn: '1 / -1', justifySelf: 'start', padding: 0, border: 0, background: 'transparent', color: 'var(--accent)', font: 'inherit', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>Clear filters</button>}
        </div>

        <div className="department-approval-queue-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 7, overscrollBehavior: 'contain' }}>
          {visible.map((row: Row) => {
            const rowLines = linesFor(row)
            const itemNames = rowLines.slice(0, 2).map((line) => itemName(app, line.item))
            const preview = itemNames.length ? `${itemNames.join(', ')}${rowLines.length > 2 ? ` +${rowLines.length - 2}` : ''}` : 'No items recorded'
            const active = id(row.id) === id(activeSelected?.id)
            const state = section === 'pending' ? 'pending' : row.department_approved_at ? 'approved' : id(row.status) === 'rejected' ? 'rejected' : 'neutral'
            return <button key={id(row.id)} type="button" className="department-approval-queue-row" aria-current={active ? 'true' : undefined} onClick={() => { closeDecision(); onSelect(row) }} style={{ width: '100%', minHeight: 92, display: 'grid', gap: 7, marginBottom: 5, padding: '10px 11px', border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`, borderRadius: 8, background: active ? 'var(--accent-soft)' : 'transparent', color: 'var(--text)', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong style={{ flex: 1, color: active ? 'var(--accent)' : 'var(--text)', fontSize: 12.5 }}>{id(row.requisition_no)}</strong><ApprovalDecisionBadge state={state} /></span>
              <span style={{ minWidth: 0 }}><strong style={{ display: 'block', color: 'var(--text)', fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{requester(row)}</strong><small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rowLines.length} item{rowLines.length === 1 ? '' : 's'} · {preview}</small></span>
              <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>{formatDate(row.created_at || row.request_date)}</span>
            </button>
          })}
          {!visible.length && <div style={{ minHeight: 250, display: 'grid', placeItems: 'center', padding: 28, textAlign: 'center' }}><div><span style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', margin: '0 auto', borderRadius: 999, background: section === 'pending' ? 'var(--good-soft)' : 'var(--surface-3)' }}><Icon name={section === 'pending' ? 'task_alt' : 'history'} size={22} color={section === 'pending' ? 'var(--good)' : 'var(--text-faint)'} /></span><div style={{ marginTop: 10, color: 'var(--text)', fontSize: 12.5, fontWeight: 750 }}>{currentRows.length ? 'No matching requests' : section === 'pending' ? "You're all caught up" : 'No approval history yet'}</div><div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11.5, lineHeight: 1.5 }}>{currentRows.length ? 'Try changing the search or date filter.' : section === 'pending' ? 'No requests currently need your approval.' : 'Completed decisions will appear here.'}</div></div></div>}
        </div>
      </aside>

      <section className="department-approval-detail" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        {activeSelected ? <>
          <header className="department-approval-detail-header" style={{ minHeight: 74, display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', flex: 'none', borderRadius: 9, background: 'var(--accent-soft)' }}><Icon name="assignment" size={21} color="var(--accent)" /></span>
            <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase' }}>{isPending ? 'Ready for your review' : 'Approval record'}</div><h2 style={{ margin: '3px 0 1px', color: 'var(--text)', fontSize: 19 }}>{id(activeSelected.requisition_no)}</h2><div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{requester(activeSelected)} · {lines.length} item{lines.length === 1 ? '' : 's'}</div></div>
            <ApprovalDecisionBadge state={isPending ? 'pending' : activeSelected.department_approved_at ? 'approved' : id(activeSelected.status) === 'rejected' ? 'rejected' : 'neutral'} roomy />
          </header>

          <div className="department-approval-detail-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, overscrollBehavior: 'contain' }}>
            <div className="hod-request-meta" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(135px,1fr))', gap: 8, marginBottom: 18 }}>
              <InfoBox label="Requested by" value={requester(activeSelected)} />
              <InfoBox label="Department" value={departmentName(app, activeSelected.department)} />
              <InfoBox label="Request date" value={formatDate(activeSelected.created_at || activeSelected.request_date)} />
              <InfoBox label="Issuing store" value={requestStoreName(app, activeSelected)} />
            </div>
            <div style={{ marginBottom: 16, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 11.5 }}><strong style={{ color: 'var(--text)', marginRight: 7 }}>Store location</strong>{requestStoreLocation(app, activeSelected)}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 9 }}><h3 style={{ margin: 0, color: 'var(--text)', fontSize: 13.5 }}>Requested items</h3><span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{lines.length} line{lines.length === 1 ? '' : 's'}</span></div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ minWidth: 780 }}>
                <div className="hod-items-head" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.35fr) 90px 125px 85px minmax(130px,1fr) minmax(165px,1.1fr)', gap: 10, padding: '9px 12px', background: 'var(--surface-2)', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}><span>Article</span><span>Requested</span><span>HOD approved</span><span>UOM</span><span>Request note</span><span>Item decision</span></div>
                {lines.map((line: Row) => {
                  const article = app.data.items.find((item: Row) => id(item.id) === id(line.item))
                  const uom = unitNames.get(id(line.unit || article?.baseUnitId)) || id(article?.uom) || '—'
                  const requested = num(line.base_quantity_requested || line.quantity_requested)
                  const approved = quantities[id(line.id)] ?? id(line.hod_approved_quantity ?? requested)
                  const rejected = num(approved) === 0
                  const rejectReason = id(lineRejectReasons[id(line.id)] || line.rejection_reason)
                  return <div key={id(line.id)} className="hod-items-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.35fr) 90px 125px 85px minmax(130px,1fr) minmax(165px,1.1fr)', gap: 10, minHeight: 60, padding: '11px 12px', borderTop: '1px solid var(--border)', alignItems: 'center', fontSize: 12 }}>
                    <span style={{ color: 'var(--text)', fontWeight: 750 }}>{itemName(app, line.item)}</span>
                    <span style={{ color: 'var(--text)', fontWeight: 700 }}>{requested}</span>
                    {isPending ? <input aria-label={`Approved quantity for ${itemName(app, line.item)}`} type="number" min="0" max={requested} step="0.01" value={approved} onChange={(event) => { const next = event.target.value; setQuantities({ ...quantities, [id(line.id)]: next }); if (num(next) > 0) setLineRejectReasons({ ...lineRejectReasons, [id(line.id)]: '' }) }} style={{ ...control, height: 36 }} /> : <span style={{ color: 'var(--text)', fontWeight: 800 }}>{id(line.hod_approved_quantity ?? requested)}</span>}
                    <span style={{ color: 'var(--text-muted)' }}>{uom}</span><span style={{ color: 'var(--text-muted)' }}>{id(line.remarks) || '—'}</span>
                    {isPending ? <div style={{ display: 'grid', gap: 6 }}>{rejected ? <><span style={{ color: 'var(--bad)', fontSize: 10.5, fontWeight: 800 }}>Item rejected</span><input aria-label={`Rejection reason for ${itemName(app, line.item)}`} value={rejectReason} onChange={(event) => setLineRejectReasons({ ...lineRejectReasons, [id(line.id)]: event.target.value })} placeholder="Reason required" style={{ ...control, height: 34 }} /><button type="button" onClick={() => { setQuantities({ ...quantities, [id(line.id)]: id(requested) }); setLineRejectReasons({ ...lineRejectReasons, [id(line.id)]: '' }) }} style={{ ...secondary, height: 30, justifyContent: 'center' }}>Keep item</button></> : <button type="button" onClick={() => setQuantities({ ...quantities, [id(line.id)]: '0' })} style={{ ...secondary, height: 32, justifyContent: 'center', color: 'var(--bad)', borderColor: 'rgba(220,38,38,.35)' }}>Reject item</button>}</div> : <span style={{ color: id(line.rejection_stage) ? 'var(--bad)' : 'var(--good)', fontWeight: 700 }}>{id(line.rejection_stage) ? `${id(line.rejection_stage)} rejected · ${rejectReason || 'No reason recorded'}` : 'Approved'}</span>}
                  </div>
                })}
                {!lines.length && <div style={{ padding: 34, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>This requisition has no items.</div>}
              </div>
            </div>
            {isPending && <div style={{ marginTop: 9, color: 'var(--text-muted)', fontSize: 11.5 }}>You may reduce an item quantity before approval. The requester quantity remains unchanged in the audit record.</div>}
            {!isPending && id(activeSelected.status) === 'rejected' && !activeSelected.department_approved_at && activeSelected.rejection_reason && <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--bad-soft)', color: 'var(--bad)', fontSize: 12 }}><b>Rejection reason:</b> {id(activeSelected.rejection_reason)}</div>}
          </div>

          {isPending ? <footer className="department-approval-actions" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}><span style={{ marginRight: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>Review quantities before submitting your decision.</span><button type="button" disabled={busy} onClick={() => setDecision('reject')} style={{ ...secondary, color: 'var(--bad)', borderColor: 'rgba(220,38,38,.35)' }}>Reject requisition</button><button type="button" disabled={busy || !validQuantities} onClick={() => setDecision('approve')} style={{ ...secondary, minWidth: 116, justifyContent: 'center', color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)', opacity: busy || !validQuantities ? .5 : 1 }}><Icon name="check" size={17} color="#fff" />Approve</button></footer> : <footer style={{ minHeight: 48, display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 11.5 }}><Icon name="lock" size={15} color="var(--text-faint)" />This is a read-only decision record.</footer>}
        </> : <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 48, textAlign: 'center' }}><div><span style={{ width: 52, height: 52, display: 'grid', placeItems: 'center', margin: '0 auto', borderRadius: 999, background: 'var(--surface-2)' }}><Icon name={section === 'pending' ? 'approval' : 'history'} size={25} color="var(--text-faint)" /></span><div style={{ marginTop: 11, color: 'var(--text)', fontSize: 13.5, fontWeight: 750 }}>{visible.length ? 'Select a requisition' : section === 'pending' ? 'No request selected' : 'No history selected'}</div><div style={{ maxWidth: 310, margin: '5px auto 0', color: 'var(--text-muted)', fontSize: 11.5, lineHeight: 1.5 }}>{visible.length ? 'Choose a request from the queue to review its items and decision details.' : 'Requests matching this view will appear in the approval queue.'}</div></div></div>}
      </section>
    </div>

    {decision && activeSelected && <><div onClick={closeDecision} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(15,23,42,.38)' }} /><section role="dialog" aria-modal="true" style={{ position: 'fixed', zIndex: 91, left: '50%', top: '50%', width: 460, maxWidth: 'calc(100vw - 32px)', transform: 'translate(-50%,-50%)', ...card, padding: 20 }}><h3 style={{ margin: 0, fontSize: 17 }}>{decision === 'approve' ? `Approve requisition ${id(activeSelected.requisition_no)}?` : `Reject requisition ${id(activeSelected.requisition_no)}`}</h3>{decision === 'approve' ? <p style={{ ...muted, margin: '8px 0 18px', fontSize: 12.5 }}>The HOD-approved quantities shown on this requisition will be sent to the Store Keeper.</p> : <div style={{ margin: '14px 0' }}><label style={labelStyle}>Reason for rejection *</label><textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="Enter the reason" style={{ ...control, height: 96, padding: 10, resize: 'vertical' }} /></div>}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button type="button" onClick={closeDecision} disabled={busy} style={secondary}>Cancel</button>{decision === 'approve' ? <button type="button" onClick={() => void approve()} disabled={busy} style={{ ...secondary, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)' }}>Approve</button> : <button type="button" onClick={() => void reject()} disabled={busy || !reason.trim()} style={{ ...secondary, color: '#fff', background: 'var(--bad)', borderColor: 'var(--bad)', opacity: busy || !reason.trim() ? .5 : 1 }}>Reject requisition</button>}</div></section></>}
  </div>
}

function ApprovalSummaryCard({ icon, label, value, note, tone = 'accent' }: { icon: string; label: string; value: string; note: string; tone?: 'accent' | 'warn' | 'good' | 'bad' }) {
  const color = tone === 'warn' ? 'var(--warn)' : tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--accent)'
  const background = tone === 'warn' ? 'var(--warn-soft)' : tone === 'good' ? 'var(--good-soft)' : tone === 'bad' ? 'var(--bad-soft)' : 'var(--accent-soft)'
  return <div style={{ minWidth: 0, minHeight: 82, display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 13px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)' }}><span style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', flex: 'none', borderRadius: 8, background }}><Icon name={icon} size={18} color={color} /></span><span style={{ minWidth: 0, flex: 1 }}><span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.035em' }}>{label}</span><strong style={{ display: 'block', marginTop: 3, color: 'var(--text)', fontSize: 18 }}>{value}</strong><small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)' }}>{note}</small></span></div>
}

function ApprovalDecisionBadge({ state, roomy = false }: { state: 'pending' | 'approved' | 'rejected' | 'neutral'; roomy?: boolean }) {
  const config = state === 'pending'
    ? { label: 'Pending', icon: 'schedule', color: 'var(--warn)', background: 'var(--warn-soft)' }
    : state === 'approved'
      ? { label: 'HOD approved', icon: 'check_circle', color: 'var(--good)', background: 'var(--good-soft)' }
      : state === 'rejected'
        ? { label: 'Rejected', icon: 'cancel', color: 'var(--bad)', background: 'var(--bad-soft)' }
        : { label: 'Completed', icon: 'history', color: 'var(--text-muted)', background: 'var(--surface-3)' }
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none', padding: roomy ? '6px 9px' : '4px 7px', borderRadius: 999, color: config.color, background: config.background, fontSize: roomy ? 10.5 : 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}><Icon name={config.icon} size={roomy ? 14 : 12} color={config.color} />{config.label}</span>
}

function StoreKeeperRequestWorkspace({ app, data, busy, execute, selected, onSelect }: {
  app: any
  data: Record<string, Row[]>
  busy: boolean
  execute: (operation: () => Promise<unknown>, success: string, nextForm?: Row) => Promise<boolean>
  selected: Row | null
  onSelect: (row: Row | null) => void
}) {
  const [section, setSection] = useState<'pending' | 'history'>('pending')
  const [query, setQuery] = useState('')
  const [destinationStore, setDestinationStore] = useState('')
  const [lineValues, setLineValues] = useState<Record<string, { quantity: string; note: string }>>({})
  const [showRejectAll, setShowRejectAll] = useState(false)
  const [rejectAllReason, setRejectAllReason] = useState('')
  const unitNames = new Map<string, string>(app.data.uoms.map((row: Row): [string, string] => [id(row.id), id(row.name)]))
  const linesFor = useCallback((row: Row) => data.requestItems.filter((line: Row) => id(line.requisition) === id(row.id)), [data.requestItems])
  const pending = data.requests.filter((row: Row) => id(row.status) === 'submitted')
  const history = data.requests.filter((row: Row) => row.department_approved_at && id(row.status) !== 'submitted')
  const rows = (section === 'pending' ? pending : history).filter((row: Row) => {
    const lines = linesFor(row)
    return !query || [id(row.requisition_no), departmentName(app, row.department), employeeName(app, row.requested_by), ...lines.map((line) => itemName(app, line.item))].join(' ').toLowerCase().includes(query.toLowerCase())
  })
  const formatDate = (value: unknown) => value ? new Date(id(value)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  useEffect(() => {
    if (!selected) { setDestinationStore(''); setLineValues({}); return }
    const defaultStore = id(selected.store || (app.data.locations.length === 1 ? app.data.locations[0]?.id : ''))
    setDestinationStore(defaultStore)
    const next: Record<string, { quantity: string; note: string }> = {}
    linesFor(selected).forEach((line: Row) => {
      const limit = num(line.hod_approved_quantity ?? line.base_quantity_requested ?? line.quantity_requested)
      const saved = num(line.quantity_approved)
      const rejected = Boolean(id(line.rejection_stage))
      next[id(line.id)] = { quantity: id(rejected ? 0 : saved > 0 ? saved : limit), note: id(line.storekeeper_comment || line.rejection_reason) }
    })
    setLineValues(next)
  }, [selected, app.data.locations, linesFor])

  if (selected) {
    const lines = linesFor(selected)
    const active = id(selected.status) === 'submitted'
    const valid = Boolean(destinationStore) && lines.length > 0 && lines.every((line: Row) => {
      const limit = num(line.hod_approved_quantity ?? line.base_quantity_requested ?? line.quantity_requested)
      const value = num(lineValues[id(line.id)]?.quantity)
      const note = id(lineValues[id(line.id)]?.note).trim()
      return value >= 0 && value <= limit && (limit === 0 || value > 0 || Boolean(note))
    }) && lines.some((line: Row) => num(lineValues[id(line.id)]?.quantity) > 0)
    const forward = async () => {
      if (!active || !valid) return
      const ok = await execute(async () => {
        if (id(selected.store) !== destinationStore) await runBackendAction('store-requisitions', id(selected.id), 'assign-store', { store: destinationStore })
        for (const line of lines) {
          const value = lineValues[id(line.id)] || { quantity: '0', note: '' }
          const hodLimit = num(line.hod_approved_quantity ?? line.base_quantity_requested ?? line.quantity_requested)
          if (num(value.quantity) === 0 && hodLimit > 0) {
            await runBackendAction('store-requisition-items', id(line.id), 'reject-line', { reason: id(value.note).trim() })
          } else {
            await updateBackendRecord('store-requisition-items', id(line.id), { quantity_approved: num(value.quantity), storekeeper_comment: id(value.note).trim() })
          }
        }
        await runBackendAction('store-requisitions', id(selected.id), 'send-to-procurement', {})
      }, `Requisition ${id(selected.requisition_no)} forwarded to Procurement`)
      if (ok) onSelect(null)
    }
    return <div style={{ display: 'grid', gap: 14 }}>
      <div><button type="button" onClick={() => onSelect(null)} style={{ ...secondary, width: 'fit-content' }}><Icon name="arrow_back" size={16} />Back to Store Keeper queue</button></div>
      <section style={{ ...card, overflow: 'hidden' }}>
        <header style={{ padding: '18px 20px', display: 'flex', gap: 14, alignItems: 'flex-start', borderBottom: '1px solid var(--border)' }}><span style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 9, background: 'var(--accent-soft)' }}><Icon name="warehouse" size={21} color="var(--accent)" /></span><div><div style={{ color: 'var(--text-faint)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Department requisition</div><h2 style={{ margin: '3px 0 0', fontSize: 22 }}>{id(selected.requisition_no)}</h2></div><StatusBadge value={id(selected.status)} /></header>
        <div style={{ padding: 20 }}>
          <div className="storekeeper-request-meta" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginBottom: 18 }}><InfoBox label="Requested by" value={employeeName(app, selected.requested_by) || 'Requester'} /><InfoBox label="Department" value={departmentName(app, selected.department)} /><InfoBox label="Date" value={formatDate(selected.created_at)} /></div>
          <div style={{ maxWidth: 520, marginBottom: 18 }}>
            <label style={labelStyle}>Issuing store</label>
            {active ? <select value={destinationStore} onChange={(event) => setDestinationStore(event.target.value)} style={control}><option value="">Select issuing store</option>{app.data.locations.map((store: Row) => <option key={id(store.id)} value={id(store.id)}>{storeOptionLabel(store)}</option>)}</select> : <div style={{ ...control, height: 'auto', minHeight: 44, display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'var(--surface-2)' }}><strong>{requestStoreName(app, selected)}</strong><small style={{ marginTop: 3, color: 'var(--text-muted)' }}>{requestStoreLocation(app, selected)}</small></div>}
            {active && destinationStore && <div style={{ marginTop: 7, color: 'var(--text-muted)', fontSize: 11.5 }}><b style={{ color: 'var(--text-faint)' }}>Location:</b> {storeLocation(app, destinationStore) || 'Not recorded'}</div>}
          </div>
          <div style={{ marginBottom: 9, display: 'flex', alignItems: 'baseline', gap: 8 }}><h3 style={{ margin: 0, fontSize: 14 }}>Items</h3><span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{lines.length} item{lines.length === 1 ? '' : 's'}</span></div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div className="storekeeper-items-head" style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,1.35fr) 90px 105px 135px 90px minmax(150px,1fr) 115px', gap: 10, padding: '9px 13px', background: 'var(--surface-2)', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}><span>Article</span><span>Requested</span><span>HOD approved</span><span>Forward</span><span>UOM</span><span>Note / reason</span><span>Decision</span></div>
            {lines.map((line: Row) => {
              const article = app.data.items.find((item: Row) => id(item.id) === id(line.item)); const uom = unitNames.get(id(line.unit || article?.baseUnitId)) || id(article?.uom) || '—'; const requested = num(line.base_quantity_requested || line.quantity_requested); const hodLimit = num(line.hod_approved_quantity ?? requested); const value = lineValues[id(line.id)] || { quantity: id(line.quantity_approved || hodLimit), note: id(line.storekeeper_comment) }
              const lineRejected = num(value.quantity) === 0
              return <div key={id(line.id)} className="storekeeper-items-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,1.35fr) 90px 105px 135px 90px minmax(150px,1fr) 115px', gap: 10, padding: 13, borderTop: '1px solid var(--border)', alignItems: 'center', fontSize: 12 }}><span style={{ fontWeight: 750 }}>{itemName(app, line.item)}</span><span>{requested}</span><span style={{ fontWeight: 800 }}>{hodLimit}</span>{active ? <input type="number" min="0" max={hodLimit} step="0.01" disabled={hodLimit === 0} value={value.quantity} onChange={(event) => setLineValues({ ...lineValues, [id(line.id)]: { ...value, quantity: event.target.value, note: num(event.target.value) > 0 && id(line.rejection_stage) === 'Store Keeper' ? '' : value.note } })} style={{ ...control, height: 36 }} /> : <span style={{ fontWeight: 800 }}>{id(line.quantity_approved)}</span>}<span style={{ color: 'var(--text-muted)' }}>{uom}</span>{active ? <input value={value.note} placeholder={lineRejected && hodLimit > 0 ? 'Reason required' : 'Optional'} onChange={(event) => setLineValues({ ...lineValues, [id(line.id)]: { ...value, note: event.target.value } })} style={{ ...control, height: 36 }} /> : <span style={{ color: 'var(--text-muted)' }}>{id(line.storekeeper_comment || line.rejection_reason) || '—'}</span>}{active ? (hodLimit === 0 ? <span style={{ color: 'var(--bad)', fontSize: 10.5, fontWeight: 750 }}>HOD rejected</span> : lineRejected ? <button type="button" onClick={() => setLineValues({ ...lineValues, [id(line.id)]: { quantity: id(hodLimit), note: '' } })} style={{ ...secondary, height: 30, justifyContent: 'center' }}>Keep item</button> : <button type="button" onClick={() => setLineValues({ ...lineValues, [id(line.id)]: { quantity: '0', note: value.note } })} style={{ ...secondary, height: 30, justifyContent: 'center', color: 'var(--bad)', borderColor: 'rgba(220,38,38,.35)' }}>Reject item</button>) : <span style={{ color: id(line.rejection_stage) ? 'var(--bad)' : 'var(--text-muted)', fontSize: 10.5 }}>{id(line.rejection_stage) || 'Kept'}</span>}</div>
            })}
          </div>
          {active && showRejectAll && <div style={{ marginTop: 14, padding: 13, border: '1px solid rgba(220,38,38,.25)', borderRadius: 8, background: 'var(--bad-soft)' }}><label style={{ ...labelStyle, color: 'var(--bad)' }}>Reason for rejecting the whole requisition *</label><textarea value={rejectAllReason} onChange={(event) => setRejectAllReason(event.target.value)} rows={3} placeholder="Explain why the entire requisition should not proceed" style={{ ...control, minHeight: 80, padding: 10, resize: 'vertical' }} /></div>}
        </div>
        {active && <footer style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', gap: 9, borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}><div>{!showRejectAll ? <button type="button" disabled={busy} onClick={() => setShowRejectAll(true)} style={{ ...secondary, color: 'var(--bad)', borderColor: 'rgba(220,38,38,.35)' }}>Reject entire requisition</button> : <div style={{ display: 'flex', gap: 8 }}><button type="button" disabled={busy} onClick={() => { setShowRejectAll(false); setRejectAllReason('') }} style={secondary}>Cancel</button><button type="button" disabled={busy || !rejectAllReason.trim()} onClick={() => void execute(() => runBackendAction('store-requisitions', id(selected.id), 'reject', { reason: rejectAllReason.trim() }), `Requisition ${id(selected.requisition_no)} rejected`).then((ok) => { if (ok) onSelect(null) })} style={{ ...secondary, color: '#fff', background: 'var(--bad)', borderColor: 'var(--bad)', opacity: busy || !rejectAllReason.trim() ? .5 : 1 }}>Confirm rejection</button></div>}</div><button type="button" disabled={busy || !valid} onClick={() => void forward()} style={{ ...secondary, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)', opacity: busy || !valid ? .5 : 1 }}><Icon name="send" size={16} color="#fff" />Forward to Procurement</button></footer>}
      </section>
    </div>
  }

  return <section style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '15px 17px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}><div><div style={{ fontSize: 13, fontWeight: 800 }}>Store Keeper queue</div><div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11 }}>{pending.length} request{pending.length === 1 ? '' : 's'} need action</div></div><div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}><button type="button" onClick={() => setSection('pending')} style={{ ...secondary, height: 32, color: section === 'pending' ? 'var(--accent)' : 'var(--text-muted)', borderColor: section === 'pending' ? 'var(--accent)' : 'var(--border)', background: section === 'pending' ? 'var(--accent-soft)' : 'var(--surface)' }}>Pending ({pending.length})</button><button type="button" onClick={() => setSection('history')} style={{ ...secondary, height: 32, color: section === 'history' ? 'var(--accent)' : 'var(--text-muted)', borderColor: section === 'history' ? 'var(--accent)' : 'var(--border)', background: section === 'history' ? 'var(--accent-soft)' : 'var(--surface)' }}>Processed</button></div></div>
    <div style={{ padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requisition, department, requester or item..." style={{ ...control, maxWidth: 520 }} /></div>
    {rows.length > 0 && <div className="storekeeper-queue-head" style={{ display: 'grid', gridTemplateColumns: '120px minmax(170px,1fr) minmax(170px,1fr) 140px minmax(230px,1.2fr) 110px', gap: 14, padding: '9px 17px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}><span>Requisition</span><span>Requester</span><span>Department</span><span>Date</span><span>Items</span><span></span></div>}
    {rows.map((row: Row) => { const lines = linesFor(row); const names = lines.slice(0, 2).map((line) => itemName(app, line.item)); const preview = names.length ? `${names.join(', ')}${lines.length > 2 ? ` +${lines.length - 2} more` : ''}` : 'No items'; return <div key={id(row.id)} className="storekeeper-queue-row" style={{ display: 'grid', gridTemplateColumns: '120px minmax(170px,1fr) minmax(170px,1fr) 140px minmax(230px,1.2fr) 110px', gap: 14, padding: '13px 17px', alignItems: 'center', borderBottom: '1px solid var(--border)' }}><button type="button" onClick={() => onSelect(row)} style={{ padding: 0, border: 0, background: 'transparent', color: 'var(--accent)', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>{id(row.requisition_no)}</button><span style={{ fontSize: 12, fontWeight: 700 }}>{employeeName(app, row.requested_by) || 'Requester'}</span><span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{departmentName(app, row.department)}</span><span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{formatDate(row.created_at)}</span><span><b style={{ display: 'block', fontSize: 11.5 }}>{lines.length} item{lines.length === 1 ? '' : 's'}</b><small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</small></span><button type="button" onClick={() => onSelect(row)} style={{ ...secondary, height: 32, justifyContent: 'center', color: 'var(--accent)', borderColor: 'var(--accent)' }}>{section === 'pending' ? 'Review' : 'View'}</button></div> })}
    {!rows.length && <div style={{ padding: 48, textAlign: 'center' }}><Icon name={section === 'pending' ? 'check_circle' : 'history'} size={30} color={section === 'pending' ? 'var(--good)' : 'var(--text-faint)'} /><div style={{ marginTop: 9, fontSize: 13, fontWeight: 800 }}>{section === 'pending' ? "You're all caught up" : 'No processed requests yet'}</div><div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11.5 }}>{section === 'pending' ? 'No department requisitions currently need Store Keeper action.' : 'Requests forwarded to Procurement will remain visible here.'}</div></div>}
  </section>
}

function RequestPanel({ app, data, form, setForm, busy, execute, stage }: any) {
  const requestBackendId = (row: Row) => id(row.apiId || row.id)
  // Selects and workflow actions must use the backend UUID, not the formatted
  // requisition number shown to users (for example SR-2026-00001).
  const draftRequest = data.requests.find((row: Row) => requestBackendId(row) === id(form.request))
  const draftLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(form.request))
  const draftLine = draftLines.find((row: Row) => id(row.id) === id(form.requestLine))
  const departmentPending = data.requests.find((row: Row) => id(row.id) === id(form.departmentPending))
  const departmentLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(form.departmentPending))
  const submittedRequest = data.requests.find((row: Row) => id(row.id) === id(form.submitted))
  const submittedLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(form.submitted))
  const decisionLine = submittedLines.find((row: Row) => id(row.id) === id(form.decisionLine))
  const selectedStoreId = id(form.destinationStore || submittedRequest?.store)
  const decisionBalance = decisionLine ? data.balances.find((row: Row) => id(row.item) === id(decisionLine.item) && id(row.store) === selectedStoreId) : undefined
  const availableNow = num(decisionBalance?.available_quantity ?? decisionBalance?.available ?? 0)
  const shortageRequest = data.requests.find((row: Row) => id(row.id) === id(form.shortageRequest))
  const shortageLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(form.shortageRequest))
  const readyForProcurement = data.requests.filter((request: Row) => isReadyForProcurement(request, data.requestItems))
  const decisionsComplete = submittedLines.length > 0 && submittedLines.every((line: Row) => num(line.quantity_approved) > 0 || Boolean(id(line.storekeeper_comment).trim()))
  const hasApprovedQuantity = submittedLines.some((line: Row) => num(line.quantity_approved) > 0)
  const stageMeta: Record<SupplyTask, { title: string; note: string }> = {
    prepare: { title: 'New request', note: 'Add requested articles and quantities before submission.' },
    department: { title: 'Department approval', note: 'Review the request before releasing it to the Store Keeper.' },
    stores: { title: 'Department request hand-off', note: 'Confirm approved quantities and forward the requisition to Procurement.' },
    shortage: { title: 'Create Store Requisition', note: 'Prepare the Store Keeper requisition and forward it to Procurement.' },
    issue: { title: 'Pick and issue', note: 'Approved requests ready for issue.' },
  }
  const meta = stageMeta[stage as SupplyTask] || stageMeta.prepare

  if (stage === 'prepare') {
    return <RequesterDraftEditor
      app={app}
      data={data}
      form={form}
      setForm={setForm}
      busy={busy}
      execute={execute}
      draftRequest={draftRequest}
      draftLines={draftLines}
      draftLine={draftLine}
      requestBackendId={requestBackendId}
    />
  }

  return <Panel title={meta.title} note={meta.note}>
    {stage === 'department' && <>
      <Field label="Request awaiting approval"><Select value={form.departmentPending} change={(v) => setForm({ departmentPending: v })} rows={data.requests.filter((r: Row) => id(r.status) === 'pending_department_approval')} label={(r) => `${id(r.requisition_no)} · ${id(r.purpose) || departmentName(app, r.department)}`} /></Field>
      {!data.requests.some((r: Row) => id(r.status) === 'pending_department_approval') && <Hint>No requests are waiting for Department Head approval.</Hint>}
      {departmentPending && <RequestSummary request={departmentPending} lines={departmentLines} data={data} app={app} />}
      <Field label="Approval comment"><Input value={form.departmentComment} change={(v) => setForm({ ...form, departmentComment: v })} /></Field>
      <Action tone="good" disabled={busy || !departmentPending} click={() => execute(() => runBackendAction('store-requisitions', id(form.departmentPending), 'department-approve', { comments: form.departmentComment || '' }), 'Request approved and sent to the Store Keeper')}>Approve requisition</Action>
      <Rule />
      <Field label="Rejection reason"><Input value={form.departmentReason} change={(v) => setForm({ ...form, departmentReason: v })} /></Field>
      <Action tone="danger" disabled={busy || !departmentPending || !id(form.departmentReason).trim()} click={() => execute(() => runBackendAction('store-requisitions', id(form.departmentPending), 'reject', { reason: form.departmentReason || '' }), 'Request returned to the requester')}>Reject request</Action>
    </>}

    {stage === 'stores' && <>
      <Field label="Department request"><Select value={form.submitted} change={(v) => { const request = data.requests.find((r: Row) => id(r.id) === v); setForm({ submitted: v, destinationStore: request?.store || '' }) }} rows={data.requests.filter((r: Row) => id(r.status) === 'submitted')} label={(r) => `${id(r.requisition_no)} · ${departmentName(app, r.department)}`} /></Field>
      {!data.requests.some((r: Row) => id(r.status) === 'submitted') && <Hint>No submitted Department requisitions are waiting for Store Keeper action.</Hint>}
      {submittedRequest && <RequestSummary request={submittedRequest} lines={submittedLines} data={data} app={app} />}
      <Field label="Issuing store"><Select value={form.destinationStore || submittedRequest?.store || ''} change={(v) => setForm({ ...form, destinationStore: v })} rows={app.data.locations} label={storeOptionLabel} emptyLabel="Select issuing store" /></Field>
      <Action disabled={busy || !submittedRequest || !form.destinationStore} click={() => execute(() => runBackendAction('store-requisitions', id(form.submitted), 'assign-store', { store: form.destinationStore }), 'Issuing store confirmed', { submitted: form.submitted, destinationStore: form.destinationStore })}>Confirm issuing store</Action>
      <Rule />
      <Field label="Item to review"><Select value={form.decisionLine} change={(v) => { const line = submittedLines.find((r: Row) => id(r.id) === v); setForm({ ...form, decisionLine: v, approved: num(line?.quantity_approved) > 0 ? line?.quantity_approved : line?.base_quantity_requested || '', decisionComment: line?.storekeeper_comment || '' }) }} rows={submittedLines} label={(r) => `${itemName(app, r.item)} · requested ${r.base_quantity_requested}`} /></Field>
      {decisionLine && <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginBottom: 10 }}>
        <InfoBox label="Department requested" value={num(decisionLine.base_quantity_requested)} />
        <InfoBox label="Available in selected store" value={availableNow} />
        <InfoBox label="Store Keeper forwards" value={num(form.approved || decisionLine.quantity_approved || decisionLine.base_quantity_requested)} />
      </section>}
      <Field label="Quantity to carry forward"><Input type="number" value={form.approved} change={(v) => setForm({ ...form, approved: v })} /></Field>
      {decisionLine && <Hint>Enter the quantity to forward. It cannot exceed the Department request.</Hint>}
      <Field label="Decision comment"><Input value={form.decisionComment} change={(v) => setForm({ ...form, decisionComment: v })} /></Field>
      <Action disabled={busy || !decisionLine || num(form.approved) < 0 || num(form.approved) > num(decisionLine?.base_quantity_requested) || (num(form.approved) === 0 && !id(form.decisionComment).trim())} click={() => execute(() => updateBackendRecord('store-requisition-items', id(decisionLine?.id), { quantity_approved: num(form.approved), storekeeper_comment: form.decisionComment || '' }), 'Store Keeper quantity saved', { submitted: form.submitted })}>Save this item decision</Action>
      <Rule />
      {!decisionsComplete && submittedRequest && <Hint>Confirm every requested line before forwarding the request to Procurement.</Hint>}
      {decisionsComplete && !hasApprovedQuantity && <Hint>At least one line must carry a quantity before this request can move forward.</Hint>}
      
      
    </>}

    {stage === 'shortage' && <>
      <div style={{ marginBottom: 12, color: 'var(--text)', fontSize: 13, fontWeight: 800 }}>Create Store Requisition and forward to Procurement</div>
      <Field label="Prepared Store Requisition"><Select value={form.shortageRequest} change={(v) => setForm({ shortageRequest: v })} rows={readyForProcurement} label={(r) => `${id(r.requisition_no)} · ${departmentName(app, r.department)}`} /></Field>
      {!readyForProcurement.length && <Hint>No Store Requisitions have completed the destination and quantity checks.</Hint>}
      {shortageRequest && <RequestSummary request={shortageRequest} lines={shortageLines} data={data} app={app} />}
      <Field label="Store Keeper note to Procurement"><Input value={form.shortageReason} change={(v) => setForm({ ...form, shortageReason: v })} /></Field>
      <Action disabled={busy || !form.shortageRequest || !id(form.shortageReason).trim()} click={() => execute(() => runBackendAction('store-requisitions', id(form.shortageRequest), 'send-to-procurement', { reason: form.shortageReason || '' }), 'Store Requisition created and forwarded to Procurement')}>Create Store Requisition & Forward</Action>
      
    </>}
  </Panel>
}


function RequesterDraftEditor({ app, data, form, setForm, busy, execute, draftRequest, draftLines, draftLine, requestBackendId }: any) {
  if (!draftRequest) {
    return <section style={{ ...card, padding: 28 }}>
      <button type="button" onClick={() => setForm({})} style={{ ...secondary, marginBottom: 18 }}><Icon name="arrow_back" size={17} />Back to my requisitions</button>
      <div style={{ padding: 30, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
        <Icon name="description" size={30} color="var(--text-faint)" />
        <div style={{ marginTop: 9, color: 'var(--text)', fontSize: 14, fontWeight: 800 }}>Requisition not available</div>
        <div style={{ marginTop: 5, color: 'var(--text-muted)', fontSize: 12 }}>Return to My requisitions and open an editable draft.</div>
      </div>
    </section>
  }

  const uomNames = new Map<string, string>(app.data.uoms.map((row: Row): [string, string] => [id(row.id), id(row.name)]))
  const requestStores = data.storeOptions?.length ? data.storeOptions : app.data.locations
  const selectedStoreId = id(form.requestStore ?? draftRequest.store)
  const selectedStore = requestStores.find((row: Row) => id(row.id) === selectedStoreId)
  const requestPurpose = id(form.requestPurpose ?? draftRequest.purpose)
  const requiredDate = id(form.requiredDate ?? draftRequest.required_date)
  const article = app.data.items.find((row: Row) => id(row.id) === id(form.item || draftLine?.item))
  const catalogueCategories = app.data.categories.filter((category: Row) => id(category.status).toLowerCase() !== 'inactive')
  const majorGroups = catalogueCategories.filter((category: Row) => !category.parentId).sort((a: Row, b: Row) => id(a.name).localeCompare(id(b.name)))
  const itemGroups = catalogueCategories.filter((category: Row) => id(category.parentId) === id(form.majorGroup)).sort((a: Row, b: Row) => id(a.name).localeCompare(id(b.name)))
  const selectableItems = app.data.items.filter((item: Row) => id(item.categoryId) === id(form.itemGroup)).sort((a: Row, b: Row) => id(a.name).localeCompare(id(b.name)))
  const selectedUom = uomNames.get(id(form.unit || draftLine?.unit || article?.baseUnitId)) || id(article?.uom) || 'Base unit'
  const createdLabel = draftRequest.created_at ? new Date(id(draftRequest.created_at)).toLocaleDateString() : 'Today'
  const clearItemForm = () => setForm({ ...form, requestLine: '', majorGroup: '', itemGroup: '', item: '', unit: '', quantity: '', note: '' })
  const editLine = (line: Row) => {
    const lineArticle = app.data.items.find((row: Row) => id(row.id) === id(line.item))
    const lineGroup = app.data.categories.find((category: Row) => id(category.id) === id(lineArticle?.categoryId))
    setForm({
      ...form,
      requestLine: id(line.id),
      majorGroup: lineGroup?.parentId || '',
      itemGroup: lineGroup?.id || '',
      item: line.item || '',
      unit: line.unit || lineArticle?.baseUnitId || '',
      quantity: line.quantity_requested || line.base_quantity_requested || '',
      note: line.remarks || '',
    })
  }
  const submitRequisition = () => execute(
    async () => {
      await updateBackendRecord('store-requisitions', requestBackendId(draftRequest), {
        store: selectedStoreId,
        purpose: requestPurpose.trim(),
        required_date: requiredDate || null,
      })
      return runBackendAction('store-requisitions', id(form.request), 'submit')
    },
    'Requisition submitted',
    {},
  )
  const selectRequestStore = (value: string) => {
    const nextForm = { ...form, requestStore: value }
    setForm(nextForm)
    void execute(
      () => updateBackendRecord('store-requisitions', requestBackendId(draftRequest), { store: value || null }),
      value ? 'Issuing store selected' : 'Issuing store cleared',
      nextForm,
    )
  }
  const canSubmit = Boolean(selectedStoreId) && draftLines.length > 0
  const submissionMessage = !selectedStoreId && !draftLines.length
    ? 'Select an issuing store and add at least one item.'
    : !selectedStoreId
      ? 'Select the store that will issue these items.'
      : !draftLines.length
        ? 'Add at least one item before submitting.'
        : 'Ready to send for Department Head approval.'

  return <div className="requester-requisition-editor">
    <section className="requester-requisition-document" style={{ ...card, overflow: 'hidden' }}>
      <header className="requester-document-header">
        <div className="requester-document-title-row">
          <button type="button" className="requester-document-back" onClick={() => setForm({})} style={secondary}><Icon name="arrow_back" size={17} />My requisitions</button>
          <div className="requester-document-title">
            <div>Department requisition</div>
            <h2>{id(draftRequest.requisition_no) || 'New requisition'}</h2>
          </div>
          <StatusBadge value={id(draftRequest.status)} />
        </div>
        <div className="requester-document-meta">
          <span><small>Department</small><strong>{app.user.departmentName || departmentName(app, draftRequest.department) || 'Your department'}</strong></span>
          <span><small>Requested by</small><strong>{app.user.name}</strong></span>
          <span><small>Created</small><strong>{createdLabel}</strong></span>
          <span><small>Items</small><strong>{draftLines.length}</strong></span>
        </div>
      </header>

      <div className="requester-progress" aria-label="Requisition preparation progress">
        <span className={selectedStoreId ? 'is-complete' : 'is-active'}><i>1</i><b>Requisition details</b></span>
        <span className={draftLines.length ? 'is-complete' : selectedStoreId ? 'is-active' : ''}><i>2</i><b>Add items</b></span>
        <span className={canSubmit ? 'is-active' : ''}><i>3</i><b>Review &amp; submit</b></span>
      </div>

      <div className="requester-document-section requester-document-details-section">
        <div className="requester-section-heading"><h3>Request details</h3></div>
        <div className="requester-document-details">
          <div className="requester-store-field">
            <Field label="Request from store *"><Select value={selectedStoreId} change={selectRequestStore} rows={requestStores} emptyLabel="Select issuing store" label={storeOptionLabel} /></Field>
            {selectedStore && <div className="requester-store-location"><span>Location</span>{id(selectedStore.address) || 'Not recorded'}</div>}
            {!requestStores.length && <div className="requester-field-error">No active stores are available for your branch.</div>}
          </div>
          <Field label="Required date"><Input type="date" value={requiredDate} change={(value) => setForm({ ...form, requiredDate: value })} /></Field>
          <Field label="Purpose / notes"><textarea value={requestPurpose} onChange={(event) => setForm({ ...form, requestPurpose: event.target.value })} rows={2} placeholder="What are the items needed for?" style={{ ...control, height: 66, padding: 10, resize: 'vertical' }} /></Field>
        </div>
      </div>

      <div className="requester-document-section requester-items-section">
        <div className="requester-section-heading"><h3>Items</h3><span>{draftLines.length} item{draftLines.length === 1 ? '' : 's'}</span></div>

      {draftLines.length > 0 && <>
        <div className="requester-items-table requester-items-head" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.6fr) 110px 120px minmax(180px,1fr) 86px', gap: 12, padding: '10px 18px', background: 'var(--surface-2)', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          <span>Article</span><span>Quantity</span><span>UOM</span><span>Note</span><span>Actions</span>
        </div>
        {draftLines.map((line: Row) => {
          const lineArticle = app.data.items.find((row: Row) => id(row.id) === id(line.item))
          const uom = uomNames.get(id(line.unit || lineArticle?.baseUnitId)) || id(lineArticle?.uom) || 'Base unit'
          return <div key={id(line.id)} className="requester-items-table" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.6fr) 110px 120px minmax(180px,1fr) 86px', gap: 12, padding: '13px 18px', alignItems: 'center', borderTop: '1px solid var(--border)', fontSize: 12 }}>
            <span style={{ minWidth: 0, color: 'var(--text)', fontWeight: 750 }}>{itemName(app, line.item)}</span>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{id(line.quantity_requested || line.base_quantity_requested || 0)}</span>
            <span style={{ color: 'var(--text-muted)' }}>{uom}</span>
            <span style={{ minWidth: 0, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{id(line.remarks) || '—'}</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => editLine(line)} title="Edit item" style={lineAction}><Icon name="edit" size={15} /></button>
              <button type="button" onClick={() => {
                if (!window.confirm(`Remove ${itemName(app, line.item)} from this requisition?`)) return
                void execute(() => deleteBackendPath('store-requisition-items', id(line.id)), 'Item removed', { request: form.request, requestLine: '', item: '', unit: '', quantity: '', note: '' })
              }} title="Remove item" style={{ ...lineAction, color: 'var(--bad)' }}><Icon name="delete" size={15} /></button>
            </span>
          </div>
        })}
      </>}

      <div className="requester-item-entry-wrap">
        <div className="requester-item-entry-heading">
          <div>{draftLine ? 'Edit item' : 'Add item'}</div>
          {draftLine && <button type="button" onClick={clearItemForm} style={{ ...secondary, marginLeft: 'auto', height: 32 }}>Cancel edit</button>}
        </div>
        {!majorGroups.length && <div role="alert" style={{ margin: '0 0 12px', padding: '10px 12px', border: '1px solid var(--warn)', borderRadius: 8, background: 'var(--warn-soft)', color: 'var(--text)', fontSize: 12, lineHeight: 1.45 }}><strong>Catalogue unavailable.</strong> Refresh the page and try again.</div>}
        <div className="requester-item-entry cascade" style={{ display: 'grid', gridTemplateColumns: 'minmax(145px,.85fr) minmax(150px,.9fr) minmax(190px,1.2fr) 90px 90px minmax(150px,.9fr) auto', gap: 10, alignItems: 'end' }}>
          <Field label="1. Major Group"><StablePicker value={form.majorGroup} change={(value) => setForm({ ...form, majorGroup: value, itemGroup: '', item: '', unit: '' })} rows={majorGroups} emptyLabel="Choose Major Group" searchPlaceholder="Search Major Groups…" /></Field>
          <Field label="2. Item Group"><StablePicker disabled={!form.majorGroup} value={form.itemGroup} change={(value) => setForm({ ...form, itemGroup: value, item: '', unit: '' })} rows={itemGroups} emptyLabel={form.majorGroup ? 'Choose Item Group' : 'Select Major Group first'} searchPlaceholder="Search Item Groups…" /></Field>
          <Field label="3. Target Item"><StablePicker disabled={!form.itemGroup} value={form.item} change={(value) => { const selected = app.data.items.find((row: Row) => id(row.id) === value); setForm({ ...form, item: value, unit: selected?.baseUnitId || '', quantity: form.quantity || '', note: form.note || '' }) }} rows={selectableItems} emptyLabel={form.itemGroup ? 'Choose item' : 'Select Item Group first'} searchPlaceholder="Search items…" label={(row) => itemName(app, row.id)} /></Field>
          <Field label="Quantity"><Input type="number" value={form.quantity} change={(value) => setForm({ ...form, quantity: value })} /></Field>
          <div style={{ marginBottom: 10 }}><HelpLabel label="UOM" style={labelStyle} /><div style={{ ...control, display: 'flex', alignItems: 'center', background: 'var(--surface-2)', color: form.item ? 'var(--text)' : 'var(--text-faint)' }}>{form.item ? selectedUom : '—'}</div></div>
          <Field label="Note (optional)"><Input value={form.note} change={(value) => setForm({ ...form, note: value })} /></Field>
          <div style={{ marginBottom: 10 }}>
            {draftLine ? <button type="button" disabled={busy || !form.item || num(form.quantity) <= 0} onClick={() => execute(() => updateBackendRecord('store-requisition-items', id(draftLine.id), { item: form.item, unit: form.unit || null, quantity_requested: num(form.quantity), remarks: id(form.note).trim() }), 'Item updated', { request: form.request, requestLine: '', majorGroup: '', itemGroup: '', item: '', unit: '', quantity: '', note: '' })} style={{ ...secondary, height: 38, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)', opacity: busy || !form.item || num(form.quantity) <= 0 ? .5 : 1 }}><Icon name="save" size={16} color="#fff" />Update</button> : <button type="button" disabled={busy || !form.item || num(form.quantity) <= 0} onClick={() => execute(() => createBackendRecord('store-requisition-items', { requisition: form.request, item: form.item, unit: form.unit || null, quantity_requested: num(form.quantity), quantity_approved: 0, quantity_issued: 0, remarks: id(form.note).trim() }), 'Item added', { request: form.request, majorGroup: '', itemGroup: '', item: '', unit: '', quantity: '', note: '', requestLine: '' })} style={{ ...secondary, height: 38, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)', opacity: busy || !form.item || num(form.quantity) <= 0 ? .5 : 1 }}><Icon name="add" size={16} color="#fff" />Add</button>}
          </div>
        </div>
        {article && <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 2, padding: '9px 11px', border: '1px solid var(--accent)', borderRadius: 7, background: 'var(--accent-soft)', color: 'var(--text)', fontSize: 11.5 }}><Icon name="monitoring" size={17} color="var(--accent)" /><strong>Stock info</strong><span>Min: {num(article.reorder)}</span><span>Current: {num(article.onHand)}</span><span>Max: {article.maximumLevel == null ? '—' : num(article.maximumLevel)}</span></div>}
      </div>
      </div>

      <footer className="requester-editor-actions">
        <button type="button" disabled={busy} onClick={() => {
          if (!window.confirm(`Delete ${id(draftRequest.requisition_no)}?`)) return
          void execute(() => deleteBackendPath('store-requisitions', requestBackendId(draftRequest)), 'Draft deleted', {})
        }} style={{ ...secondary, color: 'var(--bad)', borderColor: 'rgba(220,38,38,.3)' }}><Icon name="delete" size={16} color="var(--bad)" />Delete draft</button>
        <div className={canSubmit ? 'requester-submit-note ready' : 'requester-submit-note'}><Icon name={canSubmit ? 'check_circle' : 'info'} size={16} />{submissionMessage}</div>
        <button type="button" disabled={busy || !canSubmit} onClick={() => void submitRequisition()} style={{ ...secondary, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)', opacity: busy || !canSubmit ? .5 : 1 }}><Icon name="send" size={16} color="#fff" />Submit requisition</button>
      </footer>
    </section>
  </div>
}

function RequestSummary({ request, lines, data, app, showAvailability = false, showOperationalContext = false, editable = false, onEditLine, onRemoveLine }: { request: Row; lines: Row[]; data: Record<string, Row[]>; app: any; showAvailability?: boolean; showOperationalContext?: boolean; editable?: boolean; onEditLine?: (line: Row) => void; onRemoveLine?: (line: Row) => void }) {
  const columns = showAvailability
    ? 'minmax(165px,1.35fr) minmax(105px,.8fr) repeat(5,minmax(72px,.55fr))'
    : editable
      ? 'minmax(165px,1.35fr) minmax(105px,.8fr) repeat(4,minmax(72px,.55fr)) 82px'
      : 'minmax(165px,1.35fr) minmax(105px,.8fr) repeat(4,minmax(72px,.55fr))'
  const categoryOf = (line: Row) => id(line.category_name) || id(app.data.items.find((r: Row) => id(r.id) === id(line.item))?.category) || 'Uncategorised'
  const lineStatus = (line: Row, available: number) => {
    const requested = num(line.base_quantity_requested || line.quantity_requested)
    const approved = num(line.quantity_approved)
    const issued = num(line.quantity_issued)
    if (issued >= approved && approved > 0) return { label: 'Issued', tone: 'var(--good)', bg: 'var(--good-soft)' }
    if (issued > 0) return { label: 'Partially issued', tone: 'var(--warn)', bg: 'var(--warn-soft)' }
    if (id(request.status) === 'pending_department_approval') return { label: 'Pending HOD', tone: 'var(--warn)', bg: 'var(--warn-soft)' }
    if (approved > 0 && available < Math.max(0, approved - issued)) return { label: 'Shortage', tone: 'var(--bad)', bg: 'var(--bad-soft)' }
    if (approved > 0) return { label: approved < requested ? 'Reduced' : 'Carried forward', tone: 'var(--accent)', bg: 'var(--accent-soft)' }
    return { label: 'Pending decision', tone: 'var(--text-muted)', bg: 'var(--surface-3)' }
  }
  const categoryCount = new Set(lines.map(categoryOf)).size
  const shortageLines = showAvailability ? lines.flatMap((line: Row) => {
    const balance = data.balances.find((row: Row) => id(row.item) === id(line.item) && id(row.store) === id(request.store))
    const available = num(balance?.available_quantity)
    const outstanding = Math.max(0, num(line.quantity_approved) - num(line.quantity_issued))
    const shortage = Math.max(0, outstanding - available)
    return shortage > 0 ? [{ article: itemName(app, line.item), shortage, available, outstanding }] : []
  }) : []
  return <section style={{ marginBottom: 14, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ padding: '12px 13px', display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--surface-2)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 800 }}>{id(request.requisition_no)}</div>
        <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11 }}>{departmentName(app, request.department)}{id(request.purpose) ? ` · ${id(request.purpose)}` : ''}</div>
        {showOperationalContext && <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: '5px 14px', color: 'var(--text-muted)', fontSize: 11.5 }}>
          <span><b style={{ color: 'var(--text)' }}>Requester:</b> {employeeName(app, request.requested_by) || 'Not recorded'}</span>
          <span><b style={{ color: 'var(--text)' }}>Required:</b> {id(request.required_date || request.requiredDate) || 'Not specified'}</span>
          <span><b style={{ color: 'var(--text)' }}>Issuing store:</b> {requestStoreName(app, request)}</span>
          <span><b style={{ color: 'var(--text)' }}>Location:</b> {requestStoreLocation(app, request)}</span>
        </div>}
        {lines.length > 0 && <div style={{ marginTop: 5, color: 'var(--text-faint)', fontSize: 10.5 }}>{lines.length} item{lines.length === 1 ? '' : 's'} across {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}</div>}
      </div>
      <StatusBadge value={id(request.status)} />
    </div>
    <div className="request-summary-grid" style={{ display: 'grid', gridTemplateColumns: columns, padding: '8px 12px', color: 'var(--text-faint)', background: 'var(--surface)', borderTop: '1px solid var(--border)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>
      <span>Article</span><span>Category</span><span>Requested</span>{showAvailability && <span>Available</span>}<span>Carried forward</span><span>Issued</span><span>Status</span>{editable && <span>Actions</span>}
    </div>
    {lines.map((line: Row) => {
      const balance = data.balances.find((row: Row) => id(row.item) === id(line.item) && id(row.store) === id(request.store))
      const available = num(balance?.available_quantity)
      const state = lineStatus(line, available)
      return <div key={id(line.id)} className="request-summary-grid" style={{ display: 'grid', gridTemplateColumns: columns, gap: 8, padding: '11px 12px', borderTop: '1px solid var(--border)', fontSize: 11.5, alignItems: 'center' }}>
        <span style={{ minWidth: 0, color: 'var(--text)', fontWeight: 700 }}>{itemName(app, line.item)}{line.remarks && <small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontSize: 10, fontWeight: 500 }}>Note: {id(line.remarks)}</small>}</span>
        <span style={{ color: 'var(--text-muted)' }}>{categoryOf(line)}</span>
        <span>{id(line.base_quantity_requested || line.quantity_requested || 0)}</span>
        {showAvailability && <span style={{ color: available >= num(line.base_quantity_requested || line.quantity_requested) ? 'var(--good)' : 'var(--warn)', fontWeight: 750 }}>{available}</span>}
        <span>{id(line.quantity_approved || 0)}</span><span>{id(line.quantity_issued || 0)}</span>
        <span><span style={{ display: 'inline-flex', padding: '3px 7px', borderRadius: 999, color: state.tone, background: state.bg, fontSize: 9.5, fontWeight: 800 }}>{state.label}</span></span>
        {editable && <span style={{ display: 'flex', gap: 5 }}><button type="button" onClick={() => onEditLine?.(line)} title="Edit item" style={lineAction}><Icon name="edit" size={15} /></button><button type="button" onClick={() => onRemoveLine?.(line)} title="Remove item" style={{ ...lineAction, color: 'var(--bad)' }}><Icon name="delete" size={15} /></button></span>}
      </div>
    })}
    {showOperationalContext && shortageLines.length > 0 && <div style={{ padding: '11px 13px', borderTop: '1px solid rgba(220,38,38,.2)', background: 'var(--bad-soft)', color: 'var(--bad)', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}><Icon name="warning" size={16} color="var(--bad)" />Stock shortage — do not complete this issue yet</div>
      {shortageLines.map((line) => <div key={line.article} style={{ marginTop: 3 }}>{line.article}: {line.outstanding} outstanding, {line.available} available, {line.shortage} short.</div>)}
    </div>}
    {showOperationalContext && lines.length > 0 && shortageLines.length === 0 && <div style={{ padding: '10px 13px', borderTop: '1px solid rgba(22,163,74,.2)', background: 'var(--good-soft)', color: 'var(--good)', fontSize: 12, fontWeight: 650 }}><Icon name="check_circle" size={15} color="var(--good)" style={{ verticalAlign: 'middle', marginRight: 6 }} />Available stock covers every outstanding approved quantity.</div>}
    {!lines.length && <div style={{ padding: 24, borderTop: '1px solid var(--border)', color: 'var(--text-faint)', textAlign: 'center', fontSize: 11.5 }}>No items have been added.</div>}
  </section>
}

function IssuePanel({ app, data, form, setForm, busy, execute }: any) {
  const approved = data.requests.filter((row: Row) => ['approved', 'partially_approved', 'partially_issued'].includes(id(row.status)))
  const request = data.requests.find((row: Row) => id(row.id) === id(form.request))
  const requestLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(form.request))
  const issue = data.issues.find((row: Row) => id(row.id) === id(form.issue))
  const issueRequestLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(issue?.requisition))
  return <Panel title="Pick and issue" note="Process approved stock issues.">
    <SectionLabel>Issue voucher</SectionLabel>
    <Field label="Approved department request"><Select value={form.request} change={(v) => setForm({ request: v })} rows={approved} label={(r) => `${id(r.requisition_no)} · ${departmentName(app, r.department)}`} /></Field>
    {!approved.length && <Hint>No approved department requests are ready for picking.</Hint>}
    {request && <RequestSummary request={request} lines={requestLines} data={data} app={app} showAvailability showOperationalContext />}
    {request && (app.user.isSuperuser || ['administrator', 'system administrator', 'store keeper'].includes(id(app.user.role).toLowerCase())) && <button type="button" disabled={busy} onClick={() => execute(() => runBackendAction('store-requisitions', id(request.id), 'cancel'), 'Request cancelled and outstanding stock reservations released')} style={{ ...secondary, width: '100%', justifyContent: 'center', marginBottom: 12, color: 'var(--bad)', borderColor: 'rgba(220,38,38,.3)' }}><Icon name="cancel" size={17} color="var(--bad)" />Cancel request and release reservation</button>}
    <Field label="Issued by"><Select value={form.employee} change={(v) => setForm({ ...form, employee: v })} rows={app.data.employees} /></Field>
    <Action disabled={busy || !request || !form.employee} click={() => execute(() => createBackendRecord('stock-issues', { requisition: request.id, store: request.store, issued_by: form.employee, note: '' }), 'Issue voucher created')}>Create issue voucher</Action>
    {!requestLines.length && form.request && <Hint>No approved lines exist on this requisition.</Hint>}
    <Rule />
    <SectionLabel>Pick list</SectionLabel>
    <Field label="Draft issue voucher"><Select value={form.issue} change={(v) => setForm({ issue: v })} rows={data.issues.filter((row: Row) => !row.inventory_changes_applied)} label={(r) => id(r.issue_no)} /></Field>
    <Field label="Approved item to pick"><Select value={form.requestLine} change={(v) => setForm({ ...form, requestLine: v })} rows={issueRequestLines} label={(r) => `${itemName(app, r.item)} · ${r.outstanding_quantity} outstanding`} /></Field>
    <Field label="Pick quantity"><Input type="number" value={form.quantity} change={(v) => setForm({ ...form, quantity: v })} /></Field>
    <Action disabled={busy || !form.issue || !form.requestLine || num(form.quantity) <= 0} click={() => execute(() => createBackendRecord('stock-issue-items', { issue: form.issue, requisition_item: form.requestLine, unit: null, quantity: num(form.quantity) }), 'Article added to pick list', { issue: form.issue })}>Add item to pick list</Action>
    <Rule />
    <SectionLabel>Dispatch</SectionLabel>
    <Action tone="good" disabled={busy || !form.issue} click={() => execute(() => runBackendAction('stock-issues', id(form.issue), 'apply'), 'Stock issued and consumption posted')}>Post issue</Action>
    <Rule />
    <SectionLabel>Handover</SectionLabel>
    <Field label="Posted issue voucher"><Select value={form.postedIssue} change={(v) => setForm({ postedIssue: v })} rows={data.issues.filter((row: Row) => row.inventory_changes_applied && !row.received_by_name && !row.received_by)} label={(r) => id(r.issue_no)} /></Field>
    <Field label="Receiving employee"><Select value={form.receiver} change={(v) => setForm({ ...form, receiver: v })} rows={app.data.employees} optional /></Field>
    <Field label="Receiver name"><Input value={form.receiverName} change={(v) => setForm({ ...form, receiverName: v })} /></Field>
    <Action disabled={busy || !form.postedIssue || (!form.receiver && !id(form.receiverName).trim())} click={() => execute(() => runBackendAction('stock-issues', id(form.postedIssue), 'acknowledge', { received_by: form.receiver || null, received_by_name: form.receiverName || '' }), 'Department receipt acknowledged')}>Confirm department receipt</Action>
  </Panel>
}

function TransferPanel({ app, data, form, setForm, busy, execute }: any) {
  const transfer = data.transfers.find((r: Row) => id(r.id) === id(form.transfer))
  return <Panel title="Inter-store transfer" note="Move stock between stores.">
    <Field label="From store"><Select value={form.from} change={(v) => setForm({ ...form, from: v })} rows={app.data.locations} /></Field>
    <Field label="To store"><Select value={form.to} change={(v) => setForm({ ...form, to: v })} rows={app.data.locations} /></Field>
    <Action disabled={busy || !form.from || !form.to || form.from === form.to} click={() => execute(() => createBackendRecord('stock-transfers', { from_store: form.from, to_store: form.to, requested_by: form.employee || null, status: 'pending', note: '' }), 'Transfer created')}>Create transfer</Action>
    <Rule />
    <Field label="Transfer"><Select value={form.transfer} change={(v) => setForm({ transfer: v })} rows={data.transfers.filter((r: Row) => !r.inventory_changes_applied)} label={(r) => `${storeName(app, r.from_store)} → ${storeName(app, r.to_store)} · ${r.status}`} /></Field>
    <Field label="Article"><Select value={form.item} change={(v) => setForm({ ...form, item: v })} rows={app.data.items} /></Field>
    <Field label="Quantity"><Input type="number" value={form.quantity} change={(v) => setForm({ ...form, quantity: v })} /></Field>
    <Action disabled={busy || !form.transfer || !form.item || id(transfer?.status) !== 'pending'} click={() => execute(() => createBackendRecord('stock-transfer-items', { stock_transfer: form.transfer, item: form.item, unit: null, quantity: num(form.quantity) }), 'Transfer line added')}>Add transfer line</Action>
    <Action disabled={busy || !form.transfer || id(transfer?.status) !== 'pending' || Boolean(transfer?.approved_by)} click={() => execute(() => runBackendAction('stock-transfers', id(form.transfer), 'approve'), 'Transfer approved')}>Approve transfer</Action>
    <Action disabled={busy || !form.transfer || id(transfer?.status) !== 'pending' || !transfer?.approved_by} click={() => execute(() => runBackendAction('stock-transfers', id(form.transfer), 'dispatch'), 'Transfer dispatched')}>Dispatch from source</Action>
    <Action tone="good" disabled={busy || !form.transfer || id(transfer?.status) !== 'in_transit'} click={() => execute(() => runBackendAction('stock-transfers', id(form.transfer), 'receive'), 'Transfer received at destination')}>Confirm destination receipt</Action>
  </Panel>
}

function AdjustmentPanel({ app, data, form, setForm, busy, execute }: any) {
  return <Panel title="Controlled stock adjustment" note="Record authorised stock corrections.">
    <Field label="Store"><Select value={form.store} change={(v) => setForm({ ...form, store: v })} rows={app.data.locations} /></Field>
    <Field label="Reference"><Input value={form.reference} change={(v) => setForm({ ...form, reference: v })} /></Field>
    <Field label="Reason"><Input value={form.reason} change={(v) => setForm({ ...form, reason: v })} /></Field>
    <Action disabled={busy || !form.store} click={() => execute(() => createBackendRecord('stock-adjustments', { store: form.store, reference: form.reference || '', reason: form.reason || '', note: '', status: 'draft' }), 'Adjustment created')}>Create adjustment</Action>
    <Rule />
    <Field label="Adjustment"><Select value={form.adjustment} change={(v) => setForm({ adjustment: v })} rows={data.adjustments.filter((r: Row) => !['applied', 'cancelled'].includes(id(r.status)))} label={(r) => `${id(r.reference) || `Adjustment ${id(r.id).slice(0, 8)}`} · ${r.status}`} /></Field>
    <Field label="Article"><Select value={form.item} change={(v) => setForm({ ...form, item: v })} rows={app.data.items} /></Field>
    <Field label="Quantity change (+ / −)"><Input type="number" value={form.quantity} change={(v) => setForm({ ...form, quantity: v })} /></Field>
    <Action disabled={busy || !form.adjustment || !form.item} click={() => execute(() => createBackendRecord('stock-adjustment-items', { stock_adjustment: form.adjustment, item: form.item, unit: null, quantity_change: num(form.quantity), reason: form.reason || '' }), 'Adjustment line added')}>Add adjustment line</Action>
    <Action disabled={busy || !form.adjustment || id(data.adjustments.find((r: Row) => id(r.id) === id(form.adjustment))?.status) !== 'draft'} click={() => execute(() => runBackendAction('stock-adjustments', id(form.adjustment), 'submit'), 'Stock adjustment submitted')}>Submit adjustment</Action>
    <Action disabled={busy || !form.adjustment || id(data.adjustments.find((r: Row) => id(r.id) === id(form.adjustment))?.status) !== 'pending'} click={() => execute(() => runBackendAction('stock-adjustments', id(form.adjustment), 'approve'), 'Stock adjustment approved')}>Approve adjustment</Action>
    <Action tone="danger" disabled={busy || !form.adjustment || id(data.adjustments.find((r: Row) => id(r.id) === id(form.adjustment))?.status) !== 'pending'} click={() => execute(() => runBackendAction('stock-adjustments', id(form.adjustment), 'reject', { reason: form.reason || '' }), 'Stock adjustment rejected')}>Reject adjustment</Action>
    <Action tone="good" disabled={busy || !form.adjustment || id(data.adjustments.find((r: Row) => id(r.id) === id(form.adjustment))?.status) !== 'approved'} click={() => execute(() => runBackendAction('stock-adjustments', id(form.adjustment), 'apply'), 'Stock adjustment applied')}>Apply approved adjustment</Action>
  </Panel>
}

function CountPanel({ app, data, form, setForm, busy, execute }: any) {
  const countLines = data.countItems.filter((r: Row) => id(r.stock_count) === id(form.count))
  return <Panel title="Stock count" note="Record and reconcile physical counts.">
    <Field label="Store"><Select value={form.store} change={(v) => setForm({ ...form, store: v })} rows={app.data.locations} /></Field>
    <Field label="Conducted by"><Select value={form.employee} change={(v) => setForm({ ...form, employee: v })} rows={app.data.employees} /></Field>
    <Action disabled={busy || !form.store || !form.employee} click={() => execute(() => createBackendRecord('stock-counts', { store: form.store, conducted_by: form.employee, note: '' }), 'Stock count opened')}>Open stock count</Action>
    <Rule />
    <Field label="Stock count"><Select value={form.count} change={(v) => setForm({ count: v })} rows={data.counts.filter((r: Row) => !r.inventory_changes_applied)} label={(r) => `${id(r.count_no)} · ${r.status}`} /></Field>
    <Action disabled={busy || !form.count} click={() => execute(() => runBackendAction('stock-counts', id(form.count), 'populate'), 'System balances loaded')}>Populate count sheet</Action>
    <Field label="Count line"><Select value={form.countLine} change={(v) => { const line = countLines.find((r: Row) => id(r.id) === v); setForm({ ...form, countLine: v, physical: line?.physical_quantity }) }} rows={countLines} label={(r) => `${itemName(app, r.item)} · system ${r.system_quantity}`} /></Field>
    <Field label="Physical quantity"><Input type="number" value={form.physical} change={(v) => setForm({ ...form, physical: v })} /></Field>
    <Action disabled={busy || !form.countLine} click={() => execute(() => updateBackendRecord('stock-count-items', id(form.countLine), { physical_quantity: num(form.physical) }), 'Physical count saved')}>Save physical count</Action>
    <Action disabled={busy || !form.count} click={() => execute(() => runBackendAction('stock-counts', id(form.count), 'submit'), 'Stock count submitted')}>Submit count</Action>
    <Action disabled={busy || !form.count} click={() => execute(() => runBackendAction('stock-counts', id(form.count), 'approve'), 'Variance approved')}>Approve variance</Action>
    <Action tone="good" disabled={busy || !form.count} click={() => execute(() => runBackendAction('stock-counts', id(form.count), 'apply'), 'Count variances posted')}>Apply variance</Action>
  </Panel>
}

function ReturnPanel({ app, data, form, setForm, busy, execute }: any) {
  return <Panel title="Store return" note="Record returned items.">
    <Field label="Department"><Select value={form.department} change={(v) => setForm({ ...form, department: v })} rows={app.data.departments} /></Field>
    <Field label="Store"><Select value={form.store} change={(v) => setForm({ ...form, store: v })} rows={app.data.locations} /></Field>
    <Field label="Received by"><Select value={form.employee} change={(v) => setForm({ ...form, employee: v })} rows={app.data.employees} /></Field>
    <Field label="Reason"><Input value={form.reason} change={(v) => setForm({ ...form, reason: v })} /></Field>
    <Action disabled={busy || !form.department || !form.store || !form.employee} click={() => execute(() => createBackendRecord('store-returns', { department: form.department, store: form.store, received_by: form.employee, reason: form.reason || '' }), 'Store return created')}>Create return</Action>
    <Rule />
    <Field label="Return"><Select value={form.return} change={(v) => setForm({ return: v })} rows={data.returns.filter((r: Row) => !r.inventory_changes_applied)} label={(r) => id(r.return_no)} /></Field>
    <Field label="Article"><Select value={form.item} change={(v) => setForm({ ...form, item: v })} rows={app.data.items} /></Field>
    <Field label="Quantity"><Input type="number" value={form.quantity} change={(v) => setForm({ ...form, quantity: v })} /></Field>
    <Action disabled={busy || !form.return || !form.item} click={() => execute(() => createBackendRecord('store-return-items', { store_return: form.return, item: form.item, unit: null, quantity: num(form.quantity), condition_note: '' }), 'Return line added')}>Add returned Article</Action>
    <Action tone="good" disabled={busy || !form.return} click={() => execute(() => runBackendAction('store-returns', id(form.return), 'apply'), 'Returned stock restored')}>Post store return</Action>
  </Panel>
}

function ReorderPanel({ app, data, form, setForm, busy, execute }: any) {
  const belowMinimum = data.reorder.filter((rule: Row) => {
    const balance = data.balances.find((row: Row) => id(row.item) === id(rule.item) && (!rule.store || id(row.store) === id(rule.store)))
    return num(balance?.quantity_in_stock) <= num(rule.minimum_level)
  })
  return <Panel title="Reorder queue" note="Review low-stock items and create requisitions.">
    <Field label="Low-stock rule"><Select value={form.rule} change={(v) => setForm({ rule: v })} rows={belowMinimum} label={(rule) => `${itemName(app, rule.item)} · reorder ${rule.reorder_quantity}`} /></Field>
    <Field label="Procurement reason"><Input value={form.reason} change={(v) => setForm({ ...form, reason: v })} /></Field>
    <Action disabled={busy || !form.rule} click={() => execute(() => runBackendAction('reorder-rules', id(form.rule), 'create-purchase-requisition', { reason: form.reason || '' }), 'Draft purchase requisition created from low stock')}>Create purchase requisition</Action>
    {!belowMinimum.length && <Hint>No active reorder rules are currently below minimum.</Hint>}
  </Panel>
}

function ReadOnlyPanel({ title, note }: { title: string; note: string }) {
  return <Panel title={title} note={note}><div style={{ padding: 12, borderRadius: 6, color: 'var(--text-muted)', background: 'var(--surface-2)', fontSize: 11.5 }}>Select a record to view details.</div></Panel>
}

function Records({ tab, data, app, stage, onSelect, onNewRequisition }: { tab: Tab; data: Record<string, Row[]>; app: any; stage?: string; onSelect: (row: Row) => void; onNewRequisition?: () => void }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const requesterView = tab === 'requests' && stage === 'prepare' && id(app.user.role).trim().toLowerCase() === 'requester'
  const stageRows = tab !== 'requests' ? data[tab]
    : stage === 'department' ? data.requests.filter((row) => id(row.status) === 'pending_department_approval')
      : stage === 'stores' ? data.requests.filter((row) => id(row.status) === 'submitted')
        : stage === 'shortage' ? data.requests.filter((row) => isReadyForProcurement(row, data.requestItems))
          : stage === 'issue' ? data.requests.filter((row) => ['approved', 'partially_approved', 'partially_issued'].includes(id(row.status)))
            : data.requests
  const rowDate = (row: Row) => id(row.created_at || row.request_date || row.issue_date || row.count_date || row.return_date || row.consumed_on)
  const rows = stageRows.filter((row) => {
    const searchable = Object.values(row).join(' ').toLowerCase()
    const itemText = tab === 'requests' ? data.requestItems.filter((line) => id(line.requisition) === id(row.id)).map((line) => itemName(app, line.item)).join(' ').toLowerCase() : ''
    const matchesQuery = !query || searchable.includes(query.toLowerCase()) || itemText.includes(query.toLowerCase())
    const matchesStatus = !status || id(row.status) === status
    const date = rowDate(row).slice(0, 10)
    return matchesQuery && matchesStatus && (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo)
  })
  const cells = (row: Row) => tab === 'requests' ? [id(row.requisition_no), id(row.purpose) || departmentName(app, row.department), data.requestItems.filter((line) => id(line.requisition) === id(row.id)).slice(0, 2).map((line) => `${itemName(app, line.item)} × ${id(line.base_quantity_requested || line.quantity_requested || line.quantity)}`).join(', ') || 'No items', statusLabel(id(row.status))]
    : tab === 'issues' ? [id(row.issue_no), storeName(app, row.store), row.inventory_changes_applied ? 'Posted' : 'Draft', id(row.received_by_name) || 'Not acknowledged']
    : tab === 'transfers' ? [storeName(app, row.from_store), storeName(app, row.to_store), id(row.total_quantity), id(row.status)]
    : tab === 'adjustments' ? [id(row.reference) || id(row.id).slice(0, 8), storeName(app, row.store), id(row.reason), id(row.status)]
    : tab === 'counts' ? [id(row.count_no), storeName(app, row.store), id(row.count_date), id(row.status)]
    : tab === 'returns' ? [id(row.return_no), departmentName(app, row.department), storeName(app, row.store), row.inventory_changes_applied ? 'Posted' : 'Draft']
      : tab === 'reorder' ? [itemName(app, row.item), storeName(app, row.store) || 'All stores', `Min ${row.minimum_level}`, `Reorder ${row.reorder_quantity}`]
        : tab === 'batches' ? [itemName(app, row.item), storeName(app, row.store), `Remaining ${row.remaining_quantity}`, id(row.expiry_date) || 'No expiry']
          : [departmentName(app, row.department), itemName(app, row.item), `${row.quantity} × ${row.unit_cost}`, id(row.consumed_on)]
  const titles: Record<Tab, string> = { requests: stage === 'department' ? 'Requests awaiting Department Head approval' : stage === 'stores' ? 'Requests awaiting Store Keeper action' : stage === 'shortage' ? 'Store Requisitions ready to forward' : stage === 'issue' ? 'Requests ready to issue' : 'My requests', issues: 'Issue vouchers', transfers: 'Inter-store transfers', adjustments: 'Stock adjustments', counts: 'Stock counts', returns: 'Department returns', reorder: 'Low-stock reorder queue', batches: 'Inventory batches and expiry', consumption: 'Department consumption' }
  const statuses = Array.from(new Set(stageRows.map((row) => id(row.status)).filter(Boolean)))
  const hasFilters = Boolean(query || status || dateFrom || dateTo)
  const clearFilters = () => { setQuery(''); setStatus(''); setDateFrom(''); setDateTo('') }
  return <section className="inventory-records-card" style={{ ...card, overflow: 'hidden' }}>
    <div className="inventory-records-header" style={{ padding: '15px 17px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div><div style={{ fontSize: 13, fontWeight: 800 }}>{requesterView ? 'My requisitions' : titles[tab]}</div>{requesterView && <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11 }}>View and manage your department requisitions.</div>}</div>
      <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 11 }}>{rows.length} record{rows.length === 1 ? '' : 's'}</span>
      {requesterView && <button type="button" onClick={() => onNewRequisition?.()} style={{ ...secondary, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)' }}><Icon name="add" size={17} color="#fff" />New requisition</button>}
    </div>
    <div className="inventory-record-filters" style={{ display: 'grid', gap: 8, padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
      <label className="inventory-filter-field inventory-filter-search"><span>Search</span><input aria-label="Search records" placeholder={requesterView ? "Requisition or item…" : "Reference or item…"} value={query} onChange={(e) => setQuery(e.target.value)} style={control} /></label>
      <label className="inventory-filter-field"><span>Status</span><select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={control}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
      <label className="inventory-filter-field"><span>From</span><input aria-label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={control} /></label>
      <label className="inventory-filter-field"><span>To</span><input aria-label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={control} /></label>
      {hasFilters && <button type="button" className="inventory-clear-filters" onClick={clearFilters} style={secondary}><Icon name="filter_alt_off" size={16} />Clear</button>}
    </div>
    {requesterView && rows.length > 0 && <div className="requester-list-head" style={{ display: 'grid', gridTemplateColumns: '120px 160px minmax(240px,1.4fr) minmax(180px,1fr) auto', gap: 14, padding: '9px 17px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}><span>Requisition</span><span>Date</span><span>Items</span><span>Issuing store / location</span><span>Status</span></div>}
    {rows.map((row) => tab === 'requests' ? (() => {
      const requestLines = data.requestItems.filter((line) => id(line.requisition) === id(row.id))
      const itemNames = requestLines.slice(0, 2).map((line) => itemName(app, line.item))
      const itemPreview = itemNames.length ? `${itemNames.join(', ')}${requestLines.length > 2 ? ` +${requestLines.length - 2} more` : ''}` : 'No items added'
      return <button type="button" onClick={() => onSelect(row)} className="procurement-record-row store-request-row" key={id(row.id)} style={{ ...recordRow, gridTemplateColumns: requesterView ? '120px 160px minmax(240px,1.4fr) minmax(180px,1fr) auto' : '1.05fr 1.15fr 1.25fr 1.25fr auto', width: '100%', alignItems: 'center', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
        <span style={{ color: 'var(--text)', fontWeight: 800 }}>{id(row.requisition_no)}</span>
        <span style={{ color: 'var(--text-muted)' }}>{row.created_at ? new Date(id(row.created_at)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
        <span style={{ minWidth: 0 }}><b style={{ display: 'block', color: 'var(--text)', fontSize: 11.5 }}>{requestLines.length} item{requestLines.length === 1 ? '' : 's'}</b><small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemPreview}</small></span>
        <span style={{ minWidth: 0 }}><b style={{ display: 'block', color: 'var(--text)', fontSize: 11.5 }}>{requestStoreName(app, row)}</b><small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{requestStoreLocation(app, row)}</small></span>
        <StatusBadge value={id(row.status)} />
      </button>
    })() : <button type="button" onClick={() => onSelect(row)} className="procurement-record-row" key={id(row.id)} style={{ ...recordRow, width: '100%', alignItems: 'center', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>{cells(row).map((cell, index) => <span key={index} style={{ color: index ? 'var(--text-muted)' : 'var(--text)', fontWeight: index ? 500 : 700 }}>{cell || '—'}</span>)}</button>)}
    {!rows.length && <div className="inventory-empty-state" style={{ padding: 45, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
      <span className="inventory-empty-icon"><Icon name={hasFilters ? 'filter_alt_off' : 'inbox'} size={25} color={hasFilters ? 'var(--accent)' : 'var(--text-faint)'} /></span>
      <div style={{ marginTop: 10, color: 'var(--text)', fontWeight: 750 }}>{hasFilters ? 'No matching records' : requesterView ? 'No requisitions yet' : 'No records available'}</div>
      <div style={{ marginTop: 4 }}>{hasFilters ? 'Try clearing or changing the current filters.' : requesterView ? 'Create a requisition when your department needs an item.' : 'Records will appear here when they become available.'}</div>
      <div className="inventory-empty-actions">{hasFilters && <button type="button" onClick={clearFilters} style={secondary}>Clear filters</button>}{requesterView && !hasFilters && <button type="button" onClick={() => onNewRequisition?.()} style={{ ...secondary, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)' }}><Icon name="add" size={16} color="#fff" />New requisition</button>}</div>
    </div>}
  </section>
}

function InventoryRecordDrawer({ tab, row, data, app, close }: { tab: Tab; row: Row; data: Record<string, Row[]>; app: any; close: () => void }) {
  if (['reorder', 'batches', 'consumption'].includes(tab)) {
    const title = tab === 'reorder' ? 'Reorder rule' : tab === 'batches' ? 'Inventory batch' : 'Department consumption'
    const fields = Object.entries(row).filter(([key]) => !['id', 'created_by', 'updated_at'].includes(key))
    return <><div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.38)' }} /><aside className="procurement-detail-drawer inventory-print-document" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 81, width: 520, maxWidth: '94vw', padding: 22, overflowY: 'auto', background: 'var(--surface)', boxShadow: '-12px 0 32px rgba(15,23,42,.18)' }}><div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}><div><div style={{ color: 'var(--text-faint)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{title}</div><h2 style={{ margin: '4px 0 0', fontSize: 19 }}>{itemName(app, row.item)}</h2></div><button onClick={close} style={{ marginLeft: 'auto', width: 32, height: 32, border: 0, borderRadius: 6, cursor: 'pointer' }}><Icon name="close" size={18} /></button></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{fields.map(([key, value]) => <div key={key} style={{ minHeight: 65, padding: 12, borderBottom: '1px solid var(--border)' }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, textTransform: 'uppercase' }}>{key.replace(/_/g, ' ')}</div><div style={{ marginTop: 5, color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>{id(value) || '—'}</div></div>)}</div></aside></>
  }
  const configs: Record<string, { title: string; ref: string; lines: Row[] }> = {
    requests: { title: 'Store request', ref: id(row.requisition_no), lines: data.requestItems.filter((line) => id(line.requisition) === id(row.id)) },
    issues: { title: 'Stock issue', ref: id(row.issue_no), lines: data.issueItems.filter((line) => id(line.issue) === id(row.id)) },
    transfers: { title: 'Stock transfer', ref: `TR-${id(row.id).slice(0, 8).toUpperCase()}`, lines: data.transferItems.filter((line) => id(line.stock_transfer) === id(row.id)) },
    adjustments: { title: 'Stock adjustment', ref: id(row.reference) || `ADJ-${id(row.id).slice(0, 8).toUpperCase()}`, lines: data.adjustmentItems.filter((line) => id(line.stock_adjustment) === id(row.id)) },
    counts: { title: 'Stock count', ref: id(row.count_no), lines: data.countItems.filter((line) => id(line.stock_count) === id(row.id)) },
    returns: { title: 'Department return', ref: id(row.return_no), lines: data.returnItems.filter((line) => id(line.store_return) === id(row.id)) },
  }
  const config = configs[tab]
  const details: Array<[string, string]> = tab === 'requests' ? [
    ['Department', departmentName(app, row.department)], ['Issuing store', requestStoreName(app, row)],
    ['Store location', requestStoreLocation(app, row)],
    ['Required date', id(row.required_date) || '—'], ['Purpose', id(row.purpose) || '—'],
    ['Department approval', id(row.department_approval_comments) || '—'], ['Store Keeper note', id(row.approval_comments) || '—'],
    ['Rejection reason', id(row.rejection_reason) || '—'],
  ] : tab === 'issues' ? [
    ['Store', storeName(app, row.store)], ['Issue date', id(row.issue_date)],
    ['Acknowledged by', id(row.received_by_name) || 'Not acknowledged'], ['Posting', row.inventory_changes_applied ? 'Posted' : 'Draft'],
  ] : tab === 'transfers' ? [
    ['Source', storeName(app, row.from_store)], ['Destination', storeName(app, row.to_store)],
    ['Approved', row.approved_at ? id(row.approved_at) : 'Pending approval'], ['Dispatched', id(row.dispatched_at) || 'Not dispatched'],
    ['Received', id(row.received_at) || 'Not received'], ['Required date', id(row.required_date) || '—'],
  ] : tab === 'adjustments' ? [
    ['Store', storeName(app, row.store)], ['Reason', id(row.reason) || '—'],
    ['Approval', row.approved_at ? id(row.approved_at) : 'Not approved'], ['Rejection reason', id(row.rejection_reason) || '—'],
  ] : tab === 'counts' ? [
    ['Store', storeName(app, row.store)], ['Count date', id(row.count_date)],
    ['Approved by', employeeName(app, row.approved_by) || 'Not approved'], ['Posting', row.inventory_changes_applied ? 'Applied' : 'Not applied'],
  ] : [
    ['Department', departmentName(app, row.department)], ['Store', storeName(app, row.store)],
    ['Return date', id(row.return_date)], ['Reason', id(row.reason) || '—'],
  ]
  const lineQuantity = (line: Row) => tab === 'requests' ? `Requested ${line.base_quantity_requested} · Carried forward ${line.quantity_approved} · Issued ${line.quantity_issued}`
    : tab === 'counts' ? `System ${line.system_quantity} · Physical ${line.physical_quantity} · Variance ${num(line.physical_quantity) - num(line.system_quantity)}`
      : tab === 'adjustments' ? `Change ${line.quantity_change}` : `Quantity ${line.base_quantity || line.quantity}`
  return <>
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.38)' }} />
    <aside className="procurement-detail-drawer inventory-print-document" role="dialog" aria-modal="true" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 81, width: 560, maxWidth: '94vw', display: 'flex', flexDirection: 'column', background: 'var(--surface)', boxShadow: '-12px 0 32px rgba(15,23,42,.18)', animation: 'slideIn .2s ease' }}>
      <header className="screen-document-view" style={{ padding: '19px 22px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}><span style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 8, color: 'var(--accent)', background: 'var(--accent-soft)' }}><Icon name="inventory_2" size={21} /></span><div style={{ flex: 1 }}><div style={{ color: 'var(--text-faint)', fontSize: 10.5, textTransform: 'uppercase', fontWeight: 700 }}>{config.title}</div><div style={{ marginTop: 3, color: 'var(--text)', fontSize: 18, fontWeight: 750 }}>{config.ref}</div></div><span style={{ color: 'var(--accent)', background: 'var(--accent-soft)', padding: '4px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 }}>{id(row.status) || (row.inventory_changes_applied ? 'Posted' : 'Draft')}</span><button onClick={close} aria-label="Close" style={{ width: 32, height: 32, border: 0, borderRadius: 6, background: 'var(--surface-2)', cursor: 'pointer' }}><Icon name="close" size={18} /></button></header>
      <div className="screen-document-view" style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{details.map(([label, value]) => <div key={label} style={{ minHeight: 68, padding: 13, borderBottom: '1px solid var(--border)' }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 5, color: 'var(--text)', fontSize: 12.5, fontWeight: 600 }}>{value}</div></div>)}</div>
        {tab === 'requests' && <RequestTimeline row={row} app={app} />}
        <h3 style={{ margin: '24px 0 10px', fontSize: 13 }}>Items ({config.lines.length})</h3>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{config.lines.map((line) => <div key={id(line.id)} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}><div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 650 }}>{itemName(app, line.item)}</div><div style={{ marginTop: 4, color: 'var(--text-faint)', fontSize: 11.5 }}>{lineQuantity(line)}</div>{line.remarks && <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11 }}>{id(line.remarks)}</div>}</div>)}{!config.lines.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No line items.</div>}</div>
      </div>
      <InventoryPrintSheet propertyName={app.currentBranch} title={config.title} reference={config.ref} status={id(row.status) || (row.inventory_changes_applied ? 'Posted' : 'Draft')} details={details} lines={config.lines} lineQuantity={lineQuantity} itemLabel={(line) => itemName(app, line.item)} />
      <footer className="screen-document-view" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: '1px solid var(--border)' }}><button onClick={() => window.print()} style={secondary}><Icon name="print" size={17} />Print document</button><button onClick={close} style={secondary}>Close</button></footer>
    </aside>
  </>
}

function InventoryPrintSheet({ propertyName, title, reference, status, details, lines, lineQuantity, itemLabel }: {
  propertyName: string
  title: string
  reference: string
  status: string
  details: Array<[string, string]>
  lines: Row[]
  lineQuantity: (line: Row) => string
  itemLabel: (line: Row) => string
}) {
  const meaningfulDetails = details.filter(([, value]) => value && value !== '—' && !value.startsWith('Not '))
  return (
    <article className="print-only print-sheet">
      <header className="print-sheet-header">
        <div><div className="print-property">{propertyName || 'Hotel property'}</div><h1>{title}</h1><div className="print-reference">{reference}</div></div>
        <div className="print-status">{status.replace(/_/g, ' ')}</div>
      </header>
      <section className="print-meta">
        {meaningfulDetails.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </section>
      <table className="print-lines">
        <thead><tr><th>#</th><th>Article</th><th>Quantity / movement</th><th>Remarks</th></tr></thead>
        <tbody>
          {lines.map((line, index) => <tr key={id(line.id)}><td>{index + 1}</td><td>{itemLabel(line)}</td><td>{lineQuantity(line)}</td><td>{id(line.remarks) || '—'}</td></tr>)}
          {!lines.length && <tr><td colSpan={4}>No line items recorded.</td></tr>}
        </tbody>
      </table>
      <section className="print-signatures">
        <div><span>Prepared by</span><i /></div><div><span>Checked / authorised by</span><i /></div><div><span>Date</span><i /></div>
      </section>
      <footer className="print-sheet-footer">Generated from the Hotel Management System · {reference}</footer>
    </article>
  )
}

const itemName = (app: any, value: unknown) => id(app.data.items.find((r: Row) => id(r.id) === id(value))?.name) || id(value)
const storeName = (app: any, value: unknown) => id(app.data.locations.find((r: Row) => id(r.id) === id(value))?.name) || id(value)
const storeLocation = (app: any, value: unknown) => id(app.data.locations.find((r: Row) => id(r.id) === id(value))?.address)
const storeOptionLabel = (store: Row) => [id(store.name), id(store.address)].filter(Boolean).join(' · ')
const requestStoreName = (app: any, row: Row) => id(row.store_name) || storeName(app, row.store) || 'Pending store assignment'
const requestStoreLocation = (app: any, row: Row) => id(row.store_address || row.storeLocation) || storeLocation(app, row.store) || (row.store ? 'Location not recorded' : 'Assigned after Store Keeper review')
const departmentName = (app: any, value: unknown) => id(app.data.departments.find((r: Row) => id(r.id) === id(value))?.name) || id(value)
const employeeName = (app: any, value: unknown) => id(app.data.employees.find((r: Row) => id(r.id) === id(value))?.name) || id(value)
function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) { return <div className="inventory-action-form"><header className="inventory-action-form-header"><div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div><div style={{ ...muted, margin: '4px 0 0', lineHeight: 1.5 }}>{note}</div></header><div className="inventory-action-form-body">{children}</div></div> }
function StatusBadge({ value }: { value: string }) {
  const status = id(value).trim().toLowerCase().replace(/\s+/g, '_')
  const label = statusLabel(status)
  const palette: Record<string, { fg: string; bg: string; icon: string }> = {
    draft: { fg: 'var(--text-muted)', bg: 'var(--surface-2)', icon: 'edit_note' },
    pending_department_approval: { fg: 'var(--warn)', bg: 'var(--warn-soft)', icon: 'approval' },
    submitted: { fg: 'var(--accent)', bg: 'var(--accent-soft)', icon: 'inventory' },
    approved: { fg: 'var(--accent)', bg: 'var(--accent-soft)', icon: 'check_circle' },
    partially_approved: { fg: 'var(--warn)', bg: 'var(--warn-soft)', icon: 'pending_actions' },
    awaiting_procurement: { fg: '#7C3AED', bg: 'rgba(124,58,237,.12)', icon: 'shopping_cart' },
    partially_issued: { fg: '#D97706', bg: 'rgba(217,119,6,.12)', icon: 'outbox' },
    issued: { fg: 'var(--good)', bg: 'var(--good-soft)', icon: 'task_alt' },
    completed: { fg: 'var(--good)', bg: 'var(--good-soft)', icon: 'verified' },
    rejected: { fg: 'var(--bad)', bg: 'var(--bad-soft)', icon: 'cancel' },
    cancelled: { fg: 'var(--text-muted)', bg: 'var(--surface-2)', icon: 'block' },
  }
  const tone = palette[status] || { fg: 'var(--accent)', bg: 'var(--accent-soft)', icon: 'info' }
  return <span className="inventory-status-badge" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 999, color: tone.fg, background: tone.bg, fontSize: 9.5, fontWeight: 800 }}><Icon name={tone.icon} size={13} color={tone.fg} />{label}</span>
}
function RequestTimeline({ row, app }: { row: Row; app: any }) {
  const events = [
    { label: 'Created', detail: employeeName(app, row.requested_by), at: id(row.created_at) },
    row.department_approved_at && { label: 'Department approved', detail: employeeName(app, row.department_approved_by), at: id(row.department_approved_at) },
    row.approved_at && { label: 'Forwarded by Store Keeper', detail: employeeName(app, row.approved_by), at: id(row.approved_at) },
    row.issued_at && { label: 'Issued', detail: '', at: id(row.issued_at) },
  ].filter(Boolean) as Array<{ label: string; detail: string; at: string }>
  return <section style={{ marginTop: 22 }}><h3 style={{ margin: '0 0 10px', fontSize: 13 }}>Activity</h3><div style={{ borderLeft: '2px solid var(--border)', marginLeft: 6 }}>{events.map((event) => <div key={`${event.label}-${event.at}`} style={{ position: 'relative', padding: '0 0 14px 18px' }}><span style={{ position: 'absolute', left: -6, top: 3, width: 10, height: 10, borderRadius: 10, background: 'var(--accent)', border: '2px solid var(--surface)' }} /><div style={{ color: 'var(--text)', fontSize: 11.5, fontWeight: 750 }}>{event.label}</div><div style={{ marginTop: 2, color: 'var(--text-muted)', fontSize: 10.5 }}>{[event.detail, formatDateTime(event.at)].filter(Boolean).join(' · ')}</div></div>)}</div></section>
}
function InfoBox({ label, value }: { label: string; value: unknown }) { return <div className="inventory-info-box" style={{ padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)' }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 750, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 3, color: 'var(--text)', fontSize: 13, fontWeight: 750 }}>{id(value)}</div></div> }
function SectionLabel({ children }: { children: ReactNode }) { return <div style={{ margin: '4px 0 10px', color: 'var(--text)', fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</div> }
const statusLabel = (value: string) => ({ draft: 'Draft', pending_department_approval: 'Pending HOD Approval', submitted: 'Pending Store Keeper', approved: 'Approved', partially_approved: 'Partially Approved', awaiting_procurement: 'Awaiting Procurement', partially_issued: 'Partially Issued', issued: 'Issued', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled' } as Record<string,string>)[value] || value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
const formatDateTime = (value: string) => value ? new Date(value).toLocaleString() : ''
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="inventory-form-field" style={{ display: 'block', marginBottom: 10 }}><HelpLabel label={label} style={labelStyle} />{children}</label> }
function Input({ value, change, type = 'text' }: { value: unknown; change: (value: string) => void; type?: string }) { return <input className="inventory-control" type={type} value={id(value)} onChange={(e) => change(e.target.value)} style={control} /> }
function StablePicker({ value, change, rows, label = (r: Row) => id(r.name), emptyLabel = 'Select…', searchPlaceholder = 'Search…', disabled = false }: { value: unknown; change: (value: string) => void; rows: Row[]; label?: (row: Row) => string; emptyLabel?: string; searchPlaceholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const selected = rows.find((row) => id(row.id) === id(value))
  const filteredRows = rows.filter((row) => label(row).toLowerCase().includes(search.trim().toLowerCase()))

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const choose = (nextValue: string) => {
    change(nextValue)
    setOpen(false)
    setSearch('')
  }

  return <div ref={wrapRef} className="requester-stable-picker" style={{ position: 'relative', minWidth: 0 }}>
    <button
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => !disabled && setOpen((current) => !current)}
      style={{ ...control, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .65 : 1, color: selected ? 'var(--text)' : 'var(--text-muted)' }}
    >
      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected ? label(selected) : emptyLabel}</span>
      <Icon name={open ? 'expand_less' : 'expand_more'} size={18} color="var(--text-faint)" />
    </button>
    {open && !disabled && <div role="listbox" style={{ position: 'absolute', zIndex: 120, left: 0, right: 0, top: 'calc(100% + 5px)', minWidth: 230, padding: 6, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)', boxShadow: '0 12px 28px rgba(15,23,42,.18)' }}>
      <div style={{ position: 'relative', marginBottom: 5 }}>
        <Icon name="search" size={16} color="var(--text-faint)" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && filteredRows.length === 1) choose(id(filteredRows[0].id))
          }}
          placeholder={searchPlaceholder}
          style={{ width: '100%', height: 34, padding: '0 9px 0 31px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--text)', outline: 'none', fontSize: 12 }}
        />
      </div>
      <div style={{ maxHeight: 230, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {filteredRows.map((row) => {
          const active = id(row.id) === id(value)
          return <button
            key={id(row.id)}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => choose(id(row.id))}
            style={{ width: '100%', minHeight: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', border: 0, borderRadius: 6, background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text)', cursor: 'pointer', textAlign: 'left', font: 'inherit', fontSize: 12.5, fontWeight: active ? 700 : 550 }}
          >
            <span style={{ flex: 1 }}>{label(row)}</span>
            {active && <Icon name="check" size={16} color="var(--accent)" />}
          </button>
        })}
        {!filteredRows.length && <div style={{ padding: '16px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No matching options.</div>}
      </div>
    </div>}
  </div>
}

function Select({ value, change, rows, label = (r: Row) => id(r.name), optional = false, emptyLabel, disabled = false }: { value: unknown; change: (value: string) => void; rows: Row[]; label?: (row: Row) => string; optional?: boolean; emptyLabel?: string; disabled?: boolean }) { return <select className="inventory-control" disabled={disabled} value={id(value)} onChange={(e) => change(e.target.value)} style={{ ...control, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .65 : 1 }}><option value="">{emptyLabel || (optional ? 'None' : 'Select…')}</option>{rows.map((row) => <option key={id(row.id)} value={id(row.id)}>{label(row)}</option>)}</select> }
function Action({ children, click, disabled, tone = 'accent' }: any) { return <button className="inventory-primary-action" type="button" onClick={click} disabled={disabled} style={{ ...action, opacity: disabled ? .45 : 1, background: tone === 'good' ? 'var(--good)' : tone === 'danger' ? 'var(--bad)' : 'var(--accent)' }}>{children}</button> }
function Rule() { return <div className="inventory-form-rule" style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} /> }
function Hint({ children }: { children: ReactNode }) { return <div className="inventory-form-hint" role="note" style={{ padding: 9, color: 'var(--warn)', background: 'var(--warn-soft)', borderRadius: 6, fontSize: 11 }}>{children}</div> }
const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-sm)' }
const hero: CSSProperties = { width: 46, height: 46, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent)' }
const eyebrow: CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.02em', color: 'var(--accent)' }
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }
const secondary: CSSProperties = { height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', cursor: 'pointer' }
const approvalTab: CSSProperties = { minHeight: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 9px', border: '1px solid var(--border)', borderRadius: 6, font: 'inherit', fontSize: 10.5, fontWeight: 750, cursor: 'pointer', whiteSpace: 'nowrap' }
const tabButton: CSSProperties = { height: 38, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', border: '1px solid', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 650 }
const labelStyle: CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }
const control: CSSProperties = { width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12 }
const action: CSSProperties = { width: '100%', minHeight: 38, border: 0, borderRadius: 6, color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, marginTop: 5 }
const lineAction: CSSProperties = { width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--accent)', cursor: 'pointer' }
const recordRow: CSSProperties = { display: 'grid', gridTemplateColumns: '1.2fr 1.3fr 1fr 1fr', gap: 10, padding: '12px 17px', borderBottom: '1px solid var(--border)', fontSize: 12 }
