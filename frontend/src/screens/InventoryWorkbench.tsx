import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { HelpLabel } from '../components/HelpLabel'
import { WorkflowPath } from '../components/WorkflowPath'
import { createBackendRecord, deleteBackendPath, errorMessage, readBackendRecords, runBackendAction, updateBackendRecord } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

type Tab = 'requests' | 'issues' | 'transfers' | 'adjustments' | 'counts' | 'returns' | 'reorder' | 'batches' | 'consumption'
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

export default function InventoryWorkbench() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>(() => String(app.user.role || '').toLowerCase() === 'store keeper' ? 'issues' : 'requests')
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
    setSupplyPathHint('request')
    setForm({ request: app.inventoryDraftId })
    app.consumeInventoryDraft()
  }, [app.inventoryDraftId, app.consumeInventoryDraft])
  const scopedData = useMemo(() => {
    if (!app.currentBranch) return data
    const stores = new Set(app.data.locations.map((row) => id(row.id)))
    const next = { ...data }
    next.requests = data.requests.filter((row) => stores.has(id(row.store)))
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
  }, [app.currentBranch, app.data.locations, data])
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
  const otherTabs = tabs.filter(([key]) => !['requests', 'issues'].includes(key))
  const role = String(app.user.role || '').toLowerCase()
  const isAdministrator = app.user.isSuperuser || role === 'system administrator'
  const isDepartmentActor = isAdministrator || role === 'department head'
  const isStoresApprover = isAdministrator || ['stores manager', 'store manager'].includes(role)
  const isStoresIssuer = isStoresApprover || role === 'store keeper'
  const requestRoleStage = isStoresApprover
    ? 'stores-review'
    : role === 'department head' ? 'department-review' : 'request'
  const supplyPathActive = supplyPathHint || (tab === 'issues' ? 'pick' : tab === 'requests' ? requestRoleStage : '')
  const selectSupplyStep = (key: string) => {
    setSupplyPathHint(key)
    setTab(['pick', 'post', 'acknowledge'].includes(key) ? 'issues' : 'requests')
  }
  const common = { app, data: scopedData, form, setForm, busy, execute }
  return <div style={{ maxWidth: 1460, margin: '0 auto' }}>
    <section className="workbench-hero" style={{ ...card, padding: 20, display: 'flex', alignItems: 'center', gap: 13, marginBottom: 15 }}><span style={hero}><Icon name="warehouse" size={24} color="#fff" /></span><div><div style={eyebrow}>STORES & CONSUMPTION</div><h1 style={{ margin: '3px 0', fontSize: 23 }}>Department supply & stores</h1><div style={muted}>Follow a department request from item entry through approval, stores issue and receipt confirmation.</div></div><button onClick={() => void load()} style={{ ...secondary, marginLeft: 'auto' }}><Icon name="refresh" size={17} />Refresh</button></section>
    {(can(tabPermissions.requests.view) || can(tabPermissions.issues.view)) && <WorkflowPath
      title="Department material request journey"
      summary="Each person completes only their assigned stage. Requests created by a Department Head skip department review and go directly to Stores."
      activeKey={supplyPathActive}
      onSelect={selectSupplyStep}
      steps={[
        { key: 'request', label: 'Prepare request', actor: 'Department requester', description: 'Choose the draft, add all articles and submit.', icon: 'playlist_add', disabled: !can(tabPermissions.requests.change || tabPermissions.requests.view) },
        { key: 'department-review', label: 'Department review', actor: 'Department Head', description: 'Confirm the need, then approve or reject it.', icon: 'approval', disabled: !isDepartmentActor || !can(tabPermissions.requests.change || tabPermissions.requests.view) },
        { key: 'stores-review', label: 'Stores review', actor: 'Stores manager', description: 'Check availability, approve quantities and reserve stock.', icon: 'inventory', disabled: !isStoresApprover || !can(tabPermissions.requests.change || tabPermissions.requests.view) },
        { key: 'pick', label: 'Pick articles', actor: 'Stores team', description: 'Create the issue voucher and add approved pick lines.', icon: 'shopping_basket', disabled: !isStoresIssuer || !can(tabPermissions.issues.change || tabPermissions.issues.view) },
        { key: 'post', label: 'Post issue', actor: 'Stores team', description: 'Release stock and record department consumption.', icon: 'outbox', disabled: !isStoresIssuer || !can(tabPermissions.issues.change || tabPermissions.issues.view) },
        { key: 'acknowledge', label: 'Confirm receipt', actor: 'Stores team at handover', description: 'Record the employee who physically received the articles.', icon: 'how_to_reg', disabled: !isStoresIssuer || !can(tabPermissions.issues.change || tabPermissions.issues.view) },
      ]}
    />}
    {otherTabs.length > 0 && <><div style={{ marginBottom: 7, color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>Other stores and inventory tasks</div><div style={{ display: 'flex', gap: 5, marginBottom: 15, flexWrap: 'wrap' }}>{otherTabs.map(([key, icon, label]) => <button key={key} onClick={() => { setSupplyPathHint(''); setTab(key) }} style={{ ...tabButton, background: tab === key ? 'var(--accent-soft)' : 'var(--surface)', color: tab === key ? 'var(--accent)' : 'var(--text-muted)', borderColor: tab === key ? 'var(--accent)' : 'var(--border)' }}><Icon name={icon} size={17} />{label}</button>)}</div></>}
    {error && <div style={{ ...card, padding: 12, color: 'var(--bad)', fontSize: 12, marginBottom: 14 }}>{error}</div>}
    {loading ? <div style={{ ...card, padding: 50, textAlign: 'center', color: 'var(--text-faint)' }}>Loading inventory controls…</div> : <div className="workbench-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(350px,.7fr)', gap: 16, alignItems: 'start' }}>
      <Records tab={tab} data={scopedData} app={app} onSelect={setSelectedRecord} />
      <aside style={{ ...card, padding: 18 }}>
        {!canChangeTab && !['batches', 'consumption'].includes(tab) && <ReadOnlyPanel title="Read-only access" note="Your role can review these records but cannot create, approve or post them." />}
        {canChangeTab && tab === 'requests' && <RequestPanel {...common} />}
        {canChangeTab && tab === 'issues' && <IssuePanel {...common} />}
        {canChangeTab && tab === 'transfers' && <TransferPanel {...common} />}
        {canChangeTab && tab === 'adjustments' && <AdjustmentPanel {...common} />}
        {canChangeTab && tab === 'counts' && <CountPanel {...common} />}
        {canChangeTab && tab === 'returns' && <ReturnPanel {...common} />}
        {canChangeTab && tab === 'reorder' && <ReorderPanel {...common} />}
        {tab === 'batches' && <ReadOnlyPanel title="Batch and expiry visibility" note="FEFO allocation uses these batches automatically. Open a row to inspect its store, expiry and remaining quantity." />}
        {tab === 'consumption' && <ReadOnlyPanel title="Department consumption" note="Posted issues and direct supplier receipts appear here with their cost allocation." />}
      </aside>
    </div>}
    {selectedRecord && <InventoryRecordDrawer tab={tab} row={selectedRecord} data={scopedData} app={app} close={() => setSelectedRecord(null)} />}
  </div>
}

function RequestPanel({ app, data, form, setForm, busy, execute }: any) {
  const role = String(app.user.role || '').toLowerCase()
  const isDepartmentHead = app.user.isSuperuser || ['system administrator', 'department head'].includes(role)
  const isStoresApprover = app.user.isSuperuser || ['system administrator', 'stores manager'].includes(role)
  const drafts = data.requests.filter((row: Row) => ['draft', 'rejected'].includes(id(row.status)))
  const draftRequest = drafts.find((row: Row) => id(row.id) === id(form.request))
  const draftLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(form.request))
  const draftLine = draftLines.find((row: Row) => id(row.id) === id(form.requestLine))
  const submittedRequest = data.requests.find((row: Row) => id(row.id) === id(form.submitted))
  const submittedLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(form.submitted))
  const decisionLine = submittedLines.find((row: Row) => id(row.id) === id(form.decisionLine))
  const departmentPending = data.requests.find((row: Row) => id(row.id) === id(form.departmentPending))
  const procurementPending = data.requests.find((row: Row) => id(row.id) === id(form.procurementPending))
  return <Panel title="Department store requisition" note="Employee requests go to the Department Head first; Department Head requests go directly to Stores.">
    <RoleAction actor="Department requester" title="Prepare and submit the required articles" note="Complete all three steps below before sending the request for approval." />
    <Action disabled={busy} click={() => app.openCreate('storeRequisitions', 'New department material request')}>Start a new material request</Action>
    <Rule />
    <StepHeading number="1" title="Choose a saved draft request" />
    <Field label="Draft request"><Select value={form.request} change={(v) => setForm({ request: v })} rows={drafts} label={(r) => `${id(r.requisition_no)} · ${departmentName(app, r.department)}`} /></Field>
    {!drafts.length && <Hint>Create a new Department Material Request first. After saving it, the system returns here automatically.</Hint>}
    {draftRequest && <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 11.5 }}><strong style={{ color: 'var(--text)' }}>Active issuing store:</strong> {storeName(app, draftRequest.store)}<br /><span>{id(draftRequest.purpose) || 'No purpose entered'}</span></div>}
    <Rule />
    <StepHeading number="2" title="Add requested items and quantities" />
    <div style={{ margin: '-3px 0 10px', color: 'var(--text-faint)', fontSize: 11.5 }}>Add each Article required by the department. You can add multiple lines before submitting.</div>
    <Field label="Existing draft line"><Select optional value={form.requestLine} change={(v) => { const line = draftLines.find((r: Row) => id(r.id) === v); setForm({ ...form, requestLine: v, item: line?.item || '', unit: line?.unit || '', quantity: line?.quantity_requested || '' }) }} rows={draftLines} label={(r) => `${itemName(app, r.item)} · ${r.quantity_requested}`} /></Field>
    <Field label="Article"><Select value={form.item} change={(v) => setForm({ ...form, item: v })} rows={app.data.items} /></Field>
    <Field label="Unit"><Select value={form.unit} change={(v) => setForm({ ...form, unit: v })} rows={app.data.uoms} optional /></Field>
    <Field label="Requested quantity"><Input type="number" value={form.quantity} change={(v) => setForm({ ...form, quantity: v })} /></Field>
    {!draftLine && <Action disabled={busy || !form.request || !form.item || num(form.quantity) <= 0} click={() => execute(() => createBackendRecord('store-requisition-items', { requisition: form.request, item: form.item, unit: form.unit || null, quantity_requested: num(form.quantity), quantity_approved: 0, quantity_issued: 0, remarks: '' }), 'Requested item added', { request: form.request })}>Add item to this request</Action>}
    {draftLine && <><Action disabled={busy || num(form.quantity) <= 0} click={() => execute(() => updateBackendRecord('store-requisition-items', id(draftLine.id), { requisition: form.request, item: form.item, unit: form.unit || null, quantity_requested: num(form.quantity) }), 'Requested item updated', { request: form.request })}>Save item changes</Action><Action tone="danger" disabled={busy} click={() => execute(() => deleteBackendPath('store-requisition-items', id(draftLine.id)), 'Requested item removed', { request: form.request })}>Remove item</Action></>}
    {draftLines.length > 0 && <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>{draftLines.map((line: Row, index: number) => <div key={id(line.id)} style={{ display: 'grid', gridTemplateColumns: '26px 1fr auto', gap: 8, padding: '9px 10px', borderBottom: index < draftLines.length - 1 ? '1px solid var(--border)' : 0, fontSize: 11.5 }}><span style={{ color: 'var(--text-faint)' }}>{index + 1}</span><strong style={{ color: 'var(--text)' }}>{itemName(app, line.item)}</strong><span style={{ color: 'var(--text-muted)' }}>{line.quantity_requested}</span></div>)}</div>}
    {!draftLines.length && form.request && <Hint>No items have been added yet. Select an Article, enter its quantity, then click “Add item to this request”.</Hint>}
    <Rule />
    <StepHeading number="3" title="Submit the completed request" />
    <Action disabled={busy || !form.request || !draftLines.length} click={() => execute(() => runBackendAction('store-requisitions', id(form.request), 'submit'), isDepartmentHead ? 'Store requisition sent to Stores' : 'Store requisition sent to Department Head')}>Submit request with {draftLines.length} item{draftLines.length === 1 ? '' : 's'}</Action>
    {isDepartmentHead && <>
      <Rule />
      <RoleAction actor="Department Head" title="Review the business need" note="This section contains only requests waiting for department approval." />
      <Field label="Waiting for department approval"><Select value={form.departmentPending} change={(v) => setForm({ departmentPending: v })} rows={data.requests.filter((r: Row) => id(r.status) === 'pending_department_approval')} label={(r) => `${id(r.requisition_no)} · ${departmentName(app, r.department)}`} /></Field>
      <Field label="Department approval comment"><Input value={form.departmentComment} change={(v) => setForm({ ...form, departmentComment: v })} /></Field>
      <Action tone="good" disabled={busy || !departmentPending} click={() => execute(() => runBackendAction('store-requisitions', id(form.departmentPending), 'department-approve', { comments: form.departmentComment || '' }), 'Department request approved and sent to Stores')}>Approve for department</Action>
      <Field label="Department rejection reason"><Input value={form.departmentReason} change={(v) => setForm({ ...form, departmentReason: v })} /></Field>
      <Action tone="danger" disabled={busy || !departmentPending} click={() => execute(() => runBackendAction('store-requisitions', id(form.departmentPending), 'reject', { reason: form.departmentReason || '' }), 'Department request rejected')}>Reject department request</Action>
    </>}
    {isStoresApprover && <>
    <Rule />
    <RoleAction actor="Stores manager" title="Decide quantities and reserve stock" note="Review every line before approving the full request. Use the shortage action when stock is unavailable." />
    <Field label="Submitted request"><Select value={form.submitted} change={(v) => setForm({ submitted: v })} rows={data.requests.filter((r: Row) => id(r.status) === 'submitted')} label={(r) => id(r.requisition_no)} /></Field>
    <Field label="Line decision"><Select value={form.decisionLine} change={(v) => { const line = submittedLines.find((r: Row) => id(r.id) === v); setForm({ ...form, decisionLine: v, approved: line?.quantity_approved || line?.base_quantity_requested || '', decisionComment: line?.remarks || '' }) }} rows={submittedLines} label={(r) => `${itemName(app, r.item)} · requested ${r.base_quantity_requested}`} /></Field>
    <Field label="Approved quantity"><Input type="number" value={form.approved} change={(v) => setForm({ ...form, approved: v })} /></Field>
    <Field label="Line decision comment"><Input value={form.decisionComment} change={(v) => setForm({ ...form, decisionComment: v })} /></Field>
    <Action disabled={busy || !decisionLine} click={() => execute(() => updateBackendRecord('store-requisition-items', id(decisionLine?.id), { quantity_approved: num(form.approved), remarks: form.decisionComment || '' }), 'Line decision saved')}>Save line decision</Action>
    <Field label="Approval comments"><Input value={form.approvalComments} change={(v) => setForm({ ...form, approvalComments: v })} /></Field>
    <Action tone="good" disabled={busy || !submittedRequest} click={() => execute(() => runBackendAction('store-requisitions', id(form.submitted), 'approve', { comments: form.approvalComments || '' }), 'Store requisition approved and stock reserved')}>Approve / reserve decided quantities</Action>
    <Field label="Rejection reason"><Input value={form.reason} change={(v) => setForm({ ...form, reason: v })} /></Field>
    <Action tone="danger" disabled={busy || !form.submitted} click={() => execute(() => runBackendAction('store-requisitions', id(form.submitted), 'reject', { reason: form.reason || '' }), 'Store requisition rejected')}>Reject</Action>
    <Rule />
    <Field label="Unavailable request"><Select value={form.shortageRequest} change={(v) => setForm({ shortageRequest: v })} rows={data.requests.filter((r: Row) => id(r.status) === 'submitted')} label={(r) => `${id(r.requisition_no)} · ${departmentName(app, r.department)}`} /></Field>
    <Field label="Shortage explanation"><Input value={form.shortageReason} change={(v) => setForm({ ...form, shortageReason: v })} /></Field>
    <Action disabled={busy || !form.shortageRequest} click={() => execute(() => runBackendAction('store-requisitions', id(form.shortageRequest), 'send-to-procurement', { reason: form.shortageReason || '' }), 'Shortage sent to Procurement without duplicating the department request')}>Confirm shortage & send to Procurement</Action>
    <Field label="Waiting for purchased stock"><Select value={form.procurementPending} change={(v) => setForm({ procurementPending: v })} rows={data.requests.filter((r: Row) => id(r.status) === 'awaiting_procurement')} label={(r) => id(r.requisition_no)} /></Field>
    <Action tone="good" disabled={busy || !procurementPending} click={() => execute(() => runBackendAction('store-requisitions', id(form.procurementPending), 'resume-after-procurement'), 'Department request returned to Stores review')}>Purchased stock received — resume request</Action>
    </>}
    <Rule />
    <RoleAction actor="Request owner or administrator" title="Cancel an unfinished request" note="Cancellation releases any reservation already made for the request." />
    <Field label="Request to cancel"><Select value={form.cancelRequest} change={(v) => setForm({ cancelRequest: v })} rows={data.requests.filter((r: Row) => !['issued', 'cancelled'].includes(id(r.status)))} label={(r) => `${id(r.requisition_no)} · ${r.status}`} /></Field>
    <Action tone="danger" disabled={busy || !form.cancelRequest} click={() => execute(() => runBackendAction('store-requisitions', id(form.cancelRequest), 'cancel'), 'Store requisition cancelled and reservation released')}>Cancel request</Action>
  </Panel>
}

