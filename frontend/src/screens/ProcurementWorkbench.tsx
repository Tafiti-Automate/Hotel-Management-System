import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { HelpLabel } from '../components/HelpLabel'
import { WorkflowPath } from '../components/WorkflowPath'
import { createBackendRecord, deleteBackendPath, downloadControlledPurchaseOrder, downloadProcurementAttachment, errorMessage, readBackendPayload, readBackendRecords, runBackendAction, updateBackendRecord, uploadProcurementAttachment } from '../lib/api'
import type { Row } from '../lib/data'
import { chipStyleFor, money } from '../lib/theme'
import { useApp } from '../state/AppContext'

type Stage = 'request' | 'quote' | 'lpo' | 'receipt' | 'inspect' | 'return'
type Datasets = Record<string, Row[]>

const paths = {
  requisitions: 'requisitions', requisitionItems: 'requisition-items',
  approvals: 'approvals',
  quotations: 'quotations', quotationItems: 'quotation-items',
  orders: 'purchase-orders', orderItems: 'purchase-order-items',
  receipts: 'grns', receiptItems: 'grn-items',
  inspections: 'goods-inspections', inspectionItems: 'goods-inspection-items',
  returns: 'supplier-returns', returnItems: 'supplier-return-items',
  attachments: 'procurement-attachments',
  communications: 'procurement-communications',
  history: 'audit-logs',
  requisitionHistory: 'requisition-history',
} as const

const pathViewPermissions: Record<keyof typeof paths, string> = {
  requisitions: 'procurement.view_purchaserequisition',
  requisitionItems: 'procurement.view_requisitionitem',
  approvals: 'approvals.view_approvalworkflow',
  quotations: 'procurement.view_vendorquotation',
  quotationItems: 'procurement.view_vendorquotationitem',
  orders: 'procurement.view_purchaseorder',
  orderItems: 'procurement.view_purchaseorderitem',
  receipts: 'procurement.view_goodsreceiptnote',
  receiptItems: 'procurement.view_goodsreceiptitem',
  inspections: 'procurement.view_goodsinspection',
  inspectionItems: 'procurement.view_goodsinspectionitem',
  returns: 'procurement.view_supplierreturn',
  returnItems: 'procurement.view_supplierreturnitem',
  attachments: 'procurement.view_procurementattachment',
  communications: 'procurement.view_procurementcommunication',
  history: 'audit_logs.view_auditlog',
  requisitionHistory: 'procurement.view_requisitionhistory',
}

const stagePermissions: Record<Stage, { view: string; change: string }> = {
  request: { view: 'procurement.view_purchaserequisition', change: 'procurement.change_purchaserequisition' },
  quote: { view: 'procurement.view_vendorquotation', change: 'procurement.change_vendorquotation' },
  lpo: { view: 'procurement.view_purchaseorder', change: 'procurement.change_purchaseorder' },
  receipt: { view: 'procurement.view_goodsreceiptnote', change: 'procurement.change_goodsreceiptnote' },
  inspect: { view: 'procurement.view_goodsinspection', change: 'procurement.change_goodsinspection' },
  return: { view: 'procurement.view_supplierreturn', change: 'procurement.change_supplierreturn' },
}

const empty: Datasets = Object.fromEntries(Object.keys(paths).map((key) => [key, []]))

function id(value: unknown) { return String(value || '') }
function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0 }
function fileSize(value: unknown) {
  const bytes = num(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ProcurementWorkbench() {
  const app = useApp()
  const [stage, setStage] = useState<Stage>(() => {
    const role = app.user.role.toLowerCase()
    if (['receiving clerk', 'receiving officer'].includes(role)) return 'receipt'
    if (app.user.isSuperuser) return 'request'
    return (Object.keys(stagePermissions) as Stage[]).find((candidate) =>
      app.user.permissions.includes(stagePermissions[candidate].view)
    ) || 'request'
  })
  const [data, setData] = useState<Datasets>(empty)
  const [form, setForm] = useState<Row>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<Row | null>(null)
  const can = useCallback(
    (permission: string) => app.user.isSuperuser || app.user.permissions.includes(permission),
    [app.user.isSuperuser, app.user.permissions],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const payload = await readBackendPayload(`requisitions/workspace?stage=${stage}`)
      setData((current) => ({ ...current, ...payload }))
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [stage])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setForm({}); setMessage(''); setSelectedRecord(null) }, [stage])
  useEffect(() => {
    if (!app.procurementDraftId) return
    setStage('request')
    setForm({ requisition: app.procurementDraftId })
    app.consumeProcurementDraft()
  }, [app.procurementDraftId, app.consumeProcurementDraft])
  const scopedData = useMemo(() => {
    if (!app.currentBranch) return data
    const employees = new Set(app.data.employees.map((row) => id(row.id)))
    const stores = new Set(app.data.locations.map((row) => id(row.id)))
    const next = { ...data }
    next.requisitions = data.requisitions.filter((row) => !row.requester || employees.has(id(row.requester)))
    const requisitions = new Set(next.requisitions.map((row) => id(row.id)))
    next.requisitionItems = data.requisitionItems.filter((row) => requisitions.has(id(row.requisition)))
    next.approvals = data.approvals.filter((row) => requisitions.has(id(row.requisition)))
    next.requisitionHistory = data.requisitionHistory.filter((row) => requisitions.has(id(row.requisition)))
    next.quotations = data.quotations.filter((row) => requisitions.has(id(row.requisition)))
    const quotations = new Set(next.quotations.map((row) => id(row.id)))
    next.quotationItems = data.quotationItems.filter((row) => quotations.has(id(row.quotation)))
    next.orders = data.orders.filter((row) => requisitions.has(id(row.requisition)) && (!row.store || stores.has(id(row.store))))
    const orders = new Set(next.orders.map((row) => id(row.id)))
    next.orderItems = data.orderItems.filter((row) => orders.has(id(row.purchase_order)))
    next.receipts = data.receipts.filter((row) => orders.has(id(row.purchase_order)))
    const receipts = new Set(next.receipts.map((row) => id(row.id)))
    next.receiptItems = data.receiptItems.filter((row) => receipts.has(id(row.goods_receipt)))
    next.inspections = data.inspections.filter((row) => receipts.has(id(row.goods_receipt)))
    const inspections = new Set(next.inspections.map((row) => id(row.id)))
    next.inspectionItems = data.inspectionItems.filter((row) => inspections.has(id(row.inspection)))
    next.returns = data.returns.filter((row) => receipts.has(id(row.goods_receipt)) && stores.has(id(row.store)))
    const returns = new Set(next.returns.map((row) => id(row.id)))
    next.returnItems = data.returnItems.filter((row) => returns.has(id(row.supplier_return)))
    return next
  }, [app.currentBranch, app.data.employees, app.data.locations, data])

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setMessage('')
    try {
      await operation()
      await Promise.all([load(), Promise.resolve(app.refreshData())])
      setForm({})
      app.showToast(success)
    } catch (error) {
      const detail = errorMessage(error)
      setMessage(detail)
      app.showWorkflowAlert('Workflow requirement not completed', detail)
    } finally {
      setBusy(false)
    }
  }

  const openRecord = async (row: Row) => {
    setSelectedRecord(row)
    const documentType = stage === 'request' ? 'purchase_requisition'
      : stage === 'quote' ? 'quotation'
        : stage === 'lpo' ? 'purchase_order'
          : stage === 'receipt' ? 'grn'
            : stage === 'inspect' ? 'inspection'
              : 'supplier_return'
    const requisitionId = stage === 'request' || stage === 'quote' || stage === 'lpo'
      ? id(stage === 'request' ? row.requisition : row.requisition)
      : ''
    const requests: Array<Promise<[string, Row[]]>> = []
    if (can(pathViewPermissions.attachments)) {
      requests.push(readBackendRecords(`procurement-attachments?document_type=${documentType}&document_id=${id(row.id)}`).then((rows) => ['attachments', rows]))
    }
    if (stage === 'lpo' && can(pathViewPermissions.communications)) {
      requests.push(readBackendRecords(`procurement-communications?purchase_order=${id(row.id)}`).then((rows) => ['communications', rows]))
    }
    if (requisitionId && can(pathViewPermissions.requisitionHistory)) {
      requests.push(readBackendRecords(`requisition-history?requisition=${requisitionId}`).then((rows) => ['requisitionHistory', rows]))
    } else if (can(pathViewPermissions.history)) {
      requests.push(readBackendRecords(`audit-logs?entity_id=${id(row.id)}`).then((rows) => ['history', rows]))
    }
    const evidence = await Promise.all(requests.map((request) => request.catch(() => ['', []] as [string, Row[]])))
    setData((current) => ({ ...current, ...Object.fromEntries(evidence.filter(([key]) => key)) }))
  }

  const names = useMemo(() => ({
    items: new Map(app.data.items.map((row) => [id(row.id), id(row.name)])),
    suppliers: new Map(app.data.suppliers.map((row) => [id(row.id), id(row.name)])),
    employees: new Map(app.data.employees.map((row) => [id(row.id), id(row.name)])),
    stores: new Map(app.data.locations.map((row) => [id(row.id), id(row.name)])),
    departments: new Map(app.data.departments.map((row) => [id(row.id), id(row.name)])),
    units: new Map(app.data.uoms.map((row) => [id(row.id), id(row.name)])),
  }), [app.data])

  const requisitionLabel = (row: Row) => `${id(row.requisition_number) || `PR-${id(row.id).slice(0, 8).toUpperCase()}`} · ${id(row.procurement_source) === 'store_shortage' ? 'Store shortage' : 'Manual'} · ${id(row.reason)}`
  const orderLabel = (row: Row) => `${id(row.po_number) || id(row.id).slice(0, 8)} · ${names.suppliers.get(id(row.supplier)) || 'Supplier'}`
  const receiptLabel = (row: Row) => id(row.grn_number) || `GRN-${id(row.id).slice(0, 8).toUpperCase()}`

  const tabs: Array<[Stage, string, string]> = ([
    ['request', '1', 'Requisition lines'], ['quote', '2', 'Quotation comparison'],
    ['lpo', '3', 'LPO'], ['receipt', '4', 'Goods receipt'],
    ['inspect', '5', 'Inspection'], ['return', '6', 'Supplier return'],
  ] as Array<[Stage, string, string]>).filter(([key]) => can(stagePermissions[key].view))
  const stageGuidance: Record<Stage, { actor: string; description: string; icon: string }> = {
    request: { actor: 'Requester', description: 'Add every required article, then submit the requisition.', icon: 'playlist_add' },
    quote: { actor: 'Procurement', description: 'Record comparable supplier offers and select the winner.', icon: 'compare_arrows' },
    lpo: { actor: 'Buyer and LPO approvers', description: 'Prepare, independently approve, then issue the supplier order.', icon: 'receipt_long' },
    receipt: { actor: 'Receiving / stores', description: 'Record what the supplier delivered against the LPO.', icon: 'move_to_inbox' },
    inspect: { actor: 'Inspector', description: 'Accept or reject delivered quantities before stock posting.', icon: 'fact_check' },
    return: { actor: 'Stores / procurement', description: 'If needed, send rejected or damaged goods back to the supplier.', icon: 'assignment_return' },
  }
  useEffect(() => {
    if (tabs.length && !tabs.some(([key]) => key === stage)) setStage(tabs[0][0])
  }, [stage, tabs])
  const canChangeStage = can(stagePermissions[stage].change)
  const canManageLpo = app.user.isSuperuser || ['system administrator', 'procurement manager'].includes(app.user.role.toLowerCase())
  const metrics = useMemo(() => {
    const openOrders = scopedData.orders.filter((order) => ['issued', 'partially_received'].includes(id(order.status)))
    const overdue = openOrders.filter((order) => order.expected_date && new Date(id(order.expected_date)) < new Date())
    const unpostedReceipts = scopedData.receiptItems.filter((line) => !line.inventory_changes_applied)
    const received = scopedData.inspectionItems.reduce((total, line) => total + num(line.quantity_received), 0)
    const accepted = scopedData.inspectionItems.reduce((total, line) => total + num(line.quantity_accepted), 0)
    return {
      commitment: openOrders.reduce((total, order) => total + num(order.total_amount), 0),
      overdue: overdue.length,
      unposted: unpostedReceipts.length,
      acceptance: received ? Math.round((accepted / received) * 100) : 0,
    }
  }, [scopedData])

  return (
    <div style={{ maxWidth: 1480, margin: '0 auto' }}>
      <div style={{ ...card, padding: 20, marginBottom: 16 }}>
        <div className="workbench-hero" style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={heroIcon}><Icon name="shopping_cart_checkout" size={24} color="#fff" /></span>
          <div>
            <div style={eyebrow}>Procure to receive</div>
            <h1 style={{ margin: '3px 0', fontSize: 23, color: 'var(--text)' }}>Procurement workbench</h1>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Build each document from its approved predecessor. All changes are saved directly to the backend.</div>
          </div>
          <button onClick={() => void load()} style={{ ...secondary, marginLeft: 'auto' }}><Icon name="refresh" size={17} />Refresh</button>
        </div>
      </div>
      <div className="workbench-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
        <Metric label="Open commitments" value={money(metrics.commitment)} icon="account_balance_wallet" />
        <Metric label="Overdue LPOs" value={id(metrics.overdue)} icon="schedule" tone={metrics.overdue ? 'warn' : 'good'} />
        <Metric label="Unposted receipt lines" value={id(metrics.unposted)} icon="pending_actions" tone={metrics.unposted ? 'warn' : 'good'} />
        <Metric label="Supplier acceptance" value={`${metrics.acceptance}%`} icon="verified" tone={metrics.acceptance >= 90 ? 'good' : 'warn'} />
      </div>

      <WorkflowPath
        title="Procurement workflow"
        summary="Track requisitions, quotations, orders and receipts."
        activeKey={stage}
        onSelect={(key) => setStage(key as Stage)}
        steps={tabs.map(([key, , label]) => ({ key, label, ...stageGuidance[key] }))}
      />

      {message && <div style={{ ...card, padding: 13, marginBottom: 14, borderColor: 'rgba(220,38,38,.3)', color: 'var(--bad)', fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><span>{message}</span><button type="button" onClick={() => void load()} style={secondary}>Retry</button></div>}
      {loading ? <div style={{ ...card, padding: 50, textAlign: 'center', color: 'var(--text-faint)' }}>Loading procurement records from the backend…</div> : (
        <div className="workbench-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) minmax(340px,.75fr)', gap: 16, alignItems: 'start' }}>
          <section style={{ ...card, overflow: 'hidden' }}>
            <StageTable stage={stage} data={scopedData} names={names} onSelect={(row) => void openRecord(row)} />
          </section>
          <aside style={{ ...card, padding: 18 }}>
            {!canChangeStage && stage !== 'lpo' && <ReadOnlyStage />}
            {canChangeStage && stage === 'request' && <RequestPanel {...{ data: scopedData, form, setForm, busy, run, requisitionLabel }} items={app.data.items} stores={app.data.locations} departments={app.data.departments} />}
            {canChangeStage && stage === 'quote' && <QuotePanel {...{ data: scopedData, form, setForm, busy, run, requisitionLabel, names }} suppliers={app.data.suppliers} units={app.data.uoms} items={app.data.items} itemUnits={app.data.itemUnits} />}
            {stage === 'lpo' && <LpoPanel {...{ data: scopedData, form, setForm, busy, run, requisitionLabel, orderLabel, names }} canManage={canManageLpo} suppliers={app.data.suppliers} employees={app.data.employees} stores={app.data.locations} units={app.data.uoms} items={app.data.items} itemUnits={app.data.itemUnits} />}
            {canChangeStage && stage === 'receipt' && <ReceiptPanel {...{ data: scopedData, form, setForm, busy, run, orderLabel, receiptLabel, names }} employees={app.data.employees} stores={app.data.locations} />}
            {canChangeStage && stage === 'inspect' && <InspectionPanel {...{ data: scopedData, form, setForm, busy, run, receiptLabel, names }} employees={app.data.employees} />}
            {canChangeStage && stage === 'return' && <ReturnPanel {...{ data: scopedData, form, setForm, busy, run, receiptLabel, names }} employees={app.data.employees} stores={app.data.locations} />}
          </aside>
        </div>
      )}
      {selectedRecord && <ProcurementRecordDrawer stage={stage} row={selectedRecord} data={scopedData} names={names} canAttach={can('procurement.add_procurementattachment')} onChanged={load} onClose={() => setSelectedRecord(null)} />}
    </div>
  )
}

function Metric({ label, value, icon, tone = 'accent' }: { label: string; value: string; icon: string; tone?: 'accent' | 'good' | 'warn' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)'
  return <div style={{ ...card, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 11 }}><span style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 7, color, background: tone === 'good' ? 'var(--good-soft)' : tone === 'warn' ? 'var(--warn-soft)' : 'var(--accent-soft)' }}><Icon name={icon} size={18} /></span><div><div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 3, color: 'var(--text)', fontSize: 15, fontWeight: 750 }}>{value}</div></div></div>
}

