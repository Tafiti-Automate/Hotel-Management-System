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
    if (operationRunning.current) return
    operationRunning.current = true
    setBusy(true); setError('')
    try { await operation(); await load(); app.refreshData(); setForm(nextForm); app.showToast(success) }
    catch (reason) { const detail = errorMessage(reason); setError(detail); app.showWorkflowAlert('Inventory operation blocked', detail) }
    finally { operationRunning.current = false; setBusy(false) }
  }
  const tabs: Array<[Tab, string, string]> = ([
    ['requests', 'assignment', 'Department requests'], ['issues', 'outbox', 'Pick & issue'],
    ['transfers', 'sync_alt', 'Transfers'], ['adjustments', 'tune', 'Adjustments'],
    ['counts', 'inventory', 'Stock counts'], ['returns', 'assignment_return', 'Returns'],
    ['reorder', 'notification_important', 'Reorder queue'], ['batches', 'deployed_code', 'Batches & expiry'],
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
  const isStoresIssuer = isAdministrator || role === 'store keeper'
  const otherTabs = role === 'store keeper' ? [] : tabs.filter(([key]) => !['requests', 'issues'].includes(key))
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
  const selectInventoryRecord = (row: Row) => {
    if (requesterPreparing && ['draft', 'rejected'].includes(id(row.status).trim().toLowerCase())) {
      setForm({ request: id(row.id), purpose: row.purpose || '', requiredDate: row.required_date || '' })
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
      setForm({ request: id(saved.id || saved.apiId), purpose: '', requiredDate: '' })
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
  return <div style={{ maxWidth: 1460, margin: '0 auto' }}>
    <section className="workbench-hero" style={{ ...card, padding: 20, display: 'flex', alignItems: 'center', gap: 13, marginBottom: 15 }}><span style={hero}><Icon name="warehouse" size={24} color="#fff" /></span><div><div style={eyebrow}>{role === 'requester' ? 'Requisitions' : 'Inventory'}</div><h1 style={{ margin: '3px 0', fontSize: 23 }}>{isDepartmentHead ? 'Department Request Approvals' : isStoresApprover ? 'Store Keeper Queue' : 'My Requisitions'}</h1><div style={muted}>{isDepartmentHead ? 'Approve your department’s requests before they reach Stores.' : role === 'store keeper' ? 'Receive approved department requests and forward the required quantities to Procurement.' : isStoresApprover ? 'Review inventory requests.' : 'Create and track your department requisitions.'}</div></div><button onClick={() => void load()} style={{ ...secondary, marginLeft: 'auto' }}><Icon name="refresh" size={17} />Refresh</button></section>
    {(can(tabPermissions.requests.view) || can(tabPermissions.issues.view)) && <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 15 }}>
      {!isStoresApprover && !isDepartmentHead && <button onClick={() => selectSupplyStep('prepare')} style={{ ...tabButton, background: supplyPathActive === 'prepare' ? 'var(--accent-soft)' : 'var(--surface)', color: supplyPathActive === 'prepare' ? 'var(--accent)' : 'var(--text-muted)', borderColor: supplyPathActive === 'prepare' ? 'var(--accent)' : 'var(--border)' }}><Icon name="assignment" size={17} />My requisitions</button>}
      {isDepartmentHead && <button onClick={() => selectSupplyStep('department')} style={{ ...tabButton, background: supplyPathActive === 'department' ? 'var(--accent-soft)' : 'var(--surface)', color: supplyPathActive === 'department' ? 'var(--accent)' : 'var(--text-muted)', borderColor: supplyPathActive === 'department' ? 'var(--accent)' : 'var(--border)' }}><Icon name="approval" size={17} />Pending approvals ({scopedData.requests.filter((row: Row) => id(row.status) === 'pending_department_approval').length})</button>}
      {isStoresApprover && <><button onClick={() => selectSupplyStep('stores')} style={{ ...tabButton, background: supplyPathActive === 'stores' ? 'var(--accent-soft)' : 'var(--surface)', color: supplyPathActive === 'stores' ? 'var(--accent)' : 'var(--text-muted)', borderColor: supplyPathActive === 'stores' ? 'var(--accent)' : 'var(--border)' }}><Icon name="assignment" size={17} />Department requests ({scopedData.requests.filter((row: Row) => id(row.status) === 'submitted').length})</button><button onClick={() => selectSupplyStep('shortage')} style={{ ...tabButton, background: supplyPathActive === 'shortage' ? 'var(--accent-soft)' : 'var(--surface)', color: supplyPathActive === 'shortage' ? 'var(--accent)' : 'var(--text-muted)', borderColor: supplyPathActive === 'shortage' ? 'var(--accent)' : 'var(--border)' }}><Icon name="shopping_cart_checkout" size={17} />Forward to Procurement ({readyForProcurementCount})</button></>}
      {isStoresIssuer && <button onClick={() => selectSupplyStep('issue')} style={{ ...tabButton, background: supplyPathActive === 'issue' ? 'var(--accent-soft)' : 'var(--surface)', color: supplyPathActive === 'issue' ? 'var(--accent)' : 'var(--text-muted)', borderColor: supplyPathActive === 'issue' ? 'var(--accent)' : 'var(--border)' }}><Icon name="outbox" size={17} />Ready to issue ({scopedData.requests.filter((row: Row) => ['approved', 'partially_approved', 'partially_issued'].includes(id(row.status))).length})</button>}
    </div>}
    {otherTabs.length > 0 && <><div style={{ marginBottom: 10, color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>Inventory operations</div><div style={{ display: 'flex', gap: 5, marginBottom: 15, flexWrap: 'wrap' }}>{otherTabs.map(([key, icon, label]) => <button key={key} onClick={() => { setSupplyPathHint(''); setTab(key) }} style={{ ...tabButton, background: tab === key ? 'var(--accent-soft)' : 'var(--surface)', color: tab === key ? 'var(--accent)' : 'var(--text-muted)', borderColor: tab === key ? 'var(--accent)' : 'var(--border)' }}><Icon name={icon} size={17} />{label}</button>)}</div></>}
    {error && <div style={{ ...card, padding: 12, color: 'var(--bad)', fontSize: 12, marginBottom: 14 }}>{error}</div>}
    {loading ? <div style={{ ...card, padding: 50, textAlign: 'center', color: 'var(--text-faint)' }}>Loading inventory controls…</div> : requesterEditingDraft ? (
      <RequestPanel {...common} stage="prepare" />
    ) : requesterPreparing ? (
      <Records tab={tab} data={scopedData} app={app} stage={supplyPathActive} onSelect={selectInventoryRecord} onNewRequisition={() => void createRequesterRequisition()} />
    ) : <div className="workbench-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(350px,.7fr)', gap: 16, alignItems: 'start' }}>
      <Records tab={tab} data={scopedData} app={app} stage={supplyPathActive} onSelect={selectInventoryRecord} />
      <aside style={{ ...card, padding: 18 }}>
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
    {selectedRecord && <InventoryRecordDrawer tab={tab} row={selectedRecord} data={scopedData} app={app} close={() => setSelectedRecord(null)} />}
  </div>
}

function RequestPanel({ app, data, form, setForm, busy, execute, stage }: any) {
  const normalizedStatus = (row: Row) => id(row.statusCode || row.status).trim().toLowerCase().replace(/\s+/g, '_')
  const requestBackendId = (row: Row) => id(row.apiId || row.id)
  // Selects and workflow actions must use the backend UUID, not the formatted
  // requisition number shown to users (for example SR-2026-00001).
  const drafts = data.requests
    .filter((row: Row) => ['draft', 'rejected'].includes(normalizedStatus(row)))
    .map((row: Row) => ({ ...row, id: requestBackendId(row) }))
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
    prepare: { title: 'New request', note: 'Choose each article, quantity, and note, then submit it to your Department Head.' },
    department: { title: 'Department approval', note: 'Review the request before releasing it to the Store Keeper.' },
    stores: { title: 'Department request hand-off', note: 'Select the department request, confirm the quantity and send the linked requisition to Procurement.' },
    shortage: { title: 'Create Store Requisition', note: 'Create the Store Keeper requisition from the HOD-approved Department request and forward it to Procurement.' },
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
    {stage === 'prepare' && <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div><div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 800 }}>Request items</div><div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11 }}>Add all required articles to this requisition.</div></div>
        <button type="button" disabled={busy} onClick={() => app.openCreate('storeRequisitions', 'New store request')} style={{ ...secondary, marginLeft: 'auto', color: 'var(--accent)', borderColor: 'var(--accent)' }}><Icon name="add" size={17} />New request</button>
      </div>
      {drafts.length > 0 && <Field label="Draft request"><Select value={form.request} change={(v) => { const request = drafts.find((row: Row) => id(row.id) === v); setForm({ request: v, purpose: request?.purpose || '', requiredDate: request?.required_date || '' }) }} rows={drafts} label={(r) => `${id(r.requisition_no)} · ${id(r.purpose) || 'Untitled request'}`} /></Field>}
      {!drafts.length && <div style={{ padding: 20, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}><Icon name="assignment" size={26} color="var(--text-faint)" /><div style={{ marginTop: 8, color: 'var(--text)', fontSize: 12.5, fontWeight: 750 }}>No draft requests</div><div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11 }}>Create a request to begin adding items.</div></div>}
      {draftRequest && <>
        <RequestSummary
          request={draftRequest}
          lines={draftLines}
          data={data}
          app={app}
          editable
          onEditLine={(line) => setForm({ ...form, requestLine: id(line.id), item: line.item || '', unit: line.unit || '', quantity: line.quantity_requested || line.base_quantity_requested || '', note: line.remarks || '' })}
          onRemoveLine={(line) => {
            if (!window.confirm(`Remove ${itemName(app, line.item)} from this draft?`)) return
            void execute(() => deleteBackendPath('store-requisition-items', id(line.id)), 'Item removed', { request: form.request, purpose: form.purpose, requiredDate: form.requiredDate })
          }}
        />
        <div style={{ marginBottom: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
          <div style={{ marginBottom: 10, color: 'var(--text)', fontSize: 12.5, fontWeight: 800 }}>Request details</div>
          <Field label="Required date"><Input type="date" value={form.requiredDate || draftRequest.required_date} change={(v) => setForm({ ...form, requiredDate: v })} /></Field>
          <Field label="Purpose"><Input value={form.purpose || draftRequest.purpose} change={(v) => setForm({ ...form, purpose: v })} /></Field>
          <button type="button" disabled={busy || !id(form.purpose || draftRequest.purpose).trim()} onClick={() => execute(() => updateBackendRecord('store-requisitions', requestBackendId(draftRequest), { purpose: id(form.purpose || draftRequest.purpose).trim(), required_date: form.requiredDate || draftRequest.required_date || null }), 'Draft details updated', { request: form.request, purpose: form.purpose || draftRequest.purpose, requiredDate: form.requiredDate || draftRequest.required_date })} style={{ ...secondary, width: '100%', justifyContent: 'center' }}><Icon name="save" size={16} />Save changes</button>
        </div>
        <Field label={draftLine ? 'Edit item' : 'Article'}><Select value={draftLine ? form.requestLine : form.item} change={(v) => { if (draftLine || form.requestLine) { const line = draftLines.find((r: Row) => id(r.id) === v); const article = app.data.items.find((item: Row) => id(item.id) === id(line?.item)); setForm({ ...form, requestLine: v, item: line?.item || '', unit: line?.unit || article?.baseUnitId || '', quantity: line?.quantity_requested || '', note: line?.remarks || '' }) } else { const article = app.data.items.find((item: Row) => id(item.id) === v); setForm({ ...form, item: v, unit: article?.baseUnitId || '', quantity: '', note: '' }) } }} rows={draftLine || form.requestLine ? draftLines : app.data.items} optional={Boolean(draftLine || form.requestLine)} emptyLabel={draftLine || form.requestLine ? 'Add another item' : 'Choose article'} label={(r) => draftLine || form.requestLine ? `${itemName(app, r.item)} · ${r.quantity_requested}` : itemName(app, r.id)} /></Field>
        {(form.item || form.requestLine) && (() => { const article = app.data.items.find((item: Row) => id(item.id) === id(form.item || draftLine?.item)); return <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10, marginBottom: 10 }}><div style={{ padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)' }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>Category</div><div style={{ marginTop: 3, color: 'var(--text)', fontSize: 11.5, fontWeight: 700 }}>{id(article?.category) || 'Not configured'}</div></div><div style={{ padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)' }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>Issue unit</div><div style={{ marginTop: 3, color: 'var(--text)', fontSize: 11.5, fontWeight: 700 }}>{id(article?.uom) || 'Base unit'}</div></div></div><Field label="Quantity"><Input type="number" value={form.quantity} change={(v) => setForm({ ...form, quantity: v })} /></Field><Field label="Note"><Input value={form.note} change={(v) => setForm({ ...form, note: v })} /></Field></> })()}
        {!draftLine && <Action disabled={busy || !form.item || num(form.quantity) <= 0} click={() => execute(() => createBackendRecord('store-requisition-items', { requisition: form.request, item: form.item, unit: form.unit || null, quantity_requested: num(form.quantity), quantity_approved: 0, quantity_issued: 0, remarks: id(form.note).trim() }), 'Item added', { request: form.request, purpose: form.purpose, requiredDate: form.requiredDate, item: '', unit: '', quantity: '', note: '', requestLine: '' })}>Add item</Action>}
        {draftLine && <><Action disabled={busy || num(form.quantity) <= 0} click={() => execute(() => updateBackendRecord('store-requisition-items', id(draftLine.id), { item: form.item, unit: form.unit || null, quantity_requested: num(form.quantity), remarks: id(form.note).trim() }), 'Item updated', { request: form.request, purpose: form.purpose, requiredDate: form.requiredDate })}>Update item</Action><button type="button" disabled={busy} onClick={() => execute(() => deleteBackendPath('store-requisition-items', id(draftLine.id)), 'Item removed', { request: form.request, purpose: form.purpose, requiredDate: form.requiredDate })} style={{ ...action, background: 'var(--bad)' }}>Remove item</button></>}
        <Rule />
        <Action tone="good" disabled={busy || !draftRequest || draftLines.length === 0} click={() => execute(() => runBackendAction('store-requisitions', id(form.request), 'submit'), 'Request sent to the Department Head')}>Submit for department approval</Action>
        <Action disabled={busy || !draftRequest} tone="danger" click={() => {
          if (!window.confirm(`Delete ${id(draftRequest.requisition_no)} and all its items? This cannot be undone.`)) return
          void execute(() => deleteBackendPath('store-requisitions', requestBackendId(draftRequest)), 'Draft deleted')
        }}>Delete draft</Action>
      </>}
    </>}

    {stage === 'department' && <>
      <Field label="Request awaiting approval"><Select value={form.departmentPending} change={(v) => setForm({ departmentPending: v })} rows={data.requests.filter((r: Row) => id(r.status) === 'pending_department_approval')} label={(r) => `${id(r.requisition_no)} · ${id(r.purpose) || departmentName(app, r.department)}`} /></Field>
      {!data.requests.some((r: Row) => id(r.status) === 'pending_department_approval') && <Hint>No requests are waiting for Department Head approval.</Hint>}
      {departmentPending && <RequestSummary request={departmentPending} lines={departmentLines} data={data} app={app} />}
      <Field label="Approval comment"><Input value={form.departmentComment} change={(v) => setForm({ ...form, departmentComment: v })} /></Field>
      <Action tone="good" disabled={busy || !departmentPending} click={() => execute(() => runBackendAction('store-requisitions', id(form.departmentPending), 'department-approve', { comments: form.departmentComment || '' }), 'Request approved and sent to the Store Keeper')}>Approve and send to Stores</Action>
      <Rule />
      <Field label="Rejection reason"><Input value={form.departmentReason} change={(v) => setForm({ ...form, departmentReason: v })} /></Field>
      <Action tone="danger" disabled={busy || !departmentPending || !id(form.departmentReason).trim()} click={() => execute(() => runBackendAction('store-requisitions', id(form.departmentPending), 'reject', { reason: form.departmentReason || '' }), 'Request returned to the requester')}>Reject request</Action>
    </>}

    {stage === 'stores' && <>
      <Field label="Department request"><Select value={form.submitted} change={(v) => { const request = data.requests.find((r: Row) => id(r.id) === v); setForm({ submitted: v, destinationStore: request?.store || '' }) }} rows={data.requests.filter((r: Row) => id(r.status) === 'submitted')} label={(r) => `${id(r.requisition_no)} · ${departmentName(app, r.department)}`} /></Field>
      {!data.requests.some((r: Row) => id(r.status) === 'submitted') && <Hint>No submitted Department requisitions are waiting for Store Keeper action.</Hint>}
      {submittedRequest && <><RequestSummary request={submittedRequest} lines={submittedLines} data={data} app={app} /><Hint>Article and requested quantity came from the Department requisition. Supplier and price information is intentionally not available to Store Keeper.</Hint></>}
      <Field label="Destination store"><Select value={form.destinationStore || submittedRequest?.store || ''} change={(v) => setForm({ ...form, destinationStore: v })} rows={app.data.locations} emptyLabel="Select destination store" /></Field>
      <Action disabled={busy || !submittedRequest || !form.destinationStore} click={() => execute(() => runBackendAction('store-requisitions', id(form.submitted), 'assign-store', { store: form.destinationStore }), 'Destination store confirmed', { submitted: form.submitted, destinationStore: form.destinationStore })}>Confirm destination store</Action>
      <Rule />
      <Field label="Item to review"><Select value={form.decisionLine} change={(v) => { const line = submittedLines.find((r: Row) => id(r.id) === v); setForm({ ...form, decisionLine: v, approved: num(line?.quantity_approved) > 0 ? line?.quantity_approved : line?.base_quantity_requested || '', decisionComment: line?.storekeeper_comment || '' }) }} rows={submittedLines} label={(r) => `${itemName(app, r.item)} · requested ${r.base_quantity_requested}`} /></Field>
      {decisionLine && <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginBottom: 10 }}>
        <InfoBox label="Department requested" value={num(decisionLine.base_quantity_requested)} />
        <InfoBox label="Available in selected store" value={availableNow} />
        <InfoBox label="Store Keeper forwards" value={num(form.approved || decisionLine.quantity_approved || decisionLine.base_quantity_requested)} />
      </section>}
      <Field label="Quantity to carry forward"><Input type="number" value={form.approved} change={(v) => setForm({ ...form, approved: v })} /></Field>
      {decisionLine && <Hint>Stock availability is shown for context only. Your carried-forward quantity is a separate Store Keeper decision and cannot exceed the Department request.</Hint>}
      <Field label="Decision comment"><Input value={form.decisionComment} change={(v) => setForm({ ...form, decisionComment: v })} /></Field>
      <Action disabled={busy || !decisionLine || num(form.approved) < 0 || num(form.approved) > num(decisionLine?.base_quantity_requested) || (num(form.approved) === 0 && !id(form.decisionComment).trim())} click={() => execute(() => updateBackendRecord('store-requisition-items', id(decisionLine?.id), { quantity_approved: num(form.approved), storekeeper_comment: form.decisionComment || '' }), 'Store Keeper quantity saved', { submitted: form.submitted })}>Save this item decision</Action>
      <Rule />
      {!decisionsComplete && submittedRequest && <Hint>Confirm every requested line before forwarding the request to Procurement.</Hint>}
      {decisionsComplete && !hasApprovedQuantity && <Hint>At least one line must carry a quantity before this request can move forward.</Hint>}
      <Hint>After confirming the required quantities, use the Procurement hand-off tab to send this predecessor document forward. The Department request itself remains unchanged.</Hint>
      
    </>}

    {stage === 'shortage' && <>
      <div style={{ marginBottom: 12, color: 'var(--text)', fontSize: 13, fontWeight: 800 }}>Create Store Requisition and forward to Procurement</div>
      <Field label="Prepared Store Requisition"><Select value={form.shortageRequest} change={(v) => setForm({ shortageRequest: v })} rows={readyForProcurement} label={(r) => `${id(r.requisition_no)} · ${departmentName(app, r.department)}`} /></Field>
      {!readyForProcurement.length && <Hint>No Store Requisitions have completed the destination and quantity checks.</Hint>}
      {shortageRequest && <><RequestSummary request={shortageRequest} lines={shortageLines} data={data} app={app} /><Hint>The system creates the Store Requisition from this approved Department request. Articles are inherited; the Store Keeper confirms destination and carried-forward quantities without seeing supplier or price data.</Hint></>}
      <Field label="Store Keeper note to Procurement"><Input value={form.shortageReason} change={(v) => setForm({ ...form, shortageReason: v })} /></Field>
      <Action disabled={busy || !form.shortageRequest || !id(form.shortageReason).trim()} click={() => execute(() => runBackendAction('store-requisitions', id(form.shortageRequest), 'send-to-procurement', { reason: form.shortageReason || '' }), 'Store Requisition created and forwarded to Procurement')}>Create Store Requisition & Forward</Action>
      <Hint>The Department request remains unchanged for audit. Procurement receives the new linked Store Requisition, then selects a vetted supplier, confirms the current price and prepares the LPO.</Hint>
    </>}
  </Panel>
}