function IssuePanel({ app, data, form, setForm, busy, execute }: any) {
  const approved = data.requests.filter((row: Row) => ['approved', 'partially_approved', 'partially_issued'].includes(id(row.status)))
  const request = data.requests.find((row: Row) => id(row.id) === id(form.request))
  const requestLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(form.request))
  const issue = data.issues.find((row: Row) => id(row.id) === id(form.issue))
  const issueRequestLines = data.requestItems.filter((row: Row) => id(row.requisition) === id(issue?.requisition))
  return <Panel title="Pick, issue and acknowledge" note="Issue lines are costed from batches using FEFO/FIFO when posted.">
    <StepHeading number="4" title="Create the issue voucher and pick approved articles" />
    <Field label="Approved requisition"><Select value={form.request} change={(v) => setForm({ request: v })} rows={approved} label={(r) => id(r.requisition_no)} /></Field>
    <Field label="Issued by"><Select value={form.employee} change={(v) => setForm({ ...form, employee: v })} rows={app.data.employees} /></Field>
    <Action disabled={busy || !request || !form.employee} click={() => execute(() => createBackendRecord('stock-issues', { requisition: request.id, store: request.store, issued_by: form.employee, note: '' }), 'Issue voucher created')}>Create issue voucher</Action>
    {!requestLines.length && form.request && <Hint>No approved lines exist on this requisition.</Hint>}
    <Rule />
    <Field label="Issue voucher"><Select value={form.issue} change={(v) => setForm({ issue: v })} rows={data.issues} label={(r) => id(r.issue_no)} /></Field>
    <Field label="Approved request line"><Select value={form.requestLine} change={(v) => setForm({ ...form, requestLine: v })} rows={issueRequestLines} label={(r) => `${itemName(app, r.item)} · ${r.outstanding_quantity} outstanding`} /></Field>
    <Field label="Pick quantity"><Input type="number" value={form.quantity} change={(v) => setForm({ ...form, quantity: v })} /></Field>
    <Action disabled={busy || !form.issue || !form.requestLine} click={() => execute(() => createBackendRecord('stock-issue-items', { issue: form.issue, requisition_item: form.requestLine, unit: null, quantity: num(form.quantity) }), 'Article added to pick list')}>Add pick line</Action>
    <Rule />
    <StepHeading number="5" title="Post the completed issue" />
    <div style={{ margin: '-3px 0 9px', color: 'var(--text-faint)', fontSize: 11.5 }}>Posting reduces store stock and records department consumption. Check the voucher first.</div>
    <Action tone="good" disabled={busy || !form.issue} click={() => execute(() => runBackendAction('stock-issues', id(form.issue), 'apply'), 'Stock issued and consumption posted')}>Post issue</Action>
    <Rule />
    <StepHeading number="6" title="Confirm who received the articles" />
    <Field label="Receiving employee"><Select value={form.receiver} change={(v) => setForm({ ...form, receiver: v })} rows={app.data.employees} optional /></Field>
    <Field label="Receiver name"><Input value={form.receiverName} change={(v) => setForm({ ...form, receiverName: v })} /></Field>
    <Action disabled={busy || !form.issue} click={() => execute(() => runBackendAction('stock-issues', id(form.issue), 'acknowledge', { received_by: form.receiver || null, received_by_name: form.receiverName || '' }), 'Department receipt acknowledged')}>Acknowledge receipt</Action>
  </Panel>
}