function RequestPanel({ data, form, setForm, busy, run, requisitionLabel, items, stores, departments }: any) {
  const app = useApp()
  const [inbox, setInbox] = useState<'shortages' | 'manual' | 'all'>('shortages')
  const shortageRequests = data.requisitions.filter((row: Row) => id(row.procurement_source) === 'store_shortage')
  const manualRequests = data.requisitions.filter((row: Row) => id(row.procurement_source) !== 'store_shortage')
  const inboxRows = inbox === 'shortages' ? shortageRequests : inbox === 'manual' ? manualRequests : data.requisitions
  const drafts = inboxRows.filter((row: Row) => ['draft', 'rejected', 'returned'].includes(id(row.status)))
  const lines = data.requisitionItems.filter((row: Row) => id(row.requisition) === id(form.requisition))
  const editing = lines.find((row: Row) => id(row.id) === id(form.requestLine))
  const duplicate = !editing && lines.some((row: Row) => id(row.item) === id(form.item))
  const selectedItem = items.find((item: Row) => id(item.id) === id(form.item))
  return <Panel title="Procurement inbox" note="Store shortages are generated by Stores; manual requests are reserved for exceptional purchases.">
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 7, marginBottom: 12 }}>
      <button type="button" onClick={() => setInbox('shortages')} style={{ ...secondary, justifyContent: 'center', borderColor: inbox === 'shortages' ? 'var(--accent)' : 'var(--border)', color: inbox === 'shortages' ? 'var(--accent)' : 'var(--text-muted)' }}>Store shortages ({shortageRequests.length})</button>
      <button type="button" onClick={() => setInbox('manual')} style={{ ...secondary, justifyContent: 'center', borderColor: inbox === 'manual' ? 'var(--accent)' : 'var(--border)', color: inbox === 'manual' ? 'var(--accent)' : 'var(--text-muted)' }}>Manual requests ({manualRequests.length})</button>
      <button type="button" onClick={() => setInbox('all')} style={{ ...secondary, justifyContent: 'center', borderColor: inbox === 'all' ? 'var(--accent)' : 'var(--border)', color: inbox === 'all' ? 'var(--accent)' : 'var(--text-muted)' }}>All ({data.requisitions.length})</button>
    </div>
    {inbox === 'shortages' && <Hint>These requisitions contain only quantities unavailable in Stores and retain a link to the originating Store Request.</Hint>}
    {inbox !== 'shortages' && <Action disabled={busy} onClick={() => app.openCreate('requisitions', 'New manual purchase request')}>New exceptional purchase request</Action>}
    <Divider />
    <Field label="Draft requisition"><Select value={form.requisition} onChange={(v) => setForm({ ...form, requisition: v })} rows={drafts} label={requisitionLabel} /></Field>
    <Field label="Existing line"><Select optional value={form.requestLine} onChange={(v) => { const line = lines.find((row: Row) => id(row.id) === v); setForm({ ...form, requestLine: v, item: line?.item || '', quantity: line?.quantity || '', cost: line?.estimated_unit_cost || '', destinationType: line?.destination_type || 'store', destinationStore: line?.destination_store || '', destinationDepartment: line?.destination_department || '', destinationJustification: line?.destination_justification || '' }) }} rows={lines} label={(row: Row) => `${items.find((item: Row) => id(item.id) === id(row.item))?.name || id(row.item)} · ${row.quantity} · ${row.destination_type === 'workspace' ? 'Direct' : 'Store'}`} /></Field>
    <Field label="Article"><Select value={form.item} onChange={(v) => setForm({ ...form, item: v })} rows={items} /></Field>
    <Two><Field label={`Quantity${selectedItem?.uom ? ` (${selectedItem.uom})` : ''}`}><Input type="number" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} /></Field><Field label={`Estimated cost per ${selectedItem?.uom || 'base unit'}`}><Input type="number" value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} /></Field></Two>
    <Field label="Approved destination route"><Select value={form.destinationType || 'store'} onChange={(v) => setForm({ ...form, destinationType: v, destinationStore: v === 'store' ? form.destinationStore : '', destinationDepartment: v === 'workspace' ? form.destinationDepartment : '' })} rows={[{ id: 'store', name: 'Receive into store inventory' }, { id: 'workspace', name: 'Deliver directly to workspace' }]} /></Field>
    {(form.destinationType || 'store') === 'store'
      ? <Field label="Receiving store"><Select value={form.destinationStore} onChange={(v) => setForm({ ...form, destinationStore: v })} rows={stores} /></Field>
      : <><Field label="Workspace department"><Select value={form.destinationDepartment} onChange={(v) => setForm({ ...form, destinationDepartment: v })} rows={departments} /></Field><Field label="Direct-delivery justification"><Input value={form.destinationJustification} onChange={(v) => setForm({ ...form, destinationJustification: v })} /></Field></>}
    {selectedItem && <Hint>Purchase demand is recorded in the base stock unit: {selectedItem.uom}. Procurement may later request supplier prices in a configured carton, case, or pallet.</Hint>}
    {duplicate && <Hint>This Article already exists. Select its existing line to edit it.</Hint>}
    {!editing && <Action disabled={busy || duplicate || !form.requisition || !form.item || ((form.destinationType || 'store') === 'store' ? !form.destinationStore : !form.destinationDepartment || !form.destinationJustification)} onClick={() => run(() => createBackendRecord('requisition-items', { requisition: form.requisition, item: form.item, quantity: num(form.quantity), estimated_unit_cost: num(form.cost), destination_type: form.destinationType || 'store', destination_store: form.destinationType === 'workspace' ? null : form.destinationStore, destination_department: form.destinationType === 'workspace' ? form.destinationDepartment : null, destination_justification: form.destinationJustification || '' }), 'Requisition line added')}>Add line</Action>}
    {editing && <><Action disabled={busy || !form.item || ((form.destinationType || 'store') === 'store' ? !form.destinationStore : !form.destinationDepartment || !form.destinationJustification)} onClick={() => run(() => updateBackendRecord('requisition-items', id(editing.id), { requisition: form.requisition, item: form.item, quantity: num(form.quantity), estimated_unit_cost: num(form.cost), destination_type: form.destinationType || 'store', destination_store: form.destinationType === 'workspace' ? null : form.destinationStore, destination_department: form.destinationType === 'workspace' ? form.destinationDepartment : null, destination_justification: form.destinationJustification || '' }), 'Requisition line updated')}>Save line changes</Action><Action tone="danger" disabled={busy} onClick={() => run(() => deleteBackendPath('requisition-items', id(editing.id)), 'Requisition line removed')}>Remove line</Action></>}
    <Divider />
    <Action tone="good" disabled={busy || !form.requisition} onClick={() => run(() => runBackendAction('requisitions', id(form.requisition), 'submit'), 'Requisition submitted')}>Submit requisition</Action>
    <Action tone="danger" disabled={busy || !form.requisition} onClick={() => run(() => runBackendAction('requisitions', id(form.requisition), 'cancel'), 'Requisition cancelled')}>Cancel requisition</Action>
  </Panel>
}