function RequesterDraftEditor({ app, data, form, setForm, busy, execute, draftRequest, draftLines, draftLine, requestBackendId }: any) {
  if (!draftRequest) {
    return <section style={{ ...card, padding: 28 }}>
      <button type="button" onClick={() => setForm({})} style={{ ...secondary, marginBottom: 18 }}><Icon name="arrow_back" size={17} />Back to my requisitions</button>
      <div style={{ padding: 38, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
        <Icon name="description" size={32} color="var(--text-faint)" />
        <div style={{ marginTop: 10, color: 'var(--text)', fontSize: 14, fontWeight: 800 }}>Draft not available</div>
        <div style={{ marginTop: 5, color: 'var(--text-muted)', fontSize: 12 }}>Return to your requisitions and open an editable draft.</div>
      </div>
    </section>
  }

  const uomNames = new Map(app.data.uoms.map((row: Row) => [id(row.id), id(row.name)]))
  const article = app.data.items.find((row: Row) => id(row.id) === id(form.item || draftLine?.item))
  const selectedUom = uomNames.get(id(form.unit || draftLine?.unit || article?.baseUnitId)) || id(article?.uom) || 'Base unit'
  const purposeValue = form.purpose ?? draftRequest.purpose ?? ''
  const requiredDateValue = form.requiredDate ?? draftRequest.required_date ?? ''
  const beginAddItem = () => setForm({ ...form, requestLine: '', item: '', unit: '', quantity: '', note: '' })
  const editLine = (line: Row) => {
    const lineArticle = app.data.items.find((row: Row) => id(row.id) === id(line.item))
    setForm({
      ...form,
      requestLine: id(line.id),
      item: line.item || '',
      unit: line.unit || lineArticle?.baseUnitId || '',
      quantity: line.quantity_requested || line.base_quantity_requested || '',
      note: line.remarks || '',
    })
  }
  const saveDetails = () => execute(
    () => updateBackendRecord('store-requisitions', requestBackendId(draftRequest), {
      purpose: id(purposeValue).trim(),
      required_date: requiredDateValue || null,
    }),
    'Draft saved',
    { ...form, purpose: purposeValue, requiredDate: requiredDateValue },
  )

  return <div className="requester-requisition-editor" style={{ display: 'grid', gap: 16 }}>
    <section style={{ ...card, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setForm({})} style={secondary}><Icon name="arrow_back" size={17} />My requisitions</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em' }}>Department Requisition</div>
          <h2 style={{ margin: '3px 0 0', color: 'var(--text)', fontSize: 22, letterSpacing: '-.02em' }}>{id(draftRequest.requisition_no) || 'Draft requisition'}</h2>
        </div>
        <div style={{ marginLeft: 'auto' }}><StatusBadge value={id(draftRequest.status)} /></div>
      </div>
      <div className="requester-requisition-meta" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, marginTop: 18 }}>
        <InfoBox label="Department" value={app.user.departmentName || departmentName(app, draftRequest.department) || 'Your department'} />
        <InfoBox label="Requested by" value={app.user.name} />
        <InfoBox label="Required date" value={requiredDateValue || 'Not specified'} />
        <InfoBox label="Items" value={`${draftLines.length} item${draftLines.length === 1 ? '' : 's'}`} />
      </div>
    </section>

    <section style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '17px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 800 }}>Requisition details</div>
        <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11.5 }}>State why these items are needed. Supplier and price information is intentionally not part of a Department Requisition.</div>
      </div>
      <div className="requester-requisition-details" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(220px,.6fr)', gap: 14, padding: 18 }}>
        <Field label="Purpose / reason"><Input value={purposeValue} change={(value) => setForm({ ...form, purpose: value })} /></Field>
        <Field label="Required date"><Input type="date" value={requiredDateValue} change={(value) => setForm({ ...form, requiredDate: value })} /></Field>
      </div>
      <div style={{ padding: '0 18px 18px', display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" disabled={busy || !id(purposeValue).trim()} onClick={() => void saveDetails()} style={{ ...secondary, opacity: busy || !id(purposeValue).trim() ? .5 : 1 }}><Icon name="save" size={16} />Save draft details</button>
      </div>
    </section>

    <section style={{ ...card, overflow: 'hidden' }}>
      <div style={{ padding: '17px 18px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 800 }}>Requested items</div>
          <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11.5 }}>Add every article required before submitting this requisition.</div>
        </div>
        <button type="button" onClick={beginAddItem} style={{ ...secondary, marginLeft: 'auto', color: 'var(--accent)', borderColor: 'var(--accent)' }}><Icon name="add" size={17} />Add another item</button>
      </div>

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
              void execute(() => deleteBackendPath('store-requisition-items', id(line.id)), 'Item removed', { request: form.request, purpose: purposeValue, requiredDate: requiredDateValue, requestLine: '', item: '', unit: '', quantity: '', note: '' })
            }} title="Remove item" style={{ ...lineAction, color: 'var(--bad)' }}><Icon name="delete" size={15} /></button>
          </span>
        </div>
      })}
      {!draftLines.length && <div style={{ padding: 34, textAlign: 'center', borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        <Icon name="playlist_add" size={29} color="var(--text-faint)" />
        <div style={{ marginTop: 8, color: 'var(--text)', fontSize: 12.5, fontWeight: 800 }}>No items added yet</div>
        <div style={{ marginTop: 4, fontSize: 11.5 }}>Use “Add another item” below to build this requisition.</div>
      </div>}

      <div style={{ padding: 18, borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <div style={{ marginBottom: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 7, background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name={draftLine ? 'edit' : 'add'} size={16} /></span>
          <div><div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 800 }}>{draftLine ? 'Edit requested item' : 'Add requested item'}</div><div style={{ marginTop: 2, color: 'var(--text-muted)', fontSize: 10.5 }}>Choose the article, enter quantity and optionally add an item note.</div></div>
          {draftLine && <button type="button" onClick={beginAddItem} style={{ ...secondary, marginLeft: 'auto', height: 32 }}>Cancel edit</button>}
        </div>
        <div className="requester-item-form" style={{ display: 'grid', gridTemplateColumns: 'minmax(250px,1.4fr) 120px 140px minmax(220px,1fr)', gap: 12, alignItems: 'end' }}>
          <Field label="Article"><Select value={form.item} change={(value) => { const selected = app.data.items.find((row: Row) => id(row.id) === value); setForm({ ...form, item: value, unit: selected?.baseUnitId || '', quantity: form.quantity || '', note: form.note || '' }) }} rows={app.data.items} emptyLabel="Choose article" label={(row) => itemName(app, row.id)} /></Field>
          <Field label="Quantity"><Input type="number" value={form.quantity} change={(value) => setForm({ ...form, quantity: value })} /></Field>
          <div style={{ marginBottom: 10 }}><HelpLabel label="UOM" style={labelStyle} /><div style={{ ...control, display: 'flex', alignItems: 'center', background: 'var(--surface)' }}>{form.item ? selectedUom : 'Select article first'}</div></div>
          <Field label="Item note"><Input value={form.note} change={(value) => setForm({ ...form, note: value })} /></Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>
          {draftLine ? <button type="button" disabled={busy || !form.item || num(form.quantity) <= 0} onClick={() => execute(() => updateBackendRecord('store-requisition-items', id(draftLine.id), { item: form.item, unit: form.unit || null, quantity_requested: num(form.quantity), remarks: id(form.note).trim() }), 'Item updated', { request: form.request, purpose: purposeValue, requiredDate: requiredDateValue, requestLine: '', item: '', unit: '', quantity: '', note: '' })} style={{ ...secondary, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)', opacity: busy || !form.item || num(form.quantity) <= 0 ? .5 : 1 }}><Icon name="save" size={16} color="#fff" />Update item</button> : <button type="button" disabled={busy || !form.item || num(form.quantity) <= 0} onClick={() => execute(() => createBackendRecord('store-requisition-items', { requisition: form.request, item: form.item, unit: form.unit || null, quantity_requested: num(form.quantity), quantity_approved: 0, quantity_issued: 0, remarks: id(form.note).trim() }), 'Item added', { request: form.request, purpose: purposeValue, requiredDate: requiredDateValue, item: '', unit: '', quantity: '', note: '', requestLine: '' })} style={{ ...secondary, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)', opacity: busy || !form.item || num(form.quantity) <= 0 ? .5 : 1 }}><Icon name="add" size={16} color="#fff" />Add item</button>}
        </div>
      </div>
    </section>

    <section className="requester-editor-actions" style={{ ...card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}><b style={{ color: 'var(--text)' }}>{draftLines.length}</b> item{draftLines.length === 1 ? '' : 's'} in this requisition</div>
      <button type="button" disabled={busy} onClick={() => {
        if (!window.confirm(`Delete ${id(draftRequest.requisition_no)} and all its items? This cannot be undone.`)) return
        void execute(() => deleteBackendPath('store-requisitions', requestBackendId(draftRequest)), 'Draft deleted', {})
      }} style={{ ...secondary, marginLeft: 'auto', color: 'var(--bad)', borderColor: 'rgba(220,38,38,.3)' }}><Icon name="delete" size={16} color="var(--bad)" />Delete draft</button>
      <button type="button" disabled={busy || !id(purposeValue).trim()} onClick={() => void saveDetails()} style={{ ...secondary, opacity: busy || !id(purposeValue).trim() ? .5 : 1 }}><Icon name="save" size={16} />Save draft</button>
      <button type="button" disabled={busy || draftLines.length === 0 || !id(purposeValue).trim()} onClick={() => execute(() => runBackendAction('store-requisitions', id(form.request), 'submit'), 'Requisition sent to your Department Head', {})} style={{ ...secondary, color: '#fff', background: 'var(--good)', borderColor: 'var(--good)', opacity: busy || draftLines.length === 0 || !id(purposeValue).trim() ? .5 : 1 }}><Icon name="send" size={16} color="#fff" />Submit for HOD approval</button>
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
        <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11 }}>{departmentName(app, request.department)} · {id(request.purpose) || 'No purpose entered'}</div>
        {showOperationalContext && <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: '5px 14px', color: 'var(--text-muted)', fontSize: 11.5 }}>
          <span><b style={{ color: 'var(--text)' }}>Requester:</b> {employeeName(app, request.requested_by) || 'Not recorded'}</span>
          <span><b style={{ color: 'var(--text)' }}>Required:</b> {id(request.required_date || request.requiredDate) || 'Not specified'}</span>
          <span><b style={{ color: 'var(--text)' }}>Issuing store:</b> {storeName(app, request.store)}</span>
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
  return <section style={{ ...card, overflow: 'hidden' }}>
    <div style={{ padding: '15px 17px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div><div style={{ fontSize: 13, fontWeight: 800 }}>{requesterView ? 'My requisitions' : titles[tab]}</div>{requesterView && <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11 }}>Create, continue and track your Department Requisitions.</div>}</div>
      <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 11 }}>{rows.length} record{rows.length === 1 ? '' : 's'}</span>
      {requesterView && <button type="button" onClick={() => onNewRequisition?.()} style={{ ...secondary, color: '#fff', background: 'var(--accent)', borderColor: 'var(--accent)' }}><Icon name="add" size={17} color="#fff" />New requisition</button>}
    </div>
    <div className="inventory-record-filters" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.5fr) minmax(130px,.8fr) minmax(130px,.8fr) minmax(130px,.8fr)', gap: 8, padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
      <input aria-label="Search records" placeholder="Search reference, purpose or item" value={query} onChange={(e) => setQuery(e.target.value)} style={control} />
      <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={control}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
      <input aria-label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={control} />
      <input aria-label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={control} />
    </div>
    {requesterView && rows.length > 0 && <div className="requester-list-head" style={{ display: 'grid', gridTemplateColumns: '110px minmax(170px,1fr) minmax(210px,1.25fr) minmax(180px,1fr) auto', gap: 14, padding: '9px 17px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}><span>Requisition</span><span>Purpose</span><span>Items</span><span>Progress</span><span>Status</span></div>}
    {rows.map((row) => tab === 'requests' ? (() => {
      const requestLines = data.requestItems.filter((line) => id(line.requisition) === id(row.id))
      const itemNames = requestLines.slice(0, 2).map((line) => itemName(app, line.item))
      const itemPreview = itemNames.length ? `${itemNames.join(', ')}${requestLines.length > 2 ? ` +${requestLines.length - 2} more` : ''}` : 'No items added'
      return <button type="button" onClick={() => onSelect(row)} className="procurement-record-row store-request-row" key={id(row.id)} style={{ ...recordRow, gridTemplateColumns: requesterView ? '110px minmax(170px,1fr) minmax(210px,1.25fr) minmax(180px,1fr) auto' : '1.05fr 1.15fr 1.25fr 1.25fr auto', width: '100%', alignItems: 'center', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
        <span style={{ color: 'var(--text)', fontWeight: 800 }}>{id(row.requisition_no)}</span>
        <span style={{ color: 'var(--text-muted)' }}>{id(row.purpose) || departmentName(app, row.department)}</span>
        <span style={{ minWidth: 0 }}><b style={{ display: 'block', color: 'var(--text)', fontSize: 11.5 }}>{requestLines.length} item{requestLines.length === 1 ? '' : 's'}</b><small style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemPreview}</small></span>
        <RequestProgress status={id(row.status)} />
        <StatusBadge value={id(row.status)} />
      </button>
    })() : <button type="button" onClick={() => onSelect(row)} className="procurement-record-row" key={id(row.id)} style={{ ...recordRow, width: '100%', alignItems: 'center', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>{cells(row).map((cell, index) => <span key={index} style={{ color: index ? 'var(--text-muted)' : 'var(--text)', fontWeight: index ? 500 : 700 }}>{cell || '—'}</span>)}</button>)}
    {!rows.length && <div style={{ padding: 45, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}><Icon name="inbox" size={28} color="var(--text-faint)" /><div style={{ marginTop: 8, color: 'var(--text)', fontWeight: 700 }}>No records found</div><div style={{ marginTop: 4 }}>No records match the current filters.</div></div>}
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
    ['Department', departmentName(app, row.department)], ['Issuing store', storeName(app, row.store)],
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
const departmentName = (app: any, value: unknown) => id(app.data.departments.find((r: Row) => id(r.id) === id(value))?.name) || id(value)
const employeeName = (app: any, value: unknown) => id(app.data.employees.find((r: Row) => id(r.id) === id(value))?.name) || id(value)
function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) { return <><div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div><div style={{ ...muted, margin: '4px 0 15px', lineHeight: 1.5 }}>{note}</div>{children}</> }
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
  return <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 999, color: tone.fg, background: tone.bg, fontSize: 9.5, fontWeight: 800 }}><Icon name={tone.icon} size={13} color={tone.fg} />{label}</span>
}
function RequestProgress({ status }: { status: string }) {
  const normalized = id(status).trim().toLowerCase().replace(/\s+/g, '_')
  const stages = ['Created', 'HOD Approval', 'Store Keeper', 'Procurement', 'Issue', 'Completed']
  const indexMap: Record<string, number> = { draft: 0, pending_department_approval: 1, submitted: 2, awaiting_procurement: 3, approved: 4, partially_approved: 4, partially_issued: 4, issued: 5, completed: 5, rejected: 1, cancelled: 0 }
  const current = indexMap[normalized] ?? 0
  return <div aria-label={`Request progress: ${stages[current]}`} style={{ minWidth: 150 }}>
    <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>{stages.map((stage, index) => <span key={stage} title={stage} style={{ height: 5, flex: 1, borderRadius: 5, background: index <= current ? (normalized === 'rejected' ? 'var(--bad)' : normalized === 'cancelled' ? 'var(--text-faint)' : index === current ? 'var(--accent)' : 'var(--good)') : 'var(--border)' }} />)}</div>
    <div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 650 }}>{normalized === 'rejected' ? 'Rejected' : normalized === 'cancelled' ? 'Cancelled' : stages[current]}</div>
  </div>
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
function InfoBox({ label, value }: { label: string; value: unknown }) { return <div style={{ padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)' }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 750, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 3, color: 'var(--text)', fontSize: 13, fontWeight: 750 }}>{id(value)}</div></div> }
function SectionLabel({ children }: { children: ReactNode }) { return <div style={{ margin: '4px 0 10px', color: 'var(--text)', fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</div> }
const statusLabel = (value: string) => ({ draft: 'Draft', pending_department_approval: 'Pending HOD Approval', submitted: 'Pending Store Keeper Action', approved: 'Approved', partially_approved: 'Partially Approved', awaiting_procurement: 'Awaiting Procurement', partially_issued: 'Partially Issued', issued: 'Issued', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled' } as Record<string,string>)[value] || value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
const formatDateTime = (value: string) => value ? new Date(value).toLocaleString() : ''
function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: 'block', marginBottom: 10 }}><HelpLabel label={label} style={labelStyle} />{children}</label> }
function Input({ value, change, type = 'text' }: { value: unknown; change: (value: string) => void; type?: string }) { return <input type={type} value={id(value)} onChange={(e) => change(e.target.value)} style={control} /> }
function Select({ value, change, rows, label = (r: Row) => id(r.name), optional = false, emptyLabel }: { value: unknown; change: (value: string) => void; rows: Row[]; label?: (row: Row) => string; optional?: boolean; emptyLabel?: string }) { return <select value={id(value)} onChange={(e) => change(e.target.value)} style={control}><option value="">{emptyLabel || (optional ? 'None' : 'Select…')}</option>{rows.map((row) => <option key={id(row.id)} value={id(row.id)}>{label(row)}</option>)}</select> }
function Action({ children, click, disabled, tone = 'accent' }: any) { return <button type="button" onClick={click} disabled={disabled} style={{ ...action, opacity: disabled ? .45 : 1, background: tone === 'good' ? 'var(--good)' : tone === 'danger' ? 'var(--bad)' : 'var(--accent)' }}>{children}</button> }
function Rule() { return <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} /> }
function Hint({ children }: { children: ReactNode }) { return <div style={{ padding: 9, color: 'var(--warn)', background: 'var(--warn-soft)', borderRadius: 6, fontSize: 11 }}>{children}</div> }
const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-sm)' }
const hero: CSSProperties = { width: 46, height: 46, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent)' }
const eyebrow: CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.02em', color: 'var(--accent)' }
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }
const secondary: CSSProperties = { height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', cursor: 'pointer' }
const tabButton: CSSProperties = { height: 38, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', border: '1px solid', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 650 }
const labelStyle: CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }
const control: CSSProperties = { width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12 }
const action: CSSProperties = { width: '100%', minHeight: 38, border: 0, borderRadius: 6, color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, marginTop: 5 }
const lineAction: CSSProperties = { width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--accent)', cursor: 'pointer' }
const recordRow: CSSProperties = { display: 'grid', gridTemplateColumns: '1.2fr 1.3fr 1fr 1fr', gap: 10, padding: '12px 17px', borderBottom: '1px solid var(--border)', fontSize: 12 }