function TransferPanel({ app, data, form, setForm, busy, execute }: any) {
  const transfer = data.transfers.find((r: Row) => id(r.id) === id(form.transfer))
  return <Panel title="Inter-store transfer" note="Dispatch removes source stock. Receipt adds it to the destination.">
    <Field label="From store"><Select value={form.from} change={(v) => setForm({ ...form, from: v })} rows={app.data.locations} /></Field>
    <Field label="To store"><Select value={form.to} change={(v) => setForm({ ...form, to: v })} rows={app.data.locations} /></Field>
    <Field label="Requested by"><Select value={form.employee} change={(v) => setForm({ ...form, employee: v })} rows={app.data.employees} /></Field>
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
  return <Panel title="Controlled stock adjustment" note="Use signed quantities. Negative adjustments cannot create negative stock.">
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
  return <Panel title="Blind stock count and variance" note="Populate system lines, enter physical quantities, submit, approve and apply variances.">
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
  return <Panel title="Department store return" note="Return unused issued stock to the selected store.">
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
  return <Panel title="Low-stock purchase queue" note="Create a controlled draft purchase requisition from an active reorder rule. The backend prevents reordering stock that is above its minimum.">
    <Field label="Low-stock rule"><Select value={form.rule} change={(v) => setForm({ rule: v })} rows={belowMinimum} label={(rule) => `${itemName(app, rule.item)} · reorder ${rule.reorder_quantity}`} /></Field>
    <Field label="Procurement reason"><Input value={form.reason} change={(v) => setForm({ ...form, reason: v })} /></Field>
    <Action disabled={busy || !form.rule} click={() => execute(() => runBackendAction('reorder-rules', id(form.rule), 'create-purchase-requisition', { reason: form.reason || '' }), 'Draft purchase requisition created from low stock')}>Create purchase requisition</Action>
    {!belowMinimum.length && <Hint>No active reorder rules are currently below minimum.</Hint>}
  </Panel>
}