function QuotePanel({ data, form, setForm, busy, run, requisitionLabel, names, suppliers, units, items, itemUnits }: any) {
  const reqLines = data.requisitionItems.filter((row: Row) => id(row.requisition) === id(form.requisition))
  const quotes = data.quotations.filter((row: Row) => !form.requisition || id(row.requisition) === id(form.requisition))
  const selectedQuote = data.quotations.find((row: Row) => id(row.id) === id(form.quotation))
  const quoteReqLines = data.requisitionItems.filter((row: Row) => id(row.requisition) === id(selectedQuote?.requisition))
  const quoteLines = data.quotationItems.filter((row: Row) => id(row.quotation) === id(form.quotation))
  const editing = quoteLines.find((row: Row) => id(row.id) === id(form.quoteLine))
  const duplicate = !editing && quoteLines.some((row: Row) => id(row.requisition_item) === id(form.reqLine))
  const selectedReqLine = quoteReqLines.find((row: Row) => id(row.id) === id(form.reqLine))
  const selectedItem = items.find((item: Row) => id(item.id) === id(selectedReqLine?.item))
  const availableUnits = configuredUnitsForItem(selectedItem, units, itemUnits)
  const conversion = conversionFactorFor(selectedItem, form.unit, itemUnits)
  const requestedBase = num(selectedReqLine?.requested_base_quantity || selectedReqLine?.quantity)
  const selectedRequisition = data.requisitions.find((row: Row) => id(row.id) === id(form.requisition || selectedQuote?.requisition))
  const quotationThreshold = 1000000
  const requiredQuotationCount = num(selectedRequisition?.estimated_total) >= quotationThreshold ? 3 : 1
  const receivedQuotationCount = quotes.filter((row: Row) => id(row.requisition) === id(selectedRequisition?.id)).length
  const missingQuotationCount = Math.max(0, requiredQuotationCount - receivedQuotationCount)
  const pricedLineIds = new Set(quoteLines.map((row: Row) => id(row.requisition_item)))
  const missingPricedLines = quoteReqLines.filter((row: Row) => !pricedLineIds.has(id(row.id))).length
  const quoteExpired = Boolean(selectedQuote?.valid_until && String(selectedQuote.valid_until) < new Date().toISOString().slice(0, 10))
  const sourcingReady = Boolean(selectedQuote) && missingQuotationCount === 0 && missingPricedLines === 0 && !quoteExpired && Boolean(form.evaluationNotes)
  const sourcingSteps = [
    { label: 'Quotation received', done: Boolean(selectedQuote) },
    { label: `Competitive quotations (${receivedQuotationCount}/${requiredQuotationCount})`, done: missingQuotationCount === 0 },
    { label: 'All requisition lines priced', done: Boolean(selectedQuote) && missingPricedLines === 0 },
    { label: 'Commercial evaluation recorded', done: Boolean(form.evaluationNotes) },
    { label: 'Winner selection', done: Boolean(selectedQuote?.is_awarded || selectedQuote?.awarded) },
  ]
  return <Panel title="Supplier quotations" note="Compare supplier quotations and complete sourcing controls before awarding.">
    <Field label="Requisition"><Select value={form.requisition} onChange={(v) => setForm({ requisition: v })} rows={data.requisitions} label={requisitionLabel} /></Field>
    <Field label="Supplier"><Select value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} rows={suppliers} /></Field>
    <Action disabled={busy || !form.requisition || !form.supplier} onClick={() => run(() => createBackendRecord('quotations', { requisition: form.requisition, supplier: form.supplier, total_amount: 0 }), 'Supplier quotation created')}>Create quotation</Action>
    <Divider />
    <Field label="Quotation"><Select value={form.quotation} onChange={(v) => { const quote = quotes.find((row: Row) => id(row.id) === v); setForm({ ...form, quotation: v, tax: quote?.tax_amount || '', transport: quote?.transport_cost || '', discount: quote?.discount_amount || '', terms: quote?.payment_terms || '', deliveryDate: quote?.delivery_date || '', validUntil: quote?.valid_until || '', score: quote?.evaluation_score || '', evaluationNotes: quote?.evaluation_notes || '' }) }} rows={quotes} label={(row: Row) => `${names.suppliers.get(id(row.supplier)) || 'Supplier'} · ${money(row.total_amount)}`} /></Field>
    <Two><Field label="Tax"><Input type="number" value={form.tax} onChange={(v) => setForm({ ...form, tax: v })} /></Field><Field label="Transport"><Input type="number" value={form.transport} onChange={(v) => setForm({ ...form, transport: v })} /></Field></Two>
    <Two><Field label="Discount"><Input type="number" value={form.discount} onChange={(v) => setForm({ ...form, discount: v })} /></Field><Field label="Evaluation score / 100"><Input type="number" value={form.score} onChange={(v) => setForm({ ...form, score: v })} /></Field></Two>
    <Field label="Payment terms"><Input value={form.terms} onChange={(v) => setForm({ ...form, terms: v })} /></Field>
    <Two><Field label="Delivery date"><Input type="date" value={form.deliveryDate} onChange={(v) => setForm({ ...form, deliveryDate: v })} /></Field><Field label="Valid until"><Input type="date" value={form.validUntil} onChange={(v) => setForm({ ...form, validUntil: v })} /></Field></Two>
    <Field label="Evaluation notes"><Input value={form.evaluationNotes} onChange={(v) => setForm({ ...form, evaluationNotes: v })} /></Field>
    <Action disabled={busy || !form.quotation} onClick={() => run(() => updateBackendRecord('quotations', id(form.quotation), { tax_amount: num(form.tax), transport_cost: num(form.transport), discount_amount: num(form.discount), payment_terms: form.terms || '', delivery_date: form.deliveryDate || null, valid_until: form.validUntil || null, evaluation_score: num(form.score), evaluation_notes: form.evaluationNotes || '' }), 'Quotation commercial terms saved')}>Save commercial evaluation</Action>
    <Divider />
    <Field label="Existing quoted line"><Select optional value={form.quoteLine} onChange={(v) => { const line = quoteLines.find((row: Row) => id(row.id) === v); setForm({ ...form, quoteLine: v, reqLine: line?.requisition_item || '', unit: line?.unit || '', quantity: line?.quantity || '', price: line?.unit_price || '', days: line?.delivery_days || '' }) }} rows={quoteLines} label={(row: Row) => `${names.items.get(id(row.item)) || id(row.item)} · ${money(row.unit_price)}`} /></Field>
    <Field label="Requisition line"><Select value={form.reqLine} onChange={(v) => { const line = quoteReqLines.find((r: Row) => id(r.id) === v); const article = items.find((item: Row) => id(item.id) === id(line?.item)); const unit = id(line?.unit) || id(article?.baseUnitId); setForm({ ...form, reqLine: v, unit, quantity: num(line?.requested_base_quantity || line?.quantity) }) }} rows={quoteReqLines} label={(row: Row) => `${names.items.get(id(row.item)) || 'Article'} · ${row.requested_base_quantity || row.quantity} base units`} /></Field>
    <Field label="Supplier's purchase unit"><Select value={form.unit} onChange={(v) => { const factor = conversionFactorFor(selectedItem, v, itemUnits); setForm({ ...form, unit: v, quantity: factor > 0 ? Number((requestedBase / factor).toFixed(4)) : '' }) }} rows={availableUnits} /></Field>
    <Two><Field label={`Quoted quantity (${names.units.get(id(form.unit)) || selectedItem?.uom || 'unit'})`}><Input type="number" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} /></Field><Field label="Price per selected purchase unit"><Input type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} /></Field></Two>
    {selectedReqLine && form.unit && <UnitConversionNote quantity={num(form.quantity)} factor={conversion} selectedUnit={names.units.get(id(form.unit)) || 'selected unit'} baseUnit={selectedItem?.uom || 'base units'} unitPrice={num(form.price)} />}
    <Field label="Delivery days"><Input type="number" value={form.days} onChange={(v) => setForm({ ...form, days: v })} /></Field>
    {duplicate && <Hint>This supplier already quoted this Article. Select the existing line to edit it.</Hint>}
    {!editing && <Action disabled={busy || duplicate || !form.quotation || !form.reqLine || !form.unit || num(form.quantity) <= 0 || num(form.price) <= 0} onClick={() => run(() => createBackendRecord('quotation-items', { quotation: form.quotation, requisition_item: form.reqLine, unit: form.unit, quantity: num(form.quantity), unit_price: num(form.price), delivery_days: num(form.days) }), 'Quotation line added')}>Add quoted line</Action>}
    {editing && <><Action disabled={busy || !form.reqLine || Boolean(editing.selected)} onClick={() => run(() => updateBackendRecord('quotation-items', id(editing.id), { quotation: form.quotation, requisition_item: form.reqLine, unit: form.unit || null, quantity: num(form.quantity), unit_price: num(form.price), delivery_days: num(form.days) }), 'Quotation line updated')}>Save quoted line</Action><Action tone="danger" disabled={busy || Boolean(editing.selected)} onClick={() => run(() => deleteBackendPath('quotation-items', id(editing.id)), 'Quotation line removed')}>Remove quoted line</Action></>}
    <Divider />
    <section style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-2)' }}>
      <div style={{ padding: '11px 12px', display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div><div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 800 }}>Competitive sourcing</div><div style={{ marginTop: 2, color: 'var(--text-muted)', fontSize: 10.5 }}>{num(selectedRequisition?.estimated_total) >= quotationThreshold ? `Policy threshold: ${money(quotationThreshold)} · Minimum ${requiredQuotationCount} quotations` : 'Standard sourcing controls apply'}</div></div>
        <span style={{ alignSelf: 'center', padding: '4px 8px', borderRadius: 20, color: sourcingReady ? 'var(--good)' : 'var(--warn)', background: sourcingReady ? 'var(--good-soft)' : 'var(--warn-soft)', fontSize: 10, fontWeight: 800 }}>{sourcingReady ? 'Ready to award' : `${receivedQuotationCount}/${requiredQuotationCount} quotations`}</span>
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ height: 7, borderRadius: 10, overflow: 'hidden', background: 'var(--border)' }}><div style={{ width: `${Math.round((sourcingSteps.filter((step) => step.done).length / sourcingSteps.length) * 100)}%`, height: '100%', borderRadius: 10, background: sourcingReady ? 'var(--good)' : 'var(--accent)', transition: 'width .2s ease' }} /></div>
        <div style={{ marginTop: 11, display: 'grid', gap: 7 }}>{sourcingSteps.map((step) => <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 8, color: step.done ? 'var(--text)' : 'var(--text-muted)', fontSize: 10.8 }}><span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', borderRadius: 20, color: step.done ? 'var(--good)' : 'var(--text-faint)', background: step.done ? 'var(--good-soft)' : 'var(--surface-3)' }}><Icon name={step.done ? 'check' : 'schedule'} size={13} /></span>{step.label}</div>)}</div>
        {!sourcingReady && selectedRequisition && <div style={{ marginTop: 12, padding: '9px 10px', borderRadius: 6, color: 'var(--warn)', background: 'var(--warn-soft)', fontSize: 10.8, lineHeight: 1.5 }}>
          {missingQuotationCount > 0 && <div>{`Add ${missingQuotationCount} more supplier quotation${missingQuotationCount === 1 ? '' : 's'} before selecting a winner.`}</div>}
          {missingPricedLines > 0 && <div>{`Price ${missingPricedLines} remaining requisition line${missingPricedLines === 1 ? '' : 's'} in the selected quotation.`}</div>}
          {quoteExpired && <div>The selected quotation has expired.</div>}
          {!form.evaluationNotes && <div>Record the commercial evaluation and award justification.</div>}
        </div>}
      </div>
    </section>
    <Action tone="good" disabled={busy || !sourcingReady} onClick={() => run(() => runBackendAction('quotations', id(form.quotation), 'award', { selection_reason: form.evaluationNotes }), 'Winning quotation selected')}>Select as winner</Action>
    {!reqLines.length && form.requisition && <Hint>No requisition lines exist yet.</Hint>}
  </Panel>
}

function LpoPanel({ data, form, setForm, busy, run, requisitionLabel, orderLabel, names, suppliers, employees, stores, units, items, itemUnits, canManage }: any) {
  const approved = data.requisitions.filter((row: Row) => ['approved', 'partially_ordered'].includes(id(row.status)))
  const order = data.orders.find((row: Row) => id(row.id) === id(form.order))
  const lines = data.orderItems.filter((row: Row) => id(row.purchase_order) === id(form.order))
  const line = lines.find((row: Row) => id(row.id) === id(form.orderLine))
  const selectedItem = items.find((item: Row) => id(item.id) === id(line?.item))
  const availableUnits = configuredUnitsForItem(selectedItem, units, itemUnits)
  const conversion = conversionFactorFor(selectedItem, form.unit || line?.unit, itemUnits)
  const editable = ['draft', 'rejected'].includes(id(order?.status))
  const pendingApproval = id(order?.status) === 'pending_approval'
  const approvedOrder = id(order?.status) === 'approved'
  const approvalSteps = Array.isArray(order?.approval_steps) ? order.approval_steps : []
  const currentApproval = approvalSteps.find((step: Row) => id(step.status) === 'pending')
  const financeStage = Boolean(currentApproval && /finance/i.test(id(currentApproval.stage_name)))
  const financeLine = lines.find((row: Row) => id(row.id) === id(form.financeLine))
  return <Panel title="Local Purchase Order" note="The buyer prepares the LPO; independent approvers must release it before supplier issue.">
    <Field label="Approved requisition"><Select value={form.requisition} onChange={(v) => setForm({ requisition: v })} rows={approved} label={requisitionLabel} /></Field>
    <Field label="Supplier"><Select value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} rows={suppliers} optional /></Field>
    <Field label="Ordered by"><Select value={form.employee} onChange={(v) => setForm({ ...form, employee: v })} rows={employees} /></Field>
    <Field label="Receiving store"><Select value={form.store} onChange={(v) => setForm({ ...form, store: v })} rows={stores} optional /></Field>
    <Two><Field label="Requested delivery date"><Input type="date" value={form.expectedDate} onChange={(v) => setForm({ ...form, expectedDate: v })} /></Field><Field label="Order valid until"><Input type="date" value={form.validUntil} onChange={(v) => setForm({ ...form, validUntil: v })} /></Field></Two>
    <Action disabled={busy || !canManage || !form.requisition || !form.employee} onClick={() => run(() => runBackendAction('requisitions', id(form.requisition), 'create-purchase-order', { supplier: form.supplier || null, ordered_by: form.employee, store: form.store || null, expected_date: form.expectedDate || null, valid_until: form.validUntil || null }), 'Draft LPO generated')}>Generate LPO</Action>
    <Divider />
    <Field label="LPO approval workflow"><Select value={form.order} onChange={(v) => setForm({ order: v })} rows={data.orders.filter((r: Row) => !['issued', 'partially_received', 'received', 'cancelled'].includes(id(r.status)))} label={(row: Row) => `${orderLabel(row)} · ${id(row.status).replace(/_/g, ' ')}`} /></Field>
    {order && <div style={{ marginBottom: 11, padding: 10, borderRadius: 6, color: pendingApproval ? 'var(--warn)' : approvedOrder ? 'var(--good)' : 'var(--text-muted)', background: pendingApproval ? 'var(--warn-soft)' : approvedOrder ? 'var(--good-soft)' : 'var(--surface-2)', fontSize: 10.8, lineHeight: 1.55 }}>
      <strong>Revision {id(order.revision || 1)} · {id(order.status).replace(/_/g, ' ')}</strong>
      {currentApproval && <div>Current decision: {id(currentApproval.stage_name)} · {id(currentApproval.approver_name)}</div>}
      {approvalSteps.length > 0 && <div>{approvalSteps.map((step: Row) => `${id(step.stage_name)}: ${id(step.status)}`).join(' · ')}</div>}
    </div>}
    <Field label="LPO line"><Select value={form.orderLine} onChange={(v) => { const found = lines.find((r: Row) => id(r.id) === v); setForm({ ...form, order: form.order, orderLine: v, quantity: found?.quantity, cost: found?.unit_cost, unit: found?.unit }) }} rows={lines} label={(row: Row) => names.items.get(id(row.item)) || id(row.item)} /></Field>
    <Field label="Purchase unit"><Select value={form.unit} onChange={(v) => { const factor = conversionFactorFor(selectedItem, v, itemUnits); setForm({ ...form, unit: v, quantity: factor > 0 ? Number((num(line?.base_quantity) / factor).toFixed(4)) : form.quantity }) }} rows={availableUnits} /></Field>
    <Two><Field label={`Order quantity (${names.units.get(id(form.unit || line?.unit)) || selectedItem?.uom || 'unit'})`}><Input type="number" value={form.quantity ?? line?.quantity} onChange={(v) => setForm({ ...form, quantity: v })} /></Field><Field label="Cost per selected purchase unit"><Input type="number" value={form.cost ?? line?.unit_cost} onChange={(v) => setForm({ ...form, cost: v })} /></Field></Two>
    {line && <UnitConversionNote quantity={num(form.quantity ?? line.quantity)} factor={conversion} selectedUnit={names.units.get(id(form.unit || line.unit)) || 'selected unit'} baseUnit={selectedItem?.uom || 'base units'} unitPrice={num(form.cost ?? line.unit_cost)} />}
    <Action disabled={busy || !canManage || !editable || !form.orderLine} onClick={() => run(() => updateBackendRecord('purchase-order-items', id(form.orderLine), { quantity: num(form.quantity), unit_cost: num(form.cost), unit: form.unit || null }), 'LPO line updated')}>Save line changes</Action>
    <Action disabled={busy || !canManage || !editable || !form.order || !lines.length} onClick={() => run(() => runBackendAction('purchase-orders', id(form.order), 'submit-for-approval'), 'LPO submitted for independent approval')}>Submit LPO for approval</Action>
    {pendingApproval && <>
      <Field label="Approval comments"><Input value={form.approvalComments} onChange={(v) => setForm({ ...form, approvalComments: v })} placeholder="Required when rejecting" /></Field>
      {financeStage && <section style={{ margin: '12px 0', padding: 12, border: '1px solid var(--warn)', borderRadius: 8, background: 'var(--warn-soft)' }}>
        <div style={{ marginBottom: 8, color: 'var(--text)', fontSize: 12, fontWeight: 800 }}>Finance quantity control</div>
        <div style={{ marginBottom: 10, color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.45 }}>Finance may reduce a line before approval. Procurement’s original quantity remains in the LPO audit trail.</div>
        <Field label="LPO line"><Select value={form.financeLine} onChange={(v) => { const selected = lines.find((row: Row) => id(row.id) === v); setForm({ ...form, financeLine: v, financeQuantity: selected?.approved_quantity ?? selected?.quantity ?? '', financeReason: selected?.finance_reduction_reason || '' }) }} rows={lines} label={(row: Row) => `${names.items.get(id(row.item)) || id(row.item)} · Procurement ${row.procurement_quantity ?? row.quantity}`} /></Field>
        <Two><Field label="Finance-approved quantity"><Input type="number" value={form.financeQuantity} onChange={(v) => setForm({ ...form, financeQuantity: v })} /></Field><Field label="Reduction reason"><Input value={form.financeReason} onChange={(v) => setForm({ ...form, financeReason: v })} placeholder="Required if reduced" /></Field></Two>
        <Action disabled={busy || !financeLine || num(form.financeQuantity) < 0 || num(form.financeQuantity) > num(financeLine.procurement_quantity ?? financeLine.quantity) || (num(form.financeQuantity) < num(financeLine.procurement_quantity ?? financeLine.quantity) && !id(form.financeReason).trim())} onClick={() => run(() => runBackendAction('purchase-orders', id(form.order), 'finance-reduce-quantities', { comments: form.approvalComments || '', lines: [{ id: id(financeLine.id), approved_quantity: num(form.financeQuantity), reason: form.financeReason || '' }] }), 'Finance quantity decision recorded')}>Save finance quantity</Action>
      </section>}
      <Action tone="good" disabled={busy || !currentApproval} onClick={() => run(() => runBackendAction('purchase-orders', id(form.order), 'approve', { comments: form.approvalComments || '' }), 'LPO approval recorded')}>Approve current stage</Action>
      <Action tone="danger" disabled={busy || !currentApproval || !form.approvalComments} onClick={() => run(() => runBackendAction('purchase-orders', id(form.order), 'reject', { comments: form.approvalComments }), 'LPO returned to Procurement as rejected')}>Reject for revision</Action>
    </>}
    <Field label="Supplier email"><Input type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder={order ? 'Defaults to supplier email' : ''} /></Field>
    <Action tone="good" disabled={busy || !canManage || !approvedOrder || !form.order} onClick={() => run(() => runBackendAction('purchase-orders', id(form.order), 'issue', { sent_to_email: form.email || '' }), 'LPO PDF emailed to supplier; lead-time clock started')}>Email and issue approved LPO</Action>
    <Divider />
    <Field label="Issued LPO"><Select value={form.issuedOrder} onChange={(v) => setForm({ issuedOrder: v })} rows={data.orders.filter((r: Row) => ['issued', 'partially_received', 'received'].includes(id(r.status)))} label={orderLabel} /></Field>
    <Field label="Resend email to"><Input type="email" value={form.resendEmail} onChange={(v) => setForm({ ...form, resendEmail: v })} /></Field>
    <Action disabled={busy || !canManage || !form.issuedOrder} onClick={() => run(() => runBackendAction('purchase-orders', id(form.issuedOrder), 'resend', { sent_to_email: form.resendEmail || '' }), 'LPO email resent')}>Resend LPO email</Action>
    <Field label="Supplier representative"><Input value={form.supplierRepresentative} onChange={(v) => setForm({ ...form, supplierRepresentative: v })} /></Field>
    <Action disabled={busy || !canManage || !form.issuedOrder || !form.supplierRepresentative} onClick={() => run(() => runBackendAction('purchase-orders', id(form.issuedOrder), 'acknowledge', { acknowledged_by: form.supplierRepresentative }), 'Supplier acknowledgement recorded')}>Record LPO acknowledgement</Action>
  </Panel>
}