function ReadOnlyPanel({ title, note }: { title: string; note: string }) {
  return <Panel title={title} note={note}><div style={{ padding: 12, borderRadius: 6, color: 'var(--text-muted)', background: 'var(--surface-2)', fontSize: 11.5 }}>These records are system-generated. Use the list and document drawer for review and printing.</div></Panel>
}

function Records({ tab, data, app, onSelect }: { tab: Tab; data: Record<string, Row[]>; app: any; onSelect: (row: Row) => void }) {
  const rows = data[tab]
  const cells = (row: Row) => tab === 'requests' ? [id(row.requisition_no), departmentName(app, row.department), storeName(app, row.store), id(row.status)]
    : tab === 'issues' ? [id(row.issue_no), storeName(app, row.store), row.inventory_changes_applied ? 'Posted' : 'Draft', id(row.received_by_name) || 'Not acknowledged']
    : tab === 'transfers' ? [storeName(app, row.from_store), storeName(app, row.to_store), id(row.total_quantity), id(row.status)]
    : tab === 'adjustments' ? [id(row.reference) || id(row.id).slice(0, 8), storeName(app, row.store), id(row.reason), id(row.status)]
    : tab === 'counts' ? [id(row.count_no), storeName(app, row.store), id(row.count_date), id(row.status)]
    : tab === 'returns' ? [id(row.return_no), departmentName(app, row.department), storeName(app, row.store), row.inventory_changes_applied ? 'Posted' : 'Draft']
      : tab === 'reorder' ? [itemName(app, row.item), storeName(app, row.store) || 'All stores', `Min ${row.minimum_level}`, `Reorder ${row.reorder_quantity}`]
        : tab === 'batches' ? [itemName(app, row.item), storeName(app, row.store), `Remaining ${row.remaining_quantity}`, id(row.expiry_date) || 'No expiry']
          : [departmentName(app, row.department), itemName(app, row.item), `${row.quantity} × ${row.unit_cost}`, id(row.consumed_on)]
  const titles: Record<Tab, string> = { requests: 'Department material requests', issues: 'Issue vouchers', transfers: 'Inter-store transfers', adjustments: 'Stock adjustments', counts: 'Stock counts', returns: 'Department returns', reorder: 'Low-stock reorder queue', batches: 'Inventory batches and expiry', consumption: 'Department consumption' }
  return <section style={{ ...card, overflow: 'hidden' }}><div style={{ padding: '15px 17px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 800 }}>{titles[tab]}</div>{rows.map((row) => <button type="button" onClick={() => onSelect(row)} className="procurement-record-row" key={id(row.id)} style={{ ...recordRow, width: '100%', alignItems: 'center', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>{cells(row).map((cell, index) => <span key={index} style={{ color: index ? 'var(--text-muted)' : 'var(--text)', fontWeight: index ? 500 : 700 }}>{cell || '—'}</span>)}</button>)}{!rows.length && <div style={{ padding: 45, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No {titles[tab].toLowerCase()} are waiting here.</div>}</section>
}

function InventoryRecordDrawer({ tab, row, data, app, close }: { tab: Tab; row: Row; data: Record<string, Row[]>; app: any; close: () => void }) {
  if (['reorder', 'batches', 'consumption'].includes(tab)) {
    const title = tab === 'reorder' ? 'Reorder rule' : tab === 'batches' ? 'Inventory batch' : 'Department consumption'
    const fields = Object.entries(row).filter(([key]) => !['id', 'created_by', 'updated_at'].includes(key))
    return <><div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.38)' }} /><aside className="procurement-detail-drawer inventory-print-document" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 81, width: 520, maxWidth: '94vw', padding: 22, overflowY: 'auto', background: 'var(--surface)', boxShadow: '-12px 0 32px rgba(15,23,42,.18)' }}><div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}><div><div style={{ color: 'var(--text-faint)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{title}</div><h2 style={{ margin: '4px 0 0', fontSize: 19 }}>{itemName(app, row.item)}</h2></div><button onClick={close} style={{ marginLeft: 'auto', width: 32, height: 32, border: 0, borderRadius: 6, cursor: 'pointer' }}><Icon name="close" size={18} /></button></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{fields.map(([key, value]) => <div key={key} style={{ minHeight: 65, padding: 12, borderBottom: '1px solid var(--border)' }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, textTransform: 'uppercase' }}>{key.replace(/_/g, ' ')}</div><div style={{ marginTop: 5, color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>{id(value) || '—'}</div></div>)}</div></aside></>
  }
  const configs: Record<string, { title: string; ref: string; lines: Row[] }> = {
    requests: { title: 'Store requisition', ref: id(row.requisition_no), lines: data.requestItems.filter((line) => id(line.requisition) === id(row.id)) },
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
    ['Department approval', id(row.department_approved_at) ? `Approved · ${id(row.department_approval_comments) || 'No comment'}` : 'Pending or not required'],
    ['Approval comments', id(row.approval_comments) || '—'], ['Rejection reason', id(row.rejection_reason) || '—'],
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
  const lineQuantity = (line: Row) => tab === 'requests' ? `Requested ${line.base_quantity_requested} · Approved ${line.quantity_approved} · Issued ${line.quantity_issued}`
    : tab === 'counts' ? `System ${line.system_quantity} · Physical ${line.physical_quantity} · Variance ${num(line.physical_quantity) - num(line.system_quantity)}`
      : tab === 'adjustments' ? `Change ${line.quantity_change}` : `Quantity ${line.base_quantity || line.quantity}`
  return <>
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.38)' }} />
    <aside className="procurement-detail-drawer inventory-print-document" role="dialog" aria-modal="true" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 81, width: 560, maxWidth: '94vw', display: 'flex', flexDirection: 'column', background: 'var(--surface)', boxShadow: '-12px 0 32px rgba(15,23,42,.18)', animation: 'slideIn .2s ease' }}>
      <header className="screen-document-view" style={{ padding: '19px 22px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}><span style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 8, color: 'var(--accent)', background: 'var(--accent-soft)' }}><Icon name="inventory_2" size={21} /></span><div style={{ flex: 1 }}><div style={{ color: 'var(--text-faint)', fontSize: 10.5, textTransform: 'uppercase', fontWeight: 700 }}>{config.title}</div><div style={{ marginTop: 3, color: 'var(--text)', fontSize: 18, fontWeight: 750 }}>{config.ref}</div></div><span style={{ color: 'var(--accent)', background: 'var(--accent-soft)', padding: '4px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 }}>{id(row.status) || (row.inventory_changes_applied ? 'Posted' : 'Draft')}</span><button onClick={close} aria-label="Close" style={{ width: 32, height: 32, border: 0, borderRadius: 6, background: 'var(--surface-2)', cursor: 'pointer' }}><Icon name="close" size={18} /></button></header>
      <div className="screen-document-view" style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{details.map(([label, value]) => <div key={label} style={{ minHeight: 68, padding: 13, borderBottom: '1px solid var(--border)' }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 5, color: 'var(--text)', fontSize: 12.5, fontWeight: 600 }}>{value}</div></div>)}</div>
        <h3 style={{ margin: '24px 0 10px', fontSize: 13 }}>Line items ({config.lines.length})</h3>
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
function RoleAction({ actor, title, note }: { actor: string; title: string; note: string }) { return <div style={{ margin: '0 0 14px', padding: '10px 11px', borderLeft: '3px solid var(--accent)', borderRadius: '0 6px 6px 0', background: 'var(--accent-soft)' }}><div style={{ color: 'var(--accent)', fontSize: 9, fontWeight: 850, letterSpacing: '.07em', textTransform: 'uppercase' }}>{actor}</div><div style={{ marginTop: 3, color: 'var(--text)', fontSize: 12, fontWeight: 750 }}>{title}</div><div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.4 }}>{note}</div></div> }
function StepHeading({ number, title }: { number: string; title: string }) { return <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px', color: 'var(--text)', fontSize: 12, fontWeight: 750 }}><span style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 20, color: '#fff', background: 'var(--accent)', fontSize: 10 }}>{number}</span>{title}</div> }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: 'block', marginBottom: 10 }}><HelpLabel label={label} style={labelStyle} />{children}</label> }
function Input({ value, change, type = 'text' }: { value: unknown; change: (value: string) => void; type?: string }) { return <input type={type} value={id(value)} onChange={(e) => change(e.target.value)} style={control} /> }
function Select({ value, change, rows, label = (r: Row) => id(r.name), optional = false }: { value: unknown; change: (value: string) => void; rows: Row[]; label?: (row: Row) => string; optional?: boolean }) { return <select value={id(value)} onChange={(e) => change(e.target.value)} style={control}><option value="">{optional ? 'None' : 'Select…'}</option>{rows.map((row) => <option key={id(row.id)} value={id(row.id)}>{label(row)}</option>)}</select> }
function Action({ children, click, disabled, tone = 'accent' }: any) { return <button type="button" onClick={click} disabled={disabled} style={{ ...action, opacity: disabled ? .45 : 1, background: tone === 'good' ? 'var(--good)' : tone === 'danger' ? 'var(--bad)' : 'var(--accent)' }}>{children}</button> }
function Rule() { return <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} /> }
function Hint({ children }: { children: ReactNode }) { return <div style={{ padding: 9, color: 'var(--warn)', background: 'var(--warn-soft)', borderRadius: 6, fontSize: 11 }}>{children}</div> }
const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-sm)' }
const hero: CSSProperties = { width: 46, height: 46, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent)' }
const eyebrow: CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.11em', color: 'var(--accent)' }
const muted: CSSProperties = { color: 'var(--text-muted)', fontSize: 12 }
const secondary: CSSProperties = { height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', cursor: 'pointer' }
const tabButton: CSSProperties = { height: 38, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', border: '1px solid', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 650 }
const labelStyle: CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }
const control: CSSProperties = { width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12 }
const action: CSSProperties = { width: '100%', minHeight: 38, border: 0, borderRadius: 6, color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, marginTop: 5 }
const recordRow: CSSProperties = { display: 'grid', gridTemplateColumns: '1.2fr 1.3fr 1fr 1fr', gap: 10, padding: '12px 17px', borderBottom: '1px solid var(--border)', fontSize: 12 }