function ReceiptPanel({ data, form, setForm, busy, run, orderLabel, receiptLabel, names, stores }: any) {
  const receipt = data.receipts.find((row: Row) => id(row.id) === id(form.receipt))
  const orderId = id(receipt?.purchase_order)
  const lines = data.orderItems.filter((row: Row) => id(row.purchase_order) === orderId)
  const line = lines.find((row: Row) => id(row.id) === id(form.orderLine))
  const receiptLines = data.receiptItems.filter((row: Row) => id(row.goods_receipt) === id(form.receipt))
  const editing = receiptLines.find((row: Row) => id(row.id) === id(form.receiptLine))
  const duplicate = !editing && receiptLines.some((row: Row) => id(row.purchase_order_item) === id(form.orderLine))
  return <Panel title="Goods receipt note" note="Record supplier deliveries.">
    <Field label="Issued LPO"><Select value={form.order} onChange={(v) => setForm({ order: v })} rows={data.orders.filter((row: Row) => ['issued', 'partially_received'].includes(id(row.status)))} label={orderLabel} /></Field>
    <Field label="Received date"><Input type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} /></Field>
    <Field label="Supplier delivery note"><Input value={form.deliveryNote} onChange={(v) => setForm({ ...form, deliveryNote: v })} /></Field>
    <Field label="Supplier invoice number"><Input value={form.invoiceNumber} onChange={(v) => setForm({ ...form, invoiceNumber: v })} /></Field>
    <Action disabled={busy || !form.order || !form.invoiceNumber} onClick={() => run(() => createBackendRecord('grns', { purchase_order: form.order, received_date: form.date || new Date().toISOString().slice(0, 10), delivery_note_no: form.deliveryNote || '', supplier_invoice_no: form.invoiceNumber, note: '' }), 'GRN created')}>Create GRN</Action>
    <Divider />
    <Field label="GRN"><Select value={form.receipt} onChange={(v) => setForm({ receipt: v })} rows={data.receipts} label={receiptLabel} /></Field>
    <Field label="Existing delivered line"><Select optional value={form.receiptLine} onChange={(v) => { const found = receiptLines.find((row: Row) => id(row.id) === v); setForm({ ...form, receipt: form.receipt, receiptLine: v, orderLine: found?.purchase_order_item || '', quantity: found?.quantity_received || '', cost: found?.unit_cost || '', expiry: found?.expiry_date || '' }) }} rows={receiptLines} label={(row: Row) => `${names.items.get(id(row.item)) || id(row.item)} · ${row.quantity_received}`} /></Field>
    <Field label="LPO line and approved destination"><Select value={form.orderLine} onChange={(v) => { const found = lines.find((r: Row) => id(r.id) === v); setForm({ ...form, receipt: form.receipt, orderLine: v, quantity: found?.approved_quantity ?? found?.quantity }) }} rows={lines} label={(row: Row) => `${names.items.get(id(row.item)) || id(row.item)} · ordered ${row.approved_quantity ?? row.quantity} · ${row.destination_type === 'workspace' ? 'Direct to workspace' : 'Store inventory'}`} /></Field>
    {line && <Hint>Destination is locked from the approved requisition: {line.destination_type === 'workspace' ? `direct to ${names.departments.get(id(line.destination_department)) || 'workspace'}` : names.stores.get(id(line.destination_store)) || stores.find((store: Row) => id(store.id) === id(line.destination_store))?.name || 'LPO receiving store'}.</Hint>}
    <Field label={`Delivered quantity (${names.units.get(id(line?.unit)) || 'LPO unit'})`}><Input type="number" value={form.quantity ?? line?.approved_quantity ?? line?.quantity} onChange={(v) => setForm({ ...form, quantity: v })} /></Field>
    {line && <UnitConversionNote quantity={num(form.quantity ?? line.approved_quantity ?? line.quantity)} factor={num(line.approved_base_quantity ?? line.base_quantity) && num(line.approved_quantity ?? line.quantity) ? num(line.approved_base_quantity ?? line.base_quantity) / num(line.approved_quantity ?? line.quantity) : 1} selectedUnit={names.units.get(id(line.unit)) || 'LPO unit'} baseUnit="base stock units" unitPrice={0} />}
    <Field label="Expiry date"><Input type="date" value={form.expiry} onChange={(v) => setForm({ ...form, expiry: v })} /></Field>
    {duplicate && <Hint>This LPO line is already on the GRN. Select it above to correct it.</Hint>}
    {!editing && <Action disabled={busy || duplicate || !form.receipt || !form.orderLine || num(form.quantity) <= 0} onClick={() => run(() => createBackendRecord('grn-items', { goods_receipt: form.receipt, purchase_order_item: form.orderLine, quantity_received: num(form.quantity), expiry_date: form.expiry || null }), 'Delivered line added without changing the approved LPO quantity')}>Add delivered line</Action>}
    {editing && <><Action disabled={busy || Boolean(editing.inventory_changes_applied) || num(form.quantity) <= 0} onClick={() => run(() => updateBackendRecord('grn-items', id(editing.id), { goods_receipt: form.receipt, purchase_order_item: form.orderLine, quantity_received: num(form.quantity), expiry_date: form.expiry || null }), 'Delivered line corrected')}>Save GRN correction</Action><Action tone="danger" disabled={busy || Boolean(editing.inventory_changes_applied)} onClick={() => run(() => deleteBackendPath('grn-items', id(editing.id)), 'Delivered line removed')}>Remove line</Action></>}
  </Panel>
}

function InspectionPanel({ data, form, setForm, busy, run, receiptLabel, names }: any) {
  const receiptItems = data.receiptItems.filter((row: Row) => id(row.goods_receipt) === id(form.receipt))
  const inspection = data.inspections.find((row: Row) => id(row.id) === id(form.inspection))
  const inspectionReceiptItems = data.receiptItems.filter((row: Row) => id(row.goods_receipt) === id(inspection?.goods_receipt))
  const receiptLine = inspectionReceiptItems.find((row: Row) => id(row.id) === id(form.receiptLine))
  return <Panel title="Goods inspection" note="Record inspection results.">
    <Field label="GRN"><Select value={form.receipt} onChange={(v) => setForm({ receipt: v })} rows={data.receipts.filter((r: Row) => !data.inspections.some((i: Row) => id(i.goods_receipt) === id(r.id)))} label={receiptLabel} /></Field>
    <Field label="Delivery note"><Input value={form.deliveryNote} onChange={(v) => setForm({ ...form, deliveryNote: v })} /></Field>
    <Action disabled={busy || !form.receipt || !receiptItems.length} onClick={() => run(() => createBackendRecord('goods-inspections', { goods_receipt: form.receipt, delivery_note_no: form.deliveryNote || '', remarks: '' }), 'Inspection opened')}>Start inspection</Action>
    <Divider />
    <Field label="Inspection"><Select value={form.inspection} onChange={(v) => setForm({ inspection: v })} rows={data.inspections} label={(row: Row) => `${receiptLabel({ id: row.goods_receipt })} · ${id(row.status)}`} /></Field>
    <Field label="Delivered Article"><Select value={form.receiptLine} onChange={(v) => { const found = inspectionReceiptItems.find((r: Row) => id(r.id) === v); setForm({ ...form, receiptLine: v, received: found?.base_quantity || found?.quantity_received }) }} rows={inspectionReceiptItems} label={(row: Row) => `${names.items.get(id(row.item)) || id(row.item)} · ${row.quantity_received}`} /></Field>
    <Two><Field label="Accepted (base stock units)"><Input type="number" value={form.accepted} onChange={(v) => setForm({ ...form, accepted: v })} /></Field><Field label="Rejected (base stock units)"><Input type="number" value={form.rejected} onChange={(v) => setForm({ ...form, rejected: v })} /></Field></Two>
    <Field label="Rejection reason"><Input value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} /></Field>
    <Action disabled={busy || !form.inspection || !form.receiptLine} onClick={() => run(() => createBackendRecord('goods-inspection-items', { inspection: form.inspection, goods_receipt_item: form.receiptLine, quantity_received: num(form.received ?? receiptLine?.base_quantity), quantity_accepted: num(form.accepted), quantity_rejected: num(form.rejected), rejection_reason: form.reason || '' }), 'Inspection quantities recorded')}>Record decision</Action>
    <Action tone="good" disabled={busy || !inspection?.goods_receipt} onClick={() => run(() => runBackendAction('grns', id(inspection.goods_receipt), 'post-to-inventory'), 'Accepted goods posted to inventory')}>Post accepted goods</Action>
  </Panel>
}

function ReturnPanel({ data, form, setForm, busy, run, receiptLabel, names, employees, stores }: any) {
  const receipt = data.receipts.find((row: Row) => id(row.id) === id(form.receipt))
  const order = data.orders.find((row: Row) => id(row.id) === id(receipt?.purchase_order))
  const receiptItems = data.receiptItems.filter((row: Row) => id(row.goods_receipt) === id(form.receipt))
  const supplierReturn = data.returns.find((row: Row) => id(row.id) === id(form.return))
  const returnReceiptItems = data.receiptItems.filter((row: Row) => id(row.goods_receipt) === id(supplierReturn?.goods_receipt))
  return <Panel title="Supplier return" note="Record supplier returns.">
    <Field label="Original GRN"><Select value={form.receipt} onChange={(v) => setForm({ receipt: v })} rows={data.receipts} label={receiptLabel} /></Field>
    <Field label="Store"><Select value={form.store} onChange={(v) => setForm({ ...form, store: v })} rows={stores} /></Field>
    <Field label="Returned by"><Select value={form.employee} onChange={(v) => setForm({ ...form, employee: v })} rows={employees} /></Field>
    <Field label="Reason"><Input value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} /></Field>
    <Action disabled={busy || !form.receipt || !form.store || !form.employee || !order?.supplier} onClick={() => run(() => createBackendRecord('supplier-returns', { supplier: order.supplier, goods_receipt: form.receipt, store: form.store, returned_by: form.employee, reason: form.reason, return_date: new Date().toISOString().slice(0, 10) }), 'Supplier return created')}>Create return</Action>
    {!receiptItems.length && form.receipt && <Hint>This GRN has no delivered lines.</Hint>}
    <Divider />
    <Field label="Draft return"><Select value={form.return} onChange={(v) => setForm({ return: v })} rows={data.returns.filter((r: Row) => id(r.status) === 'draft')} label={(row: Row) => id(row.return_no)} /></Field>
    <Field label="Article"><Select value={form.item} onChange={(v) => setForm({ ...form, item: v })} rows={returnReceiptItems.map((r: Row) => ({ id: r.item, name: names.items.get(id(r.item)) || id(r.item) }))} /></Field>
    <Field label="Unit"><Select value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} rows={appRows(names.units)} optional /></Field>
    <Field label="Return quantity"><Input type="number" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} /></Field>
    <Action disabled={busy || !form.return || !form.item} onClick={() => run(() => createBackendRecord('supplier-return-items', { supplier_return: form.return, item: form.item, unit: form.unit || null, quantity: num(form.quantity), reason: form.reason || 'Supplier return' }), 'Return line added')}>Add return line</Action>
    <Action tone="good" disabled={busy || !form.return} onClick={() => run(() => runBackendAction('supplier-returns', id(form.return), 'apply'), 'Supplier return posted')}>Apply inventory return</Action>
    <Divider />
    <Field label="Dispatched return"><Select value={form.postedReturn} onChange={(v) => setForm({ postedReturn: v })} rows={data.returns.filter((r: Row) => id(r.status) === 'posted' && !r.supplier_acknowledged_at)} label={(row: Row) => id(row.return_no)} /></Field>
    <Field label="Supplier representative"><Input value={form.acknowledgedBy} onChange={(v) => setForm({ ...form, acknowledgedBy: v })} /></Field>
    <Field label="Supplier credit note"><Input value={form.creditNote} onChange={(v) => setForm({ ...form, creditNote: v })} /></Field>
    <Field label="Replacement expected"><Input type="date" value={form.replacementDate} onChange={(v) => setForm({ ...form, replacementDate: v })} /></Field>
    <Action disabled={busy || !form.postedReturn || !form.acknowledgedBy} onClick={() => run(() => runBackendAction('supplier-returns', id(form.postedReturn), 'acknowledge', { acknowledged_by: form.acknowledgedBy, credit_note_number: form.creditNote || '', replacement_expected_date: form.replacementDate || null }), 'Supplier acknowledgement recorded')}>Record supplier acknowledgement</Action>
  </Panel>
}

function StageTable({ stage, data, names, onSelect }: { stage: Stage; data: Datasets; names: Record<string, Map<string, string>>; onSelect: (row: Row) => void }) {
  const requisitionNumber = (requisitionId: string) =>
    id(data.requisitions.find((record) => id(record.id) === requisitionId)?.requisition_number)
    || `PR-${requisitionId.slice(0, 8).toUpperCase()}`
  let rows: Row[] = []
  let title = ''
  if (stage === 'request') { rows = data.requisitionItems; title = 'Requisition lines' }
  if (stage === 'quote') { rows = data.quotations; title = 'Supplier comparison' }
  if (stage === 'lpo') { rows = data.orders; title = 'Local purchase orders' }
  if (stage === 'receipt') { rows = data.receipts; title = 'Goods receipt notes' }
  if (stage === 'inspect') { rows = data.inspections; title = 'Inspection records' }
  if (stage === 'return') { rows = data.returns; title = 'Supplier returns' }
  if (stage === 'quote') {
    const requisitionIds = Array.from(new Set(rows.map((row) => id(row.requisition))))
    return <div>
      <div style={{ padding: '15px 17px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 800 }}>Side-by-side supplier comparison</div>
      {requisitionIds.map((requisitionId) => {
        const quotations = rows.filter((row) => id(row.requisition) === requisitionId)
        return <section key={requisitionId} style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ marginBottom: 10, color: 'var(--text)', fontSize: 12, fontWeight: 750 }}>{requisitionNumber(requisitionId)} <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>· {quotations.length} supplier quotation{quotations.length === 1 ? '' : 's'}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(Math.max(quotations.length, 1), 3)},minmax(210px,1fr))`, gap: 10, overflowX: 'auto' }}>
            {quotations.map((quote) => {
              const winner = data.quotationItems.some((line) => id(line.quotation) === id(quote.id) && line.selected)
              return <button type="button" key={id(quote.id)} onClick={() => onSelect(quote)} className="procurement-record-row" style={{ minWidth: 210, padding: 14, textAlign: 'left', border: `1px solid ${winner ? 'var(--good)' : 'var(--border)'}`, borderRadius: 7, background: winner ? 'var(--good-soft)' : 'var(--surface)', cursor: 'pointer', font: 'inherit' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><strong style={{ color: 'var(--text)', fontSize: 12.5 }}>{names.suppliers.get(id(quote.supplier)) || id(quote.supplier)}</strong>{winner && <span style={{ color: 'var(--good)', fontSize: 10, fontWeight: 800 }}>WINNER</span>}</div>
                <div style={{ margin: '12px 0', color: 'var(--text)', fontSize: 17, fontWeight: 750 }}>{money(quote.total_amount)}</div>
                <ComparisonField label="Subtotal" value={money(quote.subtotal)} />
                <ComparisonField label="Tax" value={money(quote.tax_amount)} />
                <ComparisonField label="Transport" value={money(quote.transport_cost)} />
                <ComparisonField label="Discount" value={money(quote.discount_amount)} />
                <ComparisonField label="Payment" value={id(quote.payment_terms) || 'Not entered'} />
                <ComparisonField label="Delivery" value={id(quote.delivery_date) || 'Not entered'} />
                <ComparisonField label="Valid until" value={id(quote.valid_until) || 'Not entered'} />
                <ComparisonField label="Score" value={`${num(quote.evaluation_score)}/100`} />
              </button>
            })}
          </div>
        </section>
      })}
      {!rows.length && <div style={{ padding: 45, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12.5 }}>No supplier quotations have been entered.</div>}
    </div>
  }
  const cells = (row: Row): string[] => {
    if (stage === 'request') return [requisitionNumber(id(row.requisition)), names.items.get(id(row.item)) || id(row.item), id(row.quantity), money(row.estimated_total)]
    if (stage === 'lpo') return [id(row.po_number), names.suppliers.get(id(row.supplier)) || id(row.supplier), money(row.total_amount), id(row.status)]
    if (stage === 'receipt') return [id(row.grn_number) || `GRN-${id(row.id).slice(0, 8)}`, id(row.received_date), names.employees.get(id(row.received_by)) || id(row.received_by), `${data.receiptItems.filter((line) => id(line.goods_receipt) === id(row.id)).length} lines`]
    if (stage === 'inspect') return [`INS-${id(row.id).slice(0, 8)}`, `GRN-${id(row.goods_receipt).slice(0, 8)}`, names.employees.get(id(row.inspected_by)) || id(row.inspected_by), id(row.status)]
    return [id(row.return_no), names.suppliers.get(id(row.supplier)) || id(row.supplier), id(row.return_date), id(row.status)]
  }
  return <><div style={{ padding: '15px 17px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 800 }}>{title}</div>
    {rows.map((row) => <button type="button" key={id(row.id)} onClick={() => onSelect(row)} className="procurement-record-row" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1fr .8fr 24px', alignItems: 'center', gap: 12, padding: '12px 17px', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 12.5 }}>{cells(row).map((cell, i) => <span key={i} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: i === 0 ? 'var(--text)' : 'var(--text-muted)', fontWeight: i === 0 ? 700 : 500 }}>{cell || '—'}</span>)}<Icon name="chevron_right" size={18} color="var(--text-faint)" /></button>)}
    {!rows.length && <div style={{ padding: 45, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12.5 }}>Nothing has reached this stage yet. Complete the previous step first.</div>}
  </>
}

function ComparisonField({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 0', borderTop: '1px solid var(--border)', fontSize: 10.5 }}><span style={{ color: 'var(--text-faint)' }}>{label}</span><span style={{ color: 'var(--text-muted)', textAlign: 'right', fontWeight: 600 }}>{value}</span></div>
}

function ProcurementRecordDrawer({ stage, row, data, names, canAttach, onClose, onChanged }: {
  stage: Stage
  row: Row
  data: Datasets
  names: Record<string, Map<string, string>>
  canAttach: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const app = useApp()
  const [attachmentCategory, setAttachmentCategory] = useState('supporting')
  const [uploading, setUploading] = useState(false)
  const [attachmentMessage, setAttachmentMessage] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const [downloadingId, setDownloadingId] = useState('')
  const [printing, setPrinting] = useState(false)
  const [printClassification, setPrintClassification] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const requisition = stage === 'request'
    ? data.requisitions.find((record) => id(record.id) === id(row.requisition))
    : stage === 'quote'
      ? data.requisitions.find((record) => id(record.id) === id(row.requisition))
      : undefined
  const receipt = stage === 'inspect'
    ? data.receipts.find((record) => id(record.id) === id(row.goods_receipt))
    : undefined
  const title = stage === 'request' ? 'Requisition line'
    : stage === 'quote' ? 'Supplier quotation'
      : stage === 'lpo' ? 'Local purchase order'
        : stage === 'receipt' ? 'Goods receipt note'
          : stage === 'inspect' ? 'Goods inspection'
            : 'Supplier return'
  const reference = stage === 'request' ? id(requisition?.requisition_number) || `PR-${id(row.requisition).slice(0, 8).toUpperCase()}`
    : stage === 'quote' ? `QUOTE-${id(row.id).slice(0, 8).toUpperCase()}`
      : stage === 'lpo' ? id(row.po_number) || id(row.id)
        : stage === 'receipt' ? id(row.grn_number) || `GRN-${id(row.id).slice(0, 8).toUpperCase()}`
          : stage === 'inspect' ? `INS-${id(row.id).slice(0, 8).toUpperCase()}`
            : id(row.return_no) || id(row.id)
  const status = stage === 'request' ? id(requisition?.status)
    : stage === 'receipt' ? (data.receiptItems.some((line) => id(line.goods_receipt) === id(row.id) && line.inventory_changes_applied) ? 'Posted' : 'Received')
      : id(row.status) || 'Open'
  const winner = stage === 'quote' && data.quotationItems.some((line) => id(line.quotation) === id(row.id) && line.selected)
  const lines = stage === 'quote' ? data.quotationItems.filter((line) => id(line.quotation) === id(row.id))
    : stage === 'lpo' ? data.orderItems.filter((line) => id(line.purchase_order) === id(row.id))
      : stage === 'receipt' ? data.receiptItems.filter((line) => id(line.goods_receipt) === id(row.id))
        : stage === 'inspect' ? data.inspectionItems.filter((line) => id(line.inspection) === id(row.id))
          : stage === 'return' ? data.returnItems.filter((line) => id(line.supplier_return) === id(row.id))
            : []
  const details: Array<[string, string]> = stage === 'request' ? [
    ['Article', names.items.get(id(row.item)) || id(row.item)],
    ['Quantity', id(row.quantity)],
    ['Estimated unit cost', money(row.estimated_unit_cost)],
    ['Estimated total', money(row.estimated_total)],
    ['Destination', row.destination_type === 'workspace' ? 'Direct to workspace' : 'Store inventory'],
    ['Receiving store', names.stores.get(id(row.destination_store)) || '—'],
    ['Workspace department', names.departments.get(id(row.destination_department)) || '—'],
    ['Routing justification', id(row.destination_justification) || '—'],
    ['Reason', id(requisition?.reason) || '—'],
  ] : stage === 'quote' ? [
    ['Requisition', id(requisition?.requisition_number) || `PR-${id(row.requisition).slice(0, 8).toUpperCase()}`],
    ['Supplier', names.suppliers.get(id(row.supplier)) || id(row.supplier)],
    ['Quoted total', money(row.total_amount)],
    ['Evaluation', winner ? 'Selected winner' : 'Open quotation'],
  ] : stage === 'lpo' ? [
    ['Supplier', names.suppliers.get(id(row.supplier)) || id(row.supplier)],
    ['Receiving store', names.stores.get(id(row.store)) || id(row.store) || '—'],
    ['Order total', money(row.total_amount)],
    ['Revision', id(row.revision || 1)],
    ['Approval status', id(row.status).replace(/_/g, ' ')],
    ['Approved by', names.employees.get(id(row.approved_by)) || id(row.approved_by) || '—'],
    ['Approved at', id(row.approved_at) || '—'],
    ['Expected date', id(row.expected_date) || '—'],
    ['Sent to', id(row.sent_to_email) || '—'],
    ['Email delivery', id(row.email_status).replace(/_/g, ' ') || 'Not sent'],
    ['Supplier acknowledgement', id(row.supplier_acknowledged_by) || 'Not acknowledged'],
  ] : stage === 'receipt' ? [
    ['Purchase order', id(data.orders.find((order) => id(order.id) === id(row.purchase_order))?.po_number) || id(row.purchase_order)],
    ['Received date', id(row.received_date)],
    ['Received by', names.employees.get(id(row.received_by)) || id(row.received_by)],
    ['Delivery note', id(row.delivery_note_no) || '—'],
    ['Supplier invoice', id(row.supplier_invoice_no) || '—'],
    ['Posted at', id(row.posted_at) || 'Not posted'],
    ['Posted by', names.employees.get(id(row.posted_by)) || id(row.posted_by) || '—'],
    ['Note', id(row.note) || '—'],
  ] : stage === 'inspect' ? [
    ['Goods receipt', `GRN-${id(row.goods_receipt).slice(0, 8).toUpperCase()}`],
    ['Inspected by', names.employees.get(id(row.inspected_by)) || id(row.inspected_by)],
    ['Inspection date', id(row.inspection_date) || id(receipt?.received_date)],
    ['Delivery note', id(row.delivery_note_no) || '—'],
    ['Remarks', id(row.remarks) || '—'],
  ] : [
    ['Supplier', names.suppliers.get(id(row.supplier)) || id(row.supplier)],
    ['Store', names.stores.get(id(row.store)) || id(row.store)],
    ['Returned by', names.employees.get(id(row.returned_by)) || id(row.returned_by)],
    ['Return date', id(row.return_date)],
    ['Reason', id(row.reason) || '—'],
    ['Dispatched at', id(row.dispatched_at) || 'Not dispatched'],
    ['Supplier acknowledgement', id(row.supplier_acknowledged_by) || 'Not acknowledged'],
    ['Credit note', id(row.credit_note_number) || '—'],
    ['Replacement expected', id(row.replacement_expected_date) || '—'],
  ]

  const lineName = (line: Row) => {
    if (stage === 'quote') {
      const requestLine = data.requisitionItems.find((candidate) => id(candidate.id) === id(line.requisition_item))
      return names.items.get(id(requestLine?.item)) || id(requestLine?.item) || 'Article'
    }
    if (stage === 'inspect') {
      const receiptLine = data.receiptItems.find((candidate) => id(candidate.id) === id(line.goods_receipt_item))
      return names.items.get(id(receiptLine?.item)) || id(receiptLine?.item) || 'Article'
    }
    return names.items.get(id(line.item)) || id(line.item) || 'Article'
  }
  const documentType = stage === 'quote' ? 'quotation'
    : stage === 'lpo' ? 'purchase_order'
      : stage === 'receipt' ? 'grn'
        : stage === 'inspect' ? 'inspection'
          : stage === 'return' ? 'supplier_return'
            : ''
  const attachments = data.attachments.filter(
    (attachment) => id(attachment.document_type) === documentType && id(attachment.document_id) === id(row.id),
  )
  const communications = stage === 'lpo'
    ? data.communications.filter((communication) => id(communication.purchase_order) === id(row.id))
    : []
  const requisitionId = id(requisition?.id)
  const history = requisitionId
    ? data.requisitionHistory.filter((event) => id(event.requisition) === requisitionId)
    : data.history.filter((event) =>
      id(event.entity_id) === id(row.id) ||
      id(event.metadata?.requisition_id) === id(row.id),
    )
  const upload = async (file?: File) => {
    if (!file || !documentType) return
    setAttachmentMessage('')
    setAttachmentError('')
    setUploading(true)
    try {
      await uploadProcurementAttachment(documentType, id(row.id), attachmentCategory, file)
      await onChanged()
      setAttachmentMessage(`${file.name} attached successfully.`)
    } catch (error) {
      setAttachmentError(errorMessage(error))
    } finally {
      setUploading(false)
    }
  }
  const download = async (attachment: Row) => {
    const attachmentId = id(attachment.id)
    setAttachmentMessage('')
    setAttachmentError('')
    setDownloadingId(attachmentId)
    try {
      await downloadProcurementAttachment(attachmentId, id(attachment.original_name))
    } catch (error) {
      setAttachmentError(errorMessage(error))
    } finally {
      setDownloadingId('')
    }
  }
  const printDocument = async () => {
    if (stage !== 'lpo') {
      window.print()
      return
    }
    setPrinting(true)
    try {
      const result = await downloadControlledPurchaseOrder(id(row.id))
      setPrintClassification(result.classification || 'COPY')
      await onChanged()
    } catch (error) {
      const detail = errorMessage(error)
      setAttachmentError(detail)
      app.showWorkflowAlert('LPO print not authorised', detail)
    } finally {
      setPrinting(false)
    }
  }

  return <>
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.38)' }} />
    <aside role="dialog" aria-modal="true" aria-label={`${title} ${reference}`} className="procurement-detail-drawer procurement-print-document" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 81, width: 560, maxWidth: '94vw', display: 'flex', flexDirection: 'column', background: 'var(--surface)', boxShadow: '-12px 0 32px rgba(15,23,42,.18)', animation: 'slideIn .2s ease' }}>
      <header className="screen-document-view" style={{ padding: '19px 22px', display: 'flex', alignItems: 'flex-start', gap: 14, borderBottom: '1px solid var(--border)' }}>
        <span style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', flex: 'none', borderRadius: 8, color: 'var(--accent)', background: 'var(--accent-soft)' }}><Icon name={stage === 'inspect' ? 'fact_check' : stage === 'receipt' ? 'receipt_long' : stage === 'quote' ? 'compare_arrows' : 'description'} size={21} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</div>
          <div style={{ marginTop: 3, color: 'var(--text)', fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{reference}</div>
        </div>
        <span style={chipStyleFor(winner ? 'Approved' : status)}>{winner ? 'Winner' : status || 'Open'}</span>
        <button type="button" onClick={onClose} aria-label="Close details" style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text-muted)', cursor: 'pointer' }}><Icon name="close" size={18} /></button>
      </header>
      <div className="screen-document-view" style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
        <section>
          <h3 style={drawerHeading}>Document details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {details.map(([label, value]) => <div key={label} style={{ minHeight: 70, padding: '13px 14px', borderBottom: '1px solid var(--border)' }}><div style={drawerLabel}>{label}</div><div style={drawerValue}>{value || '—'}</div></div>)}
          </div>
        </section>
        {stage === 'request' ? null : <section style={{ marginTop: 25 }}>
          <h3 style={drawerHeading}>Line items <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>({lines.length})</span></h3>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {lines.map((line) => {
              const quantity = stage === 'inspect' ? line.quantity_received : (line.quantity ?? line.quantity_received)
              const secondaryText = stage === 'inspect'
                ? `Accepted ${id(line.quantity_accepted)} · Rejected ${id(line.quantity_rejected)}`
                : stage === 'quote' || stage === 'lpo'
                  ? `${id(quantity)} × ${money(line.unit_price ?? line.unit_cost)}`
                  : `Quantity ${id(quantity)}`
              const routeText = stage === 'lpo'
                ? (line.destination_type === 'workspace' ? `Direct to ${names.departments.get(id(line.destination_department)) || 'workspace'}` : `Receive into ${names.stores.get(id(line.destination_store)) || 'store'}`)
                : stage === 'receipt' ? (line.direct_issue_department ? `Direct to ${names.departments.get(id(line.direct_issue_department)) || 'workspace'}` : `Received into ${names.stores.get(id(line.store)) || 'store'}`) : ''
              return <div key={id(line.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '13px 14px', borderBottom: '1px solid var(--border)' }}><div><div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 650 }}>{lineName(line)}</div><div style={{ marginTop: 4, color: 'var(--text-faint)', fontSize: 11.5 }}>{secondaryText}</div>{routeText && <div style={{ marginTop: 3, color: 'var(--accent)', fontSize: 10.5, fontWeight: 650 }}>{routeText}</div>}</div>{line.selected && <span style={{ color: 'var(--good)', fontSize: 11.5, fontWeight: 700 }}>Selected</span>}</div>
            })}
            {!lines.length && <div style={{ padding: 24, color: 'var(--text-faint)', textAlign: 'center', fontSize: 12 }}>No line items are attached to this document.</div>}
          </div>
        </section>}
        {documentType && <section style={{ marginTop: 25 }}>
          <h3 style={drawerHeading}>Supporting documents <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>({attachments.length})</span></h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <select value={attachmentCategory} onChange={(event) => setAttachmentCategory(event.target.value)} style={{ ...control, flex: 1 }}><option value="quotation">Supplier quotation</option><option value="delivery_note">Delivery note</option><option value="invoice">Invoice copy</option><option value="inspection_photo">Inspection photograph</option><option value="supporting">Other supporting document</option></select>
            {canAttach && <>
              <input
                ref={fileInput}
                disabled={uploading}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  void upload(file)
                }}
                style={{ display: 'none' }}
              />
              <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()} style={{ ...secondary, cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? .65 : 1 }}><Icon name="upload_file" size={17} />{uploading ? 'Uploading…' : 'Attach file'}</button>
            </>}
          </div>
          {!canAttach && <div style={{ marginBottom: 10, color: 'var(--text-faint)', fontSize: 10.5 }}>Your role can view attachments but cannot add new files.</div>}
          <div style={{ margin: '-2px 0 10px', color: 'var(--text-faint)', fontSize: 10 }}>PDF, Word or image files up to 4 MB.</div>
          {attachmentMessage && <div role="status" style={{ marginBottom: 10, padding: '9px 11px', borderRadius: 6, color: 'var(--good)', background: 'var(--good-soft)', fontSize: 11 }}>{attachmentMessage}</div>}
          {attachmentError && <div role="alert" style={{ marginBottom: 10, padding: '9px 11px', borderRadius: 6, color: 'var(--bad)', background: 'var(--bad-soft)', fontSize: 11 }}>{attachmentError}</div>}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {attachments.map((attachment) => (
              <button
                type="button"
                key={id(attachment.id)}
                disabled={downloadingId === id(attachment.id)}
                onClick={() => void download(attachment)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', color: 'var(--text)', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', font: 'inherit', fontSize: 12 }}
              >
                <Icon name="attach_file" size={17} color="var(--accent)" />
                <span style={{ flex: 1 }}>{id(attachment.original_name)}</span>
                <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>{id(attachment.category).replace(/_/g, ' ')} · {fileSize(attachment.file_size)}</span>
                <Icon name={downloadingId === id(attachment.id) ? 'progress_activity' : 'download'} size={15} color="var(--text-faint)" />
              </button>
            ))}
            {!attachments.length && <div style={{ padding: 20, color: 'var(--text-faint)', textAlign: 'center', fontSize: 11.5 }}>No documents attached yet.</div>}
          </div>
        </section>}
        {stage === 'lpo' && <section style={{ marginTop: 25 }}>
          <h3 style={drawerHeading}>LPO approvals <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>({Array.isArray(row.approval_steps) ? row.approval_steps.length : 0})</span></h3>
          <div style={{ borderLeft: '2px solid var(--border)', margin: '0 0 24px 7px' }}>
            {(Array.isArray(row.approval_steps) ? row.approval_steps : []).map((step: Row) => <div key={id(step.id)} style={{ position: 'relative', padding: '0 0 14px 18px' }}><span style={{ position: 'absolute', left: -5, top: 3, width: 8, height: 8, borderRadius: '50%', background: id(step.status) === 'approved' ? 'var(--good)' : id(step.status) === 'rejected' ? 'var(--bad)' : 'var(--warn)' }} /><div style={{ color: 'var(--text)', fontSize: 11.5, fontWeight: 650 }}>{id(step.stage_name)}</div><div style={{ marginTop: 3, color: 'var(--text-faint)', fontSize: 10.5 }}>{id(step.approver_name)} · {id(step.status)}</div>{step.comments && <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 10.5 }}>{id(step.comments)}</div>}</div>)}
            {(!Array.isArray(row.approval_steps) || !row.approval_steps.length) && <div style={{ padding: '0 0 12px 18px', color: 'var(--text-faint)', fontSize: 11.5 }}>Not submitted for LPO approval.</div>}
          </div>
          <h3 style={drawerHeading}>Communication history <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>({communications.length})</span></h3>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{communications.map((communication) => <div key={id(communication.id)} style={{ display: 'flex', gap: 10, padding: '11px 13px', borderBottom: '1px solid var(--border)' }}><Icon name={communication.direction === 'inbound' ? 'call_received' : 'outgoing_mail'} size={17} color="var(--accent)" /><div style={{ flex: 1 }}><div style={{ color: 'var(--text)', fontSize: 11.5, fontWeight: 650 }}>{id(communication.subject)}</div><div style={{ marginTop: 3, color: 'var(--text-faint)', fontSize: 10.5 }}>{id(communication.direction)} · {id(communication.status)} · {id(communication.sent_at || communication.created_at)}</div>{communication.error_message && <div style={{ color: 'var(--bad)', fontSize: 10.5 }}>{id(communication.error_message)}</div>}</div></div>)}{!communications.length && <div style={{ padding: 20, color: 'var(--text-faint)', textAlign: 'center', fontSize: 11.5 }}>No supplier communication recorded.</div>}</div>
        </section>}
        <section style={{ marginTop: 25 }}>
          <h3 style={drawerHeading}>Document history <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>({history.length})</span></h3>
          <div style={{ borderLeft: '2px solid var(--border)', marginLeft: 7 }}>{history.slice(0, 20).map((event) => <div key={id(event.id)} style={{ position: 'relative', padding: '0 0 15px 18px' }}><span style={{ position: 'absolute', left: -5, top: 3, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} /><div style={{ color: 'var(--text)', fontSize: 11.5, fontWeight: 650 }}>{id(event.action).replace(/_/g, ' ')}</div><div style={{ marginTop: 3, color: 'var(--text-faint)', fontSize: 10.5 }}>{id(event.performed_by_name) || id(event.created_at)} · {id(event.new_status || event.metadata?.status)}</div>{event.comments && <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 10.5 }}>{id(event.comments)}</div>}</div>)}{!history.length && <div style={{ padding: '0 0 12px 18px', color: 'var(--text-faint)', fontSize: 11.5 }}>No history events recorded yet.</div>}</div>
        </section>
      </div>
      {['lpo', 'receipt', 'return'].includes(stage) && (
        <ProcurementPrintSheet
          propertyName={app.currentBranch}
          stage={stage}
          title={title}
          reference={reference}
          status={status}
          details={details}
          lines={lines}
          lineName={lineName}
          printClassification={printClassification}
        />
      )}
      <footer className="screen-document-view" style={{ padding: '14px 22px', display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)' }}>
        {['lpo', 'receipt', 'return'].includes(stage) && <button type="button" disabled={printing} onClick={() => void printDocument()} style={secondary}><Icon name="print" size={17} />{printing ? 'Preparing…' : stage === 'lpo' ? 'Generate controlled LPO PDF' : 'Print document'}</button>}
        <button type="button" onClick={onClose} style={secondary}>Close</button>
      </footer>
    </aside>
  </>
}

function ProcurementPrintSheet({ propertyName, stage, title, reference, status, details, lines, lineName, printClassification }: {
  propertyName: string
  stage: Stage
  title: string
  reference: string
  status: string
  details: Array<[string, string]>
  lines: Row[]
  lineName: (line: Row) => string
  printClassification: string
}) {
  const allowedLabels: Record<string, Set<string>> = {
    lpo: new Set(['Supplier', 'Receiving store', 'Order total', 'Expected date', 'Sent to']),
    receipt: new Set(['Purchase order', 'Received date', 'Received by', 'Delivery note', 'Supplier invoice', 'Note']),
    return: new Set(['Supplier', 'Store', 'Returned by', 'Return date', 'Reason', 'Credit note', 'Replacement expected']),
  }
  const documentDetails = details.filter(([label]) => allowedLabels[stage]?.has(label))
  const total = stage === 'lpo'
    ? lines.reduce((sum, line) => sum + num(line.quantity) * num(line.unit_cost), 0)
    : null
  return (
    <article className="print-only print-sheet">
      <header className="print-sheet-header">
        <div>
          <div className="print-property">{propertyName || 'Hotel property'}</div>
          <h1>{title}</h1>
          <div className="print-reference">{reference}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {stage === 'lpo' && <div style={{ marginBottom: 8, color: printClassification === 'ORIGINAL' ? '#166534' : '#9a3412', fontWeight: 900, letterSpacing: '.12em', fontSize: 14 }}>{printClassification || 'CONTROLLED PRINT'}</div>}
          <div className="print-status">{id(status).replace(/_/g, ' ') || 'Open'}</div>
        </div>
      </header>
      <section className="print-meta">
        {documentDetails.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}
      </section>
      <table className="print-lines">
        <thead><tr><th>#</th><th>Article</th><th className="number">Quantity</th>{stage === 'lpo' && <><th className="number">Unit price</th><th className="number">Amount</th></>}</tr></thead>
        <tbody>
          {lines.map((line, index) => {
            const quantity = num(line.quantity ?? line.quantity_received)
            const price = num(line.unit_cost)
            return <tr key={id(line.id)}><td>{index + 1}</td><td>{lineName(line)}</td><td className="number">{quantity}</td>{stage === 'lpo' && <><td className="number">{money(price)}</td><td className="number">{money(quantity * price)}</td></>}</tr>
          })}
          {!lines.length && <tr><td colSpan={stage === 'lpo' ? 5 : 3}>No line items recorded.</td></tr>}
        </tbody>
        {total != null && <tfoot><tr><td colSpan={4}>Total</td><td className="number">{money(total)}</td></tr></tfoot>}
      </table>
      <section className="print-signatures">
        <div><span>Prepared by</span><i /></div>
        <div><span>{stage === 'receipt' ? 'Received and verified by' : 'Authorised by'}</span><i /></div>
        <div><span>Date</span><i /></div>
      </section>
      <footer className="print-sheet-footer">Generated from the Hotel Management System · {reference}</footer>
    </article>
  )
}

function configuredUnitsForItem(item: Row | undefined, units: Row[], itemUnits: Row[]): Row[] {
  if (!item) return []
  const allowed = new Set<string>([id(item.baseUnitId)])
  itemUnits
    .filter((entry: Row) => id(entry.itemId) === id(item.id) && id(entry.status) === 'Active')
    .forEach((entry: Row) => allowed.add(id(entry.unitId)))
  return units.filter((unit: Row) => allowed.has(id(unit.id)))
}

function conversionFactorFor(item: Row | undefined, unitId: unknown, itemUnits: Row[]): number {
  if (!item || !unitId || id(unitId) === id(item.baseUnitId)) return 1
  return num(itemUnits.find((entry: Row) => id(entry.itemId) === id(item.id) && id(entry.unitId) === id(unitId) && id(entry.status) === 'Active')?.conversionFactor)
}

function UnitConversionNote({ quantity, factor, selectedUnit, baseUnit, unitPrice }: { quantity: number; factor: number; selectedUnit: string; baseUnit: string; unitPrice: number }) {
  if (factor <= 0) return <Hint>This unit has no active conversion for the selected Article. Configure it before continuing.</Hint>
  const baseQuantity = quantity * factor
  const baseCost = factor ? unitPrice / factor : 0
  return <div style={{ marginBottom: 11, padding: 10, border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--text)', background: 'var(--accent-soft)', fontSize: 10.5, lineHeight: 1.55 }}>
    <strong>Conversion check:</strong> {quantity || 0} {selectedUnit} × {factor} = <strong>{Number(baseQuantity.toFixed(4))} {baseUnit}</strong>.
    {unitPrice > 0 && <> Price per {selectedUnit}: <strong>{money(unitPrice)}</strong>; inventory cost per {baseUnit}: <strong>{money(baseCost)}</strong>.</>}
  </div>
}

function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <><div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{title}</div><div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-faint)', margin: '4px 0 16px' }}>{note}</div>{children}</>
}

function ReadOnlyStage() {
  return <Panel title="Read-only access" note="View only.">
    <div style={{ padding: 12, borderRadius: 6, color: 'var(--text-muted)', background: 'var(--surface-2)', fontSize: 11.5 }}>Select a record on the left to inspect its controlled document and history.</div>
  </Panel>
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: 'block', marginBottom: 11 }}><HelpLabel label={label} style={labelStyle} />{children}</label> }
function Two({ children }: { children: ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>{children}</div> }
function Input({ value, onChange, type = 'text', placeholder = '' }: { value: unknown; onChange: (value: string) => void; type?: string; placeholder?: string }) { return <input type={type} value={String(value ?? '')} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={control} /> }
function Select({ value, onChange, rows, label = (row: Row) => id(row.name), optional = false }: { value: unknown; onChange: (value: string) => void; rows: Row[]; label?: (row: Row) => string; optional?: boolean }) {
  return <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={control}><option value="">{optional ? 'None' : 'Select…'}</option>{rows.map((row: Row) => <option key={id(row.id)} value={id(row.id)}>{label(row)}</option>)}</select>
}
function Action({ children, onClick, disabled, tone = 'accent' }: any) { return <button disabled={disabled} onClick={onClick} style={{ ...action, background: tone === 'good' ? 'var(--good)' : tone === 'danger' ? 'var(--bad)' : 'var(--accent)', opacity: disabled ? .45 : 1 }}>{children}</button> }
function Divider() { return <div style={{ borderTop: '1px solid var(--border)', margin: '17px 0' }} /> }
function Hint({ children }: { children: ReactNode }) { return <div style={{ padding: 9, background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 11.5, borderRadius: 6, marginBottom: 10 }}>{children}</div> }
function appRows(map: Map<string, string>) { return Array.from(map, ([id, name]) => ({ id, name })) }

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-sm)' }
const heroIcon: CSSProperties = { width: 46, height: 46, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent)' }
const eyebrow: CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.02em', color: 'var(--accent)' }
const labelStyle: CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }
const control: CSSProperties = { width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12 }
const action: CSSProperties = { width: '100%', minHeight: 38, border: 0, borderRadius: 6, color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 5 }
const secondary: CSSProperties = { height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: 12, cursor: 'pointer' }
const drawerHeading: CSSProperties = { margin: '0 0 10px', color: 'var(--text)', fontSize: 13, fontWeight: 700 }
const drawerLabel: CSSProperties = { marginBottom: 5, color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }
const drawerValue: CSSProperties = { overflowWrap: 'anywhere', color: 'var(--text)', fontSize: 12.5, fontWeight: 600, lineHeight: 1.45 }
