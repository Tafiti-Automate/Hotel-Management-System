import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { HelpLabel } from '../components/HelpLabel'
import { WorkflowPath } from '../components/WorkflowPath'
import { createBackendRecord, downloadControlledPurchaseOrder, downloadProcurementAttachment, errorMessage, fetchHotels, readBackendPayload, readBackendRecords, runBackendAction, updateBackendRecord, uploadProcurementAttachment, type HotelRecord } from '../lib/api'
import type { Row } from '../lib/data'
import { chipStyleFor, money } from '../lib/theme'
import { useApp } from '../state/AppContext'

type Stage = 'request' | 'quote' | 'lpo' | 'receipt' | 'inspect' | 'return'
type LpoQueue = 'prepare' | 'finance' | 'management' | 'approved' | 'history'
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
  quote: { view: 'inventory.view_supplieritemprice', change: 'procurement.change_requisitionitem' },
  lpo: { view: 'procurement.view_purchaseorder', change: 'procurement.change_purchaseorder' },
  receipt: { view: 'procurement.view_goodsreceiptnote', change: 'procurement.change_goodsreceiptnote' },
  inspect: { view: 'procurement.view_goodsinspection', change: 'procurement.change_goodsinspection' },
  return: { view: 'procurement.view_supplierreturn', change: 'procurement.change_supplierreturn' },
}

const empty: Datasets = Object.fromEntries(Object.keys(paths).map((key) => [key, []]))

function id(value: unknown) { return String(value || '') }
function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0 }
function currentApprovalStep(order: Row): Row | undefined {
  const steps = Array.isArray(order.approval_steps) ? order.approval_steps as Row[] : []
  return steps.find((step) => id(step.status) === 'pending')
}
function isFinanceApproval(order: Row): boolean {
  return /finance/i.test(id(currentApprovalStep(order)?.stage_name))
}
function isManagementApproval(order: Row): boolean {
  return /(general manager|management)/i.test(id(currentApprovalStep(order)?.stage_name))
}
function managementApprovalStep(order: Row): Row | undefined {
  const steps = Array.isArray(order.approval_steps) ? order.approval_steps as Row[] : []
  return steps.find((step) => /(general manager|management)/i.test(id(step.stage_name)))
}
function hasManagementDecision(order: Row): boolean {
  const status = id(managementApprovalStep(order)?.status)
  return status === 'approved' || status === 'rejected'
}
function defaultLpoQueue(role: string): LpoQueue {
  if (role === 'financial manager') return 'finance'
  if (role === 'general manager') return 'management'
  return 'prepare'
}
function formatDateTime(value: unknown) {
  const raw = id(value).trim()
  if (!raw) return '—'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function formatDateOnly(value: unknown) {
  const raw = id(value).trim()
  if (!raw) return '—'
  const parsed = new Date(`${raw.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fileSize(value: unknown) {
  const bytes = num(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ProcurementWorkbench() {
  const app = useApp()
  const role = app.user.role.toLowerCase()
  const isProcurementRole = ['procurement manager', 'procurement officer'].includes(role)
  const [stage, setStage] = useState<Stage>(() => {
    if (role === 'receiving clerk') return 'receipt'
    if (['procurement manager', 'procurement officer'].includes(role)) return 'quote'
    if (['financial manager', 'general manager'].includes(role)) return 'lpo'
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
  const [lpoQueue, setLpoQueue] = useState<LpoQueue>(() => defaultLpoQueue(role))
  const knownApprovedOrderIds = useRef<Set<string>>(new Set())
  const can = useCallback(
    (permission: string) => app.user.isSuperuser || app.user.permissions.includes(permission),
    [app.user.isSuperuser, app.user.permissions],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const payload = await readBackendPayload(`requisitions/workspace?stage=${stage}`)
      if (stage === 'lpo' && ['financial manager', 'general manager'].includes(role)) {
        payload.approvalQueueOrders = await readBackendRecords('purchase-orders/approval-inbox')
        if (role === 'general manager') {
          payload.decisionHistoryOrders = await readBackendRecords('purchase-orders/decision-history')
        }
      }
      setData((current) => ({ ...current, ...payload }))
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [role, stage])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setForm({}); setMessage(''); setSelectedRecord(null) }, [stage])
  useEffect(() => {
    setLpoQueue(defaultLpoQueue(role))
    // Procurement's first responsibility after the Store Keeper hand-off is to
    // review the new Store Requisition and allocate suppliers. Keep this as the
    // landing stage when the authenticated operational role changes to Procurement.
    if (['procurement manager', 'procurement officer'].includes(role)) setStage('quote')
  }, [role])
  useEffect(() => {
    if (!app.procurementDraftId) return
    setStage('request')
    setForm({ requisition: app.procurementDraftId })
    app.consumeProcurementDraft()
  }, [app.procurementDraftId, app.consumeProcurementDraft])
  const scopedData = useMemo(() => {
    if (!app.currentBranch) return data
    const selectedBranchId = id(
      app.data.branches.find((branch) => id(branch.name) === id(app.currentBranch))?.id
      || app.user.branchId,
    )
    const next = { ...data }
    // The workspace API has already applied role-based visibility. Scope by the
    // requisition's branch directly; Procurement is deliberately not permitted
    // to browse the employee directory, so requester-based scoping hides every
    // valid Store Keeper hand-off when app.data.employees is empty.
    next.requisitions = selectedBranchId
      ? data.requisitions.filter((row) => !row.branch || id(row.branch) === selectedBranchId)
      : data.requisitions
    const requisitions = new Set(next.requisitions.map((row) => id(row.id)))
    next.requisitionItems = data.requisitionItems.filter((row) => requisitions.has(id(row.requisition)))
    next.approvals = data.approvals.filter((row) => requisitions.has(id(row.requisition)))
    next.requisitionHistory = data.requisitionHistory.filter((row) => requisitions.has(id(row.requisition)))
    next.quotations = data.quotations.filter((row) => requisitions.has(id(row.requisition)))
    const quotations = new Set(next.quotations.map((row) => id(row.id)))
    next.quotationItems = data.quotationItems.filter((row) => quotations.has(id(row.quotation)))
    next.orders = data.orders.filter((row) => requisitions.has(id(row.requisition)))
    const orders = new Set(next.orders.map((row) => id(row.id)))
    next.orderItems = data.orderItems.filter((row) => orders.has(id(row.purchase_order)))
    // A Receiving Clerk's order payload intentionally contains only LPOs that
    // are still ready to receive. A fully received LPO therefore disappears
    // from `orders`, but its GRN must remain in the clerk's history. Scope those
    // receipts by their serialized branch instead of by the ready-LPO IDs.
    next.receipts = role === 'receiving clerk'
      ? data.receipts.filter((row) => !row.branch_id || id(row.branch_id) === selectedBranchId)
      : data.receipts.filter((row) => orders.has(id(row.purchase_order)))
    const receipts = new Set(next.receipts.map((row) => id(row.id)))
    next.receiptItems = data.receiptItems.filter((row) => receipts.has(id(row.goods_receipt)))
    next.inspections = data.inspections.filter((row) => receipts.has(id(row.goods_receipt)))
    const inspections = new Set(next.inspections.map((row) => id(row.id)))
    next.inspectionItems = data.inspectionItems.filter((row) => inspections.has(id(row.inspection)))
    next.returns = data.returns.filter((row) => receipts.has(id(row.goods_receipt)))
    const returns = new Set(next.returns.map((row) => id(row.id)))
    next.returnItems = data.returnItems.filter((row) => returns.has(id(row.supplier_return)))
    return next
  }, [app.currentBranch, app.data.branches, app.user.branchId, data, role])
  useEffect(() => {
    if (stage !== 'lpo' || loading || !['procurement manager', 'procurement officer'].includes(role)) return
    const approvedOrders = scopedData.orders.filter((row) => id(row.status) === 'approved')
    const unseenApproved = approvedOrders.filter((row) => !knownApprovedOrderIds.current.has(id(row.id)))
    knownApprovedOrderIds.current = new Set(approvedOrders.map((row) => id(row.id)))
    if (!unseenApproved.length) return
    setLpoQueue('approved')
    setForm({ order: id(unseenApproved[0].id) })
  }, [stage, loading, role, scopedData.orders])

  const run = async (
    operation: () => Promise<unknown>,
    success: string,
    nextForm?: Row | ((result: unknown) => Row),
  ) => {
    setBusy(true)
    setMessage('')
    try {
      const result = await operation()
      await Promise.all([load(), Promise.resolve(app.refreshData())])
      setForm(typeof nextForm === 'function' ? nextForm(result) : nextForm || {})
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

  const selectWorkspaceRecord = (row: Row) => {
    if (stage === 'quote') {
      const lines = scopedData.requisitionItems.filter((line) => id(line.requisition) === id(row.id))
      const firstLine = lines.find((line) => !line.procurement_supplier_price) || lines[0]
      setSelectedRecord(null)
      setForm({ requisition: id(row.id), reqLine: id(firstLine?.id) })
      return
    }
    if (stage !== 'lpo') {
      void openRecord(row)
      return
    }
    if (id(row.__workspace_kind) === 'ready_requisition') {
      setSelectedRecord(null)
      setLpoQueue('prepare')
      setForm({ requisition: id(row.id) })
      return
    }
    const status = id(row.status)
    // Finance and General Manager records come from the backend's authoritative
    // approval inbox. Do not infer their queue again from a possibly stale or
    // partially serialized approval timeline when they click the record.
    if (role === 'financial manager' && status === 'pending_approval') {
      setSelectedRecord(null)
      setLpoQueue('finance')
      setForm({ order: id(row.id) })
      return
    }
    if (role === 'general manager' && status === 'pending_approval') {
      setSelectedRecord(null)
      setLpoQueue('management')
      setForm({ order: id(row.id) })
      return
    }
    if (role === 'general manager' && hasManagementDecision(row)) {
      setSelectedRecord(null)
      setLpoQueue('history')
      setForm({ order: id(row.id) })
      return
    }
    if (['issued', 'partially_received', 'received', 'rejected', 'cancelled'].includes(status)) {
      setSelectedRecord(null)
      setLpoQueue('history')
      setForm({ order: id(row.id) })
      return
    }
    const queue: LpoQueue = status === 'draft'
      ? 'prepare'
      : status === 'pending_approval' && isFinanceApproval(row)
        ? 'finance'
        : status === 'pending_approval'
          ? 'management'
          : status === 'approved'
            ? 'approved'
            : 'history'
    setSelectedRecord(null)
    setLpoQueue(queue)
    setForm({ order: id(row.id) })
  }

  const names = useMemo(() => ({
    items: new Map(app.data.items.map((row) => [id(row.id), id(row.name)])),
    suppliers: new Map(app.data.suppliers.map((row) => [id(row.id), id(row.name)])),
    employees: new Map(app.data.employees.map((row) => [id(row.id), id(row.name)])),
    stores: new Map(app.data.locations.map((row) => [id(row.id), id(row.name)])),
    departments: new Map(app.data.departments.map((row) => [id(row.id), id(row.name)])),
    units: new Map(app.data.uoms.map((row) => [id(row.id), id(row.name)])),
  }), [app.data])

  const requisitionLabel = (row: Row) => `${id(row.source_store_requisition_no) || id(row.requisition_number) || `PR-${id(row.id).slice(0, 8).toUpperCase()}`} · ${['store_requisition','store_shortage'].includes(id(row.procurement_source)) ? 'Store Requisition' : 'Manual'} · ${id(row.reason)}`
  const orderLabel = (row: Row) => `${id(row.lpo_number) || id(row.po_number) || id(row.id).slice(0, 8)} · ${names.suppliers.get(id(row.supplier)) || 'Supplier'}`
  const receiptLabel = (row: Row) => id(row.grn_number) || `GRN-${id(row.id).slice(0, 8).toUpperCase()}`

  const roleStages: Partial<Record<string, Stage[]>> = {
    'procurement manager': ['quote', 'lpo'],
    'procurement officer': ['quote', 'lpo'],
    'financial manager': ['lpo'],
    'general manager': ['lpo'],
    'receiving clerk': ['receipt'],
  }
  const allowedStages = app.user.isSuperuser || role === 'system administrator' ? null : roleStages[role]
  const tabs: Array<[Stage, string, string]> = ([
    ['request', '1', 'Requisition'], ['quote', '2', 'Supplier allocation'],
    ['lpo', '3', 'LPO approval'], ['receipt', '4', role === 'receiving clerk' ? '1. Receive goods' : 'Receiving & GRN'],
    ['inspect', '5', role === 'receiving clerk' ? '2. Confirm & post GRN' : 'Inspection'], ['return', '6', 'Supplier return'],
  ] as Array<[Stage, string, string]>).filter(([key]) => can(stagePermissions[key].view) && (!allowedStages || allowedStages.includes(key)))
  const stageGuidance: Record<Stage, { actor: string; description: string; icon: string }> = {
    request: { actor: 'Requester', description: 'Add every required article, then submit the requisition.', icon: 'playlist_add' },
    quote: { actor: 'Procurement', description: 'Assign a supplier and current price to each requisition item.', icon: 'compare_arrows' },
    lpo: role === 'financial manager'
      ? { actor: 'Financial Manager', description: 'Review price and quantities, then approve or return the LPO.', icon: 'receipt_long' }
      : role === 'general manager'
        ? { actor: 'General Manager', description: 'Make the independent final approval decision.', icon: 'receipt_long' }
        : { actor: 'Procurement and approvers', description: 'Prepare the LPO, follow its approvals, then print and send it.', icon: 'receipt_long' },
    receipt: { actor: 'Receiving / stores', description: 'Record what the supplier delivered against the LPO.', icon: 'move_to_inbox' },
    inspect: { actor: 'Receiving Clerk', description: 'Confirm delivered quantities before posting the GRN.', icon: 'fact_check' },
    return: { actor: 'Stores / procurement', description: 'If needed, send rejected or damaged goods back to the supplier.', icon: 'assignment_return' },
  }
  useEffect(() => {
    if (tabs.length && !tabs.some(([key]) => key === stage)) setStage(tabs[0][0])
  }, [stage, tabs])
  const canChangeStage = can(stagePermissions[stage].change)
  const canManageLpo = app.user.isSuperuser || ['system administrator', 'procurement manager', 'procurement officer'].includes(app.user.role.toLowerCase())
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

  const roleApprovalQueueOrders = useMemo(() => {
    const serverQueue = scopedData.approvalQueueOrders
    if (Array.isArray(serverQueue)) return serverQueue
    if (role === 'financial manager') {
      return scopedData.orders.filter((row) => id(row.status) === 'pending_approval' && isFinanceApproval(row))
    }
    if (role === 'general manager') {
      return scopedData.orders.filter((row) => id(row.status) === 'pending_approval' && isManagementApproval(row))
    }
    return []
  }, [role, scopedData])

  useEffect(() => {
    if (stage !== 'lpo' || loading || form.order || !roleApprovalQueueOrders.length) return
    if (role === 'financial manager') {
      setLpoQueue('finance')
      setForm({ order: id(roleApprovalQueueOrders[0].id) })
    } else if (role === 'general manager') {
      setLpoQueue('management')
      setForm({ order: id(roleApprovalQueueOrders[0].id) })
    }
  }, [stage, loading, role, roleApprovalQueueOrders, form.order])

  const managementHistoryOrders = useMemo(() => {
    if (Array.isArray(scopedData.decisionHistoryOrders)) return scopedData.decisionHistoryOrders
    return scopedData.orders.filter((row) => hasManagementDecision(row))
  }, [scopedData.decisionHistoryOrders, scopedData.orders])

  const procurementQueues = useMemo(() => {
    const storeRequisitions = scopedData.requisitions.filter((row) =>
      ['store_requisition', 'store_shortage'].includes(id(row.procurement_source)) &&
      ['approved', 'partially_ordered'].includes(id(row.status)),
    )
    const activeOrderRequisitions = new Set(
      scopedData.orders.filter((row) => id(row.status) !== 'cancelled').map((row) => id(row.requisition)),
    )
    const needsAllocation = storeRequisitions.filter((row) => {
      const lines = scopedData.requisitionItems.filter((line) => id(line.requisition) === id(row.id))
      return lines.some((line) => !line.procurement_supplier_price || num(line.procurement_quantity) <= 0 || num(line.procurement_unit_cost) <= 0)
    })
    const readyForLpo = storeRequisitions.filter((row) => {
      if (activeOrderRequisitions.has(id(row.id))) return false
      const lines = scopedData.requisitionItems.filter((line) => id(line.requisition) === id(row.id))
      return Boolean(lines.length) && lines.every((line) => Boolean(line.procurement_supplier_price) && num(line.procurement_quantity) > 0 && num(line.procurement_unit_cost) > 0)
    })
    return {
      allocation: needsAllocation.length,
      prepare: readyForLpo.length + scopedData.orders.filter((row) => id(row.status) === 'draft').length,
      finance: scopedData.orders.filter((row) => id(row.status) === 'pending_approval' && isFinanceApproval(row)).length,
      management: scopedData.orders.filter((row) => id(row.status) === 'pending_approval' && isManagementApproval(row)).length,
      approved: scopedData.orders.filter((row) => id(row.status) === 'approved').length,
      history: scopedData.orders.filter((row) => ['issued', 'partially_received', 'received', 'rejected', 'cancelled'].includes(id(row.status))).length,
    }
  }, [scopedData])

  const openProcurementQueue = (key: 'allocation' | LpoQueue) => {
    setSelectedRecord(null)
    setForm({})
    if (key === 'allocation') {
      setStage('quote')
      return
    }
    setStage('lpo')
    setLpoQueue(key)
  }

  if (role === 'receiving clerk') {
    return <ReceivingClerkWorkspace
      data={scopedData}
      names={names}
      busy={busy}
      run={run}
      onRefresh={load}
    />
  }


  return (
    <div style={{ maxWidth: 1480, margin: '0 auto' }}>
      <div style={{ ...card, padding: 20, marginBottom: 16 }}>
        <div className="workbench-hero" style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <span style={heroIcon}><Icon name="shopping_cart_checkout" size={24} color="#fff" /></span>
          <div>
            <div style={eyebrow}>{role === 'financial manager' ? 'Financial control' : role === 'general manager' ? 'Executive control' : role === 'receiving clerk' ? 'Goods receiving' : 'Procurement'}</div>
            <h1 style={{ margin: '3px 0', fontSize: 23, color: 'var(--text)' }}>{role === 'financial manager' ? 'LPO Financial Approval' : role === 'general manager' ? 'Final LPO Approvals' : role === 'receiving clerk' ? 'Receiving & GRN' : 'Procurement Queue'}</h1>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{role === 'financial manager' ? 'Review LPO value and quantities before approval.' : role === 'general manager' ? 'Review Finance-approved LPOs for final authorization.' : role === 'receiving clerk' ? 'Record deliveries against issued LPOs and post GRNs.' : 'Manage supplier allocation, LPO preparation and supplier issue.'}</div>
          </div>
          <button onClick={() => void load()} style={{ ...secondary, marginLeft: 'auto' }}><Icon name="refresh" size={17} />Refresh</button>
        </div>
      </div>
      {isProcurementRole ? <div style={{ ...card, padding: 8, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 6 }}>
        {([
          ['allocation', 'New Store Requisitions', procurementQueues.allocation],
          ['prepare', 'Prepare LPO', procurementQueues.prepare],
          ['finance', 'Awaiting Finance', procurementQueues.finance],
          ['management', 'Awaiting GM', procurementQueues.management],
          ['approved', 'Approved to Send', procurementQueues.approved],
          ['history', 'History', procurementQueues.history],
        ] as Array<['allocation' | LpoQueue, string, number]>).map(([key, label, count]) => {
          const active = key === 'allocation' ? stage === 'quote' : stage === 'lpo' && lpoQueue === key
          return <button key={key} type="button" onClick={() => openProcurementQueue(key)} style={{ minWidth: 0, padding: '10px 9px', border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`, borderRadius: 8, background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-muted)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ fontSize: 10.5, fontWeight: 750, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
            <div style={{ marginTop: 3, fontSize: 17, fontWeight: 850, color: active ? 'var(--accent)' : 'var(--text)' }}>{count}</div>
          </button>
        })}
      </div> : role === 'general manager' ? <div style={{ ...card, padding: 8, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(150px,220px))', gap: 7 }}>
        <button type="button" onClick={() => { setLpoQueue('management'); setForm({}); setSelectedRecord(null) }} style={{ padding: '11px 13px', border: `1px solid ${lpoQueue === 'management' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: lpoQueue === 'management' ? 'var(--accent-soft)' : 'var(--surface)', color: lpoQueue === 'management' ? 'var(--accent)' : 'var(--text)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
          <strong style={{ display: 'block', fontSize: 11.5 }}>Pending</strong><span style={{ display: 'block', marginTop: 3, fontSize: 17, fontWeight: 850 }}>{roleApprovalQueueOrders.length}</span>
        </button>
        <button type="button" onClick={() => { setLpoQueue('history'); setForm({}); setSelectedRecord(null) }} style={{ padding: '11px 13px', border: `1px solid ${lpoQueue === 'history' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: lpoQueue === 'history' ? 'var(--accent-soft)' : 'var(--surface)', color: lpoQueue === 'history' ? 'var(--accent)' : 'var(--text)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
          <strong style={{ display: 'block', fontSize: 11.5 }}>History</strong><span style={{ display: 'block', marginTop: 3, fontSize: 17, fontWeight: 850 }}>{managementHistoryOrders.length}</span>
        </button>
      </div> : <div className="workbench-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
        {role === 'financial manager' ? <>
          <Metric label="Awaiting Finance" value={id(roleApprovalQueueOrders.length)} icon="approval" tone="warn" />
          <Metric label="Visible LPO value" value={money(scopedData.orders.reduce((total,row)=>total+num(row.total_amount),0))} icon="account_balance_wallet" />
          <Metric label="Approved LPOs" value={id(scopedData.orders.filter((row)=>['approved','issued','partially_received','received'].includes(id(row.status))).length)} icon="check_circle" tone="good" />
          <Metric label="Rejected LPOs" value={id(scopedData.orders.filter((row)=>id(row.status)==='rejected').length)} icon="cancel" />
        </> : <>
          <Metric label="Ready for Receiving" value={id(scopedData.orders.filter((row)=>id(row.status)==='issued').length)} icon="move_to_inbox" tone="warn" />
          <Metric label="Partial Deliveries" value={id(scopedData.orders.filter((row)=>id(row.status)==='partially_received').length)} icon="pending_actions" tone="warn" />
          <Metric label="Open GRNs" value={id(scopedData.receipts.length)} icon="receipt_long" />
          <Metric label="Unposted Receipt Lines" value={id(metrics.unposted)} icon="fact_check" tone={metrics.unposted ? 'warn' : 'good'} />
        </>}
      </div>}


      {!isProcurementRole && tabs.length > 1 && <WorkflowPath
        title={role === 'receiving clerk' ? 'Receiving workflow' : 'Procurement workflow'}
        summary={role === 'receiving clerk' ? 'Record the delivery and post the GRN.' : 'Allocate suppliers, prepare the LPO and control supplier issue.'}
        activeKey={stage}
        onSelect={(key) => setStage(key as Stage)}
        steps={tabs.map(([key, , label]) => ({ key, label, ...stageGuidance[key] }))}
      />}

      {message && <div style={{ ...card, padding: 13, marginBottom: 14, borderColor: 'rgba(220,38,38,.3)', color: 'var(--bad)', fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><span>{message}</span><button type="button" onClick={() => void load()} style={secondary}>Retry</button></div>}
      {loading ? <div style={{ ...card, padding: 50, textAlign: 'center', color: 'var(--text-faint)' }}>Loading procurement records from the backend…</div> : (
        <div className="workbench-grid" style={{ display: 'grid', gridTemplateColumns: role === 'general manager' && !form.order ? '1fr' : stage === 'lpo' && form.order ? 'minmax(0,.9fr) minmax(460px,1.1fr)' : 'minmax(0,1.45fr) minmax(340px,.75fr)', gap: 16, alignItems: 'start' }}>
          <section style={{ ...card, overflow: 'hidden' }}>
            <StageTable stage={stage} lpoQueue={lpoQueue} data={scopedData} names={names} role={role} onSelect={selectWorkspaceRecord} />
          </section>
          {!(role === 'general manager' && !form.order) && <aside style={{ ...card, padding: 18 }}>
            {!canChangeStage && stage !== 'lpo' && <ReadOnlyStage />}
            {canChangeStage && stage === 'request' && <RequestPanel {...{ data: scopedData, form, setForm, busy, run, requisitionLabel }} items={app.data.items} stores={app.data.locations} departments={app.data.departments} />}
            {canChangeStage && stage === 'quote' && <QuotePanel {...{ data: scopedData, form, setForm, busy, run, requisitionLabel, names }} suppliers={app.data.suppliers} supplierItems={app.data.supplierItems} items={app.data.items} itemUnits={app.data.itemUnits} onContinueToLpo={(requisitionId: string) => { setStage('lpo'); setLpoQueue('prepare'); setForm({ requisition: requisitionId }) }} />}
            {stage === 'lpo' && <LpoPanel {...{ data: scopedData, form, setForm, busy, run, requisitionLabel, orderLabel, names, lpoQueue, setLpoQueue }} role={role} canManage={canManageLpo} userName={app.user.name} suppliers={app.data.suppliers} units={app.data.uoms} items={app.data.items} itemUnits={app.data.itemUnits} />}
            {canChangeStage && stage === 'receipt' && <ReceiptPanel {...{ data: scopedData, form, setForm, busy, run, orderLabel, receiptLabel, names }} employees={app.data.employees} stores={app.data.locations} />}
            {canChangeStage && stage === 'inspect' && <InspectionPanel {...{ data: scopedData, form, setForm, busy, run, receiptLabel, names }} employees={app.data.employees} />}
            {canChangeStage && stage === 'return' && <ReturnPanel {...{ data: scopedData, form, setForm, busy, run, receiptLabel, names }} employees={app.data.employees} stores={app.data.locations} />}
          </aside>}
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

function ReceivingClerkWorkspace({ data, names, busy, run, onRefresh }: {
  data: Datasets
  names: Record<string, Map<string, string>>
  busy: boolean
  run: (operation: () => Promise<unknown>, success: string, nextForm?: Row | ((result: unknown) => Row)) => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const app = useApp()
  const [hotel, setHotel] = useState<HotelRecord | null>(null)
  const [view, setView] = useState<'ready' | 'history'>('ready')
  const [query, setQuery] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [selectedReceiptId, setSelectedReceiptId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    void fetchHotels()
      .then((hotels) => {
        if (active) setHotel(hotels.find((row) => row.is_active) || hotels[0] || null)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  const readyOrders = useMemo(
    () => data.orders.filter((row) => ['issued', 'partially_received'].includes(id(row.status))),
    [data.orders],
  )
  const supplierRows = useMemo(() => {
    const ids = Array.from(new Set(readyOrders.map((row) => id(row.supplier)).filter(Boolean)))
    return ids.map((supplierId) => ({ id: supplierId, name: names.suppliers.get(supplierId) || 'Supplier' }))
  }, [names.suppliers, readyOrders])
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOrders = readyOrders.filter((order) => {
    if (supplierFilter && id(order.supplier) !== supplierFilter) return false
    if (!normalizedQuery) return true
    const lpo = id(order.lpo_number || order.po_number).toLowerCase()
    const supplier = (names.suppliers.get(id(order.supplier)) || '').toLowerCase()
    return lpo.includes(normalizedQuery) || supplier.includes(normalizedQuery)
  })

  const selectedOrder = readyOrders.find((row) => id(row.id) === selectedOrderId)
  const orderLines = selectedOrder
    ? data.orderItems.filter((line) => id(line.purchase_order) === id(selectedOrder.id))
    : []
  const positiveLines = orderLines
    .map((line) => ({
      purchase_order_item: id(line.id),
      quantity_received: num(quantities[id(line.id)]),
    }))
    .filter((line) => line.quantity_received > 0)
  const lineInvalid = orderLines.some((line) => {
    const entered = num(quantities[id(line.id)])
    const outstanding = num(line.outstanding_quantity ?? line.approved_quantity ?? line.quantity)
    return entered < 0 || entered > outstanding
  })

  const selectedReceipt = data.receipts.find((row) => id(row.id) === selectedReceiptId)
  const receiptLines = selectedReceipt
    ? data.receiptItems.filter((line) => id(line.goods_receipt) === id(selectedReceipt.id))
    : []

  const historyRows = data.receipts.filter((receipt) => {
    if (!normalizedQuery) return true
    return [receipt.grn_number, receipt.lpo_number, receipt.supplier_name, receipt.supplier_invoice_no]
      .some((value) => id(value).toLowerCase().includes(normalizedQuery))
  })

  const clearSelection = () => {
    setSelectedOrderId('')
    setSelectedReceiptId('')
    setInvoiceNumber('')
    setReceivedDate(new Date().toISOString().slice(0, 10))
    setQuantities({})
  }

  if (selectedOrder) {
    const supplier = names.suppliers.get(id(selectedOrder.supplier)) || 'Supplier'
    return <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <button type="button" onClick={() => setSelectedOrderId('')} style={{ ...secondary, marginBottom: 14 }}><Icon name="arrow_back" size={16} />Back to Ready LPOs</button>
      <section style={{ ...card, overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 14, justifyContent: 'space-between' }}>
          <div>
            <div style={eyebrow}>Supplier delivery</div>
            <h1 style={{ margin: '4px 0 3px', fontSize: 24, color: 'var(--text)' }}>Receive LPO {id(selectedOrder.lpo_number || selectedOrder.po_number)}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>{supplier}</div>
          </div>
          <span style={{ padding: '6px 10px', borderRadius: 999, background: id(selectedOrder.status) === 'partially_received' ? 'var(--warn-soft)' : 'var(--accent-soft)', color: id(selectedOrder.status) === 'partially_received' ? 'var(--warn)' : 'var(--accent)', fontSize: 10.5, fontWeight: 800 }}>{id(selectedOrder.status) === 'partially_received' ? 'Partial delivery' : 'Ready to receive'}</span>
        </div>

        <div style={{ padding: 20 }}>
          <div className="receiving-document-fields" style={{ marginBottom: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)', display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
            <ReadOnlyValue label="Selected LPO" value={id(selectedOrder.lpo_number || selectedOrder.po_number)} />
            <ReadOnlyValue label="Supplier (set by the LPO)" value={supplier} />
          </div>

          <div className="receiving-document-fields" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12, marginBottom: 18 }}>
            <Field label="2. Enter supplier invoice number *"><Input value={invoiceNumber} onChange={setInvoiceNumber} placeholder="Number printed on the supplier invoice" /></Field>
            <Field label="Received date"><Input type="date" value={receivedDate} onChange={setReceivedDate} /></Field>
          </div>

          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Delivered items</h2>
            <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{orderLines.length} item{orderLines.length === 1 ? '' : 's'} on LPO</span>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div className="receiving-line-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.5fr) .65fr .8fr .8fr .85fr .6fr', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}>
              <span>Article</span><span>LPO Qty</span><span>Previously received</span><span>Outstanding</span><span>Receive now</span><span>UOM</span>
            </div>
            {orderLines.map((line) => {
              const lineId = id(line.id)
              const ordered = num(line.approved_quantity ?? line.quantity)
              const previous = num(line.previously_received_quantity)
              const outstanding = num(line.outstanding_quantity ?? Math.max(0, ordered - previous))
              const entered = num(quantities[lineId])
              const invalid = entered > outstanding
              return <div key={lineId} className="receiving-line-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.5fr) .65fr .8fr .8fr .85fr .6fr', gap: 10, alignItems: 'center', padding: '12px', borderTop: '1px solid var(--border)', fontSize: 11.5 }}>
                <strong style={{ color: 'var(--text)' }}>{names.items.get(id(line.item)) || id(line.item)}</strong>
                <span style={{ color: 'var(--text-muted)' }}>{ordered}</span>
                <span style={{ color: 'var(--text-muted)' }}>{previous}</span>
                <strong style={{ color: outstanding > 0 ? 'var(--text)' : 'var(--good)' }}>{outstanding}</strong>
                <div>
                  <Input type="number" value={quantities[lineId] || ''} onChange={(value) => setQuantities((current) => ({ ...current, [lineId]: value }))} placeholder="0" />
                  {invalid && <div style={{ marginTop: 4, color: 'var(--bad)', fontSize: 9.5 }}>Maximum {outstanding}</div>}
                </div>
                <span style={{ color: 'var(--text-muted)' }}>{names.units.get(id(line.unit)) || 'Unit'}</span>
              </div>
            })}
          </div>

          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={() => setSelectedOrderId('')} style={secondary}>Cancel</button>
            <button
              type="button"
              disabled={busy || !invoiceNumber.trim() || !positiveLines.length || lineInvalid}
              onClick={() => void run(
                () => runBackendAction('purchase-orders', id(selectedOrder.id), 'receive-delivery', {
                  supplier_invoice_no: invoiceNumber.trim(),
                  delivery_note_no: '',
                  received_date: receivedDate,
                  lines: positiveLines,
                }).then((result) => {
                  clearSelection()
                  setView('history')
                  setSelectedReceiptId(id(result.id))
                  return result
                }),
                'GRN generated successfully',
              )}
              style={{ ...action, width: 'auto', minWidth: 150, marginTop: 0, padding: '0 18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'var(--good)', opacity: busy || !invoiceNumber.trim() || !positiveLines.length || lineInvalid ? .5 : 1 }}
            ><Icon name="receipt_long" size={17} color="#fff" />Generate GRN</button>
          </div>
        </div>
      </section>
    </div>
  }

  if (selectedReceipt) {
    return <div className="grn-document-screen" style={{ maxWidth: 1380, margin: '0 auto' }}>
      <div className="screen-document-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <button type="button" onClick={() => setSelectedReceiptId('')} style={secondary}><Icon name="arrow_back" size={16} />Back to GRN History</button>
        <button type="button" onClick={() => window.print()} style={{ ...secondary, color: 'var(--accent)', borderColor: 'var(--accent)' }}><Icon name="print" size={17} />Print GRN</button>
      </div>
      <div className="grn-document-scroll">
        <GoodsReceiptDocument
          receipt={selectedReceipt}
          lines={receiptLines}
          hotel={hotel}
          propertyName={id(selectedReceipt.branch_name) || app.currentBranch || app.user.branchName}
          preparedBy={id(selectedReceipt.received_by_name) || app.user.name}
          items={app.data.items}
          stores={app.data.locations}
          departments={app.data.departments}
        />
      </div>
    </div>
  }

  return <div style={{ maxWidth: 1320, margin: '0 auto' }}>
    <div style={{ ...card, padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 13 }}>
      <span style={heroIcon}><Icon name="move_to_inbox" size={24} color="#fff" /></span>
      <div>
        <div style={eyebrow}>Receiving Clerk</div>
        <h1 style={{ margin: '3px 0', fontSize: 24, color: 'var(--text)' }}>Receive Supplier Delivery</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>First select the issued LPO for the delivery. The supplier comes from the LPO; enter the invoice number after opening it.</div>
      </div>
      <button type="button" onClick={() => void onRefresh()} style={{ ...secondary, marginLeft: 'auto' }}><Icon name="refresh" size={17} />Refresh</button>
    </div>

    <div style={{ ...card, padding: 8, marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(150px,220px))', gap: 7 }}>
      <button type="button" onClick={() => { setView('ready'); setSelectedReceiptId('') }} style={{ padding: '11px 13px', border: `1px solid ${view === 'ready' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: view === 'ready' ? 'var(--accent-soft)' : 'var(--surface)', color: view === 'ready' ? 'var(--accent)' : 'var(--text)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}><strong style={{ display: 'block', fontSize: 11.5 }}>Ready LPOs</strong><span style={{ display: 'block', marginTop: 3, fontSize: 17, fontWeight: 850 }}>{readyOrders.length}</span></button>
      <button type="button" onClick={() => { setView('history'); setSelectedOrderId('') }} style={{ padding: '11px 13px', border: `1px solid ${view === 'history' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: view === 'history' ? 'var(--accent-soft)' : 'var(--surface)', color: view === 'history' ? 'var(--accent)' : 'var(--text)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}><strong style={{ display: 'block', fontSize: 11.5 }}>GRN History</strong><span style={{ display: 'block', marginTop: 3, fontSize: 17, fontWeight: 850 }}>{data.receipts.length}</span></button>
    </div>

    <section style={{ ...card, overflow: 'hidden' }}>
      <div className="receiving-search-grid" style={{ padding: 14, display: 'grid', gridTemplateColumns: view === 'ready' ? 'minmax(260px,1fr) minmax(210px,.45fr)' : '1fr', gap: 10, borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <Field label={view === 'ready' ? '1. Find the LPO' : 'Search saved GRNs'}><Input value={query} onChange={setQuery} placeholder={view === 'ready' ? 'Type the LPO number (not the invoice number)' : 'GRN, LPO, supplier or invoice number'} /></Field>
        {view === 'ready' && <Field label="Optional: filter by supplier"><select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} style={control}><option value="">All suppliers</option>{supplierRows.map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></Field>}
      </div>

      {view === 'ready' ? <>
        <div className="receiving-ready-header" style={{ display: 'grid', gridTemplateColumns: '.7fr 1.5fr .8fr .8fr auto', gap: 12, padding: '10px 16px', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}><span>LPO</span><span>Supplier</span><span>Expected</span><span>Status</span><span></span></div>
        {filteredOrders.map((order) => <button key={id(order.id)} type="button" onClick={() => { setSelectedOrderId(id(order.id)); setQuantities({}); setInvoiceNumber('') }} style={{ width: '100%', display: 'grid', gridTemplateColumns: '.7fr 1.5fr .8fr .8fr auto', gap: 12, alignItems: 'center', padding: '13px 16px', border: 0, borderTop: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}><strong style={{ color: 'var(--text)', fontSize: 12 }}>LPO {id(order.lpo_number || order.po_number)}</strong><span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{names.suppliers.get(id(order.supplier)) || 'Supplier'}</span><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{formatDateOnly(order.expected_date)}</span><span style={{ color: id(order.status) === 'partially_received' ? 'var(--warn)' : 'var(--good)', fontSize: 10.8, fontWeight: 750 }}>{id(order.status) === 'partially_received' ? 'Partial' : 'Ready'}</span><span style={{ color: 'var(--accent)', fontSize: 10.8, fontWeight: 800 }}>Receive</span></button>)}
        {!filteredOrders.length && <div style={{ padding: 48, textAlign: 'center' }}><Icon name="inventory_2" size={25} color="var(--text-faint)" /><div style={{ marginTop: 8, color: 'var(--text)', fontWeight: 750 }}>No matching LPOs</div><div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11.5 }}>{readyOrders.length ? 'Try another LPO number or supplier.' : 'No supplier deliveries are currently ready for receiving.'}</div></div>}
      </> : <>
        <div style={{ display: 'grid', gridTemplateColumns: '.7fr .7fr 1.4fr .8fr .7fr auto', gap: 12, padding: '10px 16px', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}><span>GRN</span><span>LPO</span><span>Supplier</span><span>Invoice</span><span>Date</span><span></span></div>
        {historyRows.map((receipt) => <button key={id(receipt.id)} type="button" onClick={() => setSelectedReceiptId(id(receipt.id))} style={{ width: '100%', display: 'grid', gridTemplateColumns: '.7fr .7fr 1.4fr .8fr .7fr auto', gap: 12, alignItems: 'center', padding: '13px 16px', border: 0, borderTop: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}><strong style={{ color: 'var(--text)', fontSize: 12 }}>{id(receipt.grn_number)}</strong><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>LPO {id(receipt.lpo_number)}</span><span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{id(receipt.supplier_name)}</span><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{id(receipt.supplier_invoice_no) || '—'}</span><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{id(receipt.received_date)}</span><span style={{ color: 'var(--accent)', fontSize: 10.8, fontWeight: 800 }}>View</span></button>)}
        {!historyRows.length && <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11.5 }}>{data.receipts.length ? 'No GRNs match your search.' : 'No GRNs have been generated by you yet.'}</div>}
      </>}
    </section>
  </div>
}

function GoodsReceiptDocument({ receipt, lines, hotel, propertyName, preparedBy, items, stores, departments }: {
  receipt: Row
  lines: Row[]
  hotel: HotelRecord | null
  propertyName: string
  preparedBy: string
  items: Row[]
  stores: Row[]
  departments: Row[]
}) {
  const receiptDate = formatDateOnly(receipt.received_date)
  const lpoDate = formatDateOnly(receipt.lpo_date)
  const hasCommercialValues = lines.some((line) => line.unit_cost !== undefined && line.unit_cost !== null && id(line.unit_cost) !== '')
  const grandTotal = lines.reduce((total, line) => total + num(line.accepted_quantity ?? line.quantity_received) * num(line.unit_cost), 0)
  const hotelName = id(hotel?.legal_name) || id(hotel?.name) || propertyName || 'Hotel Operations'
  const hotelContact = [hotel?.address, hotel?.city, hotel?.country].filter(Boolean).join(', ')
  const hotelPhones = [hotel?.phone, hotel?.alternate_phone].filter(Boolean).join(' / ')
  const supplierContact = [receipt.supplier_phone, receipt.supplier_tin ? `TIN: ${id(receipt.supplier_tin)}` : ''].filter(Boolean).join(' · ')
  const formatQty = (value: unknown) => {
    const quantity = num(value)
    return Number.isInteger(quantity) ? quantity.toFixed(0) : quantity.toFixed(2)
  }

  return <>
    <style>{'@media print { @page { size: A4 landscape; margin: 8mm; } }'}</style>
    <article className="grn-document" aria-label={`Goods Receipt Note ${id(receipt.grn_number)}`}>
      <header className="grn-brand-header">
        <div className="grn-logo-block">
          {hotel?.logo ? <img src={hotel.logo} alt={`${hotel.name} logo`} /> : <div className="grn-logo-placeholder">{hotelName.split(/\s+/).map((part) => part[0]).join('').slice(0, 3)}</div>}
          <div className="grn-property-name">{propertyName || hotel?.name || 'Hotel property'}</div>
        </div>
        <div className="grn-company-block">
          <strong>{hotelName}</strong>
          {hotelContact && <span>{hotelContact}</span>}
          {(hotelPhones || hotel?.email) && <span>{hotelPhones}{hotelPhones && hotel?.email ? ' · ' : ''}{hotel?.email}</span>}
          {(hotel?.registration_number || hotel?.tax_identification_number) && <span>Reg: {hotel?.registration_number || '—'} · TIN: {hotel?.tax_identification_number || '—'}</span>}
          <div className="grn-document-title">Goods Receipt Note</div>
        </div>
        <div className="grn-authorized-mark">Authorized</div>
      </header>

      <div className="grn-reference-strip">
        <div><b>GRN NO.</b><span>{id(receipt.grn_number) || '—'}</span></div>
        <div><b>GRN DATE</b><span>{receiptDate}</span></div>
      </div>

      <section className="grn-party-grid">
        <div className="grn-supplier-block">
          <b>From,</b>
          <strong>{id(receipt.supplier_name) || 'Supplier'}</strong>
          <span>{id(receipt.supplier_address) || 'Address not recorded'}</span>
          {supplierContact && <span>{supplierContact}</span>}
        </div>
        <dl className="grn-delivery-meta">
          <div><dt>LPO NO.</dt><dd>{id(receipt.lpo_number) || '—'}</dd><dt>DATE</dt><dd>{lpoDate}</dd></div>
          <div><dt>SUPPLIER INVOICE</dt><dd>{id(receipt.supplier_invoice_no) || '—'}</dd><dt>DATE</dt><dd>{receiptDate}</dd></div>
          <div><dt>DELIVERY NOTE</dt><dd>{id(receipt.delivery_note_no) || '—'}</dd><dt>STATUS</dt><dd>{id(receipt.status).replace(/_/g, ' ') || 'Posted'}</dd></div>
          <div><dt>RECEIVING STORE</dt><dd>{id(receipt.receiving_store_name) || 'Direct delivery'}</dd><dt>RECEIVED BY</dt><dd>{preparedBy}</dd></div>
        </dl>
      </section>

      <table className="grn-material-table">
        <thead><tr>
          <th>Sl.<br />No.</th>
          <th>LPO No. / Date</th>
          <th>Item Code</th>
          <th>Item Description</th>
          <th>Dept. / Destination</th>
          <th>UOM</th>
          <th className="number">LPO<br />Qty.</th>
          <th className="number">Received<br />Qty.</th>
          <th className="number">Short<br />Qty.</th>
          <th className="number">Excess<br />Qty.</th>
          <th className="number">Rejected<br />Qty.</th>
          <th className="number">Accepted<br />Qty.</th>
          <th className="number">Rate</th>
          <th className="number">Total<br />Value</th>
        </tr></thead>
        <tbody>
          {lines.map((line, index) => {
            const item = items.find((row) => id(row.id) === id(line.item))
            const ordered = num(line.ordered_quantity ?? line.quantity_received)
            const received = num(line.quantity_received)
            const accepted = num(line.accepted_quantity ?? received)
            const rejected = num(line.rejected_quantity)
            const destination = line.direct_issue_department
              ? departments.find((row) => id(row.id) === id(line.direct_issue_department))?.name
              : stores.find((row) => id(row.id) === id(line.store))?.name
            const rate = num(line.unit_cost)
            return <tr key={id(line.id)}>
              <td className="center">{index + 1}</td>
              <td>{id(receipt.lpo_number)}<br />{lpoDate}</td>
              <td>{id(line.item_sku) || id(item?.sku) || '—'}</td>
              <td><strong>{id(line.item_name) || id(item?.name) || 'Article'}</strong>{item?.category && <small>{id(item.category)}</small>}</td>
              <td>{id(destination) || '—'}</td>
              <td className="center">{id(line.unit_abbreviation) || id(line.unit_name) || id(item?.uom) || '—'}</td>
              <td className="number">{formatQty(ordered)}</td>
              <td className="number">{formatQty(received)}</td>
              <td className="number">{formatQty(Math.max(ordered - received, 0))}</td>
              <td className="number">{formatQty(Math.max(received - ordered, 0))}</td>
              <td className="number">{formatQty(rejected)}</td>
              <td className="number">{formatQty(accepted)}</td>
              <td className="number">{hasCommercialValues ? money(rate).replace('UGX ', '') : '—'}</td>
              <td className="number">{hasCommercialValues ? money(rate * accepted).replace('UGX ', '') : '—'}</td>
            </tr>
          })}
          {!lines.length && <tr><td colSpan={14} className="grn-empty-row">No received items recorded on this GRN.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={12}></td><th>Grand Total</th><td className="number">{hasCommercialValues ? money(grandTotal) : '—'}</td></tr></tfoot>
      </table>

      <div className="grn-control-strip">
        <span>Authorized&nbsp;&nbsp;: <b>{id(receipt.status) === 'posted' ? 'Yes' : 'Pending'}</b></span>
        <span>Inspection Required&nbsp;&nbsp;: <b>Yes</b></span>
        <span>Inventory Posted&nbsp;&nbsp;: <b>{lines.every((line) => line.inventory_changes_applied) ? 'Yes' : 'Pending'}</b></span>
      </div>

      <section className="grn-signatures">
        <div><i>{preparedBy}</i><b>Prepared By</b></div>
        <div><i></i><b>Store Manager</b></div>
        <div><i>{preparedBy}</i><b>Inspected By</b></div>
        <div><i></i><b>H.O.D.</b></div>
        <div><i></i><b>Account Manager</b></div>
      </section>

      <footer className="grn-document-footer">
        <span>Generated {formatDateTime(receipt.posted_at || receipt.created_at)}</span>
        <span>Page 1 of 1</span>
      </footer>
    </article>
  </>
}

function RequestPanel({ data, form, setForm, requisitionLabel, items }: any) {
  const incoming = data.requisitions.filter((row: Row) => ['store_requisition','store_shortage'].includes(id(row.procurement_source)))
  const selected = incoming.find((row: Row) => id(row.id) === id(form.requisition))
  const lines = data.requisitionItems.filter((row: Row) => id(row.requisition) === id(form.requisition))
  return <Panel title="Incoming Store requisitions" note="Select the Store Keeper's requisition. Item, quantity and destination are inherited and are not re-entered here.">
    <Field label="Store requisition / procurement hand-off"><Select value={form.requisition} onChange={(v) => setForm({ requisition: v })} rows={incoming} label={requisitionLabel} /></Field>
    {!incoming.length && <Hint>No Store Keeper requisitions are waiting for Procurement.</Hint>}
    {selected && <section style={{ margin: '10px 0 12px', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 11.5, fontWeight: 800 }}>Inherited demand · read only</div>
      {lines.map((line: Row) => <div key={id(line.id)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) .7fr minmax(120px,1fr)', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: 11.5 }}>
        <span style={{ color: 'var(--text)', fontWeight: 700 }}>{items.find((item: Row) => id(item.id) === id(line.item))?.name || id(line.item)}</span>
        <span style={{ color: 'var(--text-muted)' }}>{line.quantity}</span>
        <span style={{ color: 'var(--text-muted)' }}>{line.destination_type === 'workspace' ? 'Department destination' : 'Store destination locked'}</span>
      </div>)}
      {!lines.length && <div style={{ padding: 16, color: 'var(--text-faint)', fontSize: 11.5 }}>No inherited lines are available.</div>}
    </section>}
    <Hint>Supplier and price decisions are made in the next step. Procurement may reduce quantity later on the LPO, but this source demand remains unchanged for audit.</Hint>
  </Panel>
}

function QuotePanel({ data, form, setForm, busy, run, names, suppliers, supplierItems, items, itemUnits, onContinueToLpo }: any) {
  const requisitions = data.requisitions.filter((row: Row) => ['store_requisition','store_shortage'].includes(id(row.procurement_source)) && ['approved','partially_ordered'].includes(id(row.status)))
  const selectedRequisition = requisitions.find((row: Row) => id(row.id) === id(form.requisition))
  const reqLines = data.requisitionItems.filter((row: Row) => id(row.requisition) === id(form.requisition))
  const selectedReqLine = reqLines.find((row: Row) => id(row.id) === id(form.reqLine))
  const catalogue = selectedReqLine
    ? supplierItems.filter((entry: Row) => id(entry.articleId) === id(selectedReqLine.item) && id(entry.status) === 'Active')
        .sort((left: Row, right: Row) => num(left.basePrice || left.price) - num(right.basePrice || right.price))
    : []
  const selectedCatalogue = catalogue.find((entry: Row) => id(entry.id) === id(form.cataloguePrice))
  const selectedSupplier = suppliers.find((supplier: Row) => id(supplier.id) === id(selectedCatalogue?.supplierId))
  const selectedItem = items.find((item: Row) => id(item.id) === id(selectedReqLine?.item))
  const requestedBase = num(selectedReqLine?.remaining_order_quantity ?? selectedReqLine?.approved_base_quantity ?? selectedReqLine?.approved_quantity ?? selectedReqLine?.quantity)
  const selectedFactor = selectedCatalogue ? conversionFactorFor(selectedItem, selectedCatalogue.unitId, itemUnits) : 1
  // The client approves quantities in the Article/request UOM. Supplier prices
  // may be quoted by carton/sack/jerrycan, but the LPO quantity must remain the
  // approved Article quantity (for example 1 ream, never 0.20 carton).
  const maxOrderQuantity = requestedBase
  const enteredOrderQuantity = num(form.quantity || maxOrderQuantity)
  const confirmedPrice = num(form.price ?? selectedCatalogue?.price)
  const quotedPrice = num(selectedCatalogue?.price)
  const confirmedBasePrice = selectedFactor > 0 ? confirmedPrice / selectedFactor : 0
  const priceChanged = Boolean(selectedCatalogue && Math.abs(confirmedPrice - quotedPrice) > 0.000001)
  const allocationExceedsRequest = Boolean(selectedCatalogue) && (selectedFactor <= 0 || enteredOrderQuantity > requestedBase + 0.000001)
  const allocatedCount = reqLines.filter((line: Row) => line.procurement_supplier_price && num(line.procurement_quantity) > 0 && num(line.procurement_unit_cost) > 0).length
  const allAllocated = Boolean(reqLines.length) && allocatedCount === reqLines.length

  const selectArticle = (value: string) => {
    const line = reqLines.find((row: Row) => id(row.id) === value)
    const article = items.find((item: Row) => id(item.id) === id(line?.item))
    const offers = supplierItems.filter((entry: Row) => id(entry.articleId) === id(line?.item) && id(entry.status) === 'Active')
      .sort((left: Row, right: Row) => num(left.basePrice || left.price) - num(right.basePrice || right.price))
    const existing = offers.find((entry: Row) => id(entry.id) === id(line?.procurement_supplier_price))
    const baseLimit = num(line?.remaining_order_quantity ?? line?.approved_base_quantity ?? line?.approved_quantity ?? line?.quantity)
    const factor = existing ? conversionFactorFor(article, existing.unitId, itemUnits) : 1
    const existingQuotePrice = existing && factor > 0 && line?.procurement_unit_cost
      ? num(line.procurement_unit_cost) * factor
      : existing?.price
    setForm({
      requisition: form.requisition,
      reqLine: value,
      cataloguePrice: id(existing?.id),
      quantity: (line?.procurement_quantity ?? baseLimit) || '',
      price: existingQuotePrice ?? '',
      procurementNote: line?.procurement_note || '',
    })
  }

  if (!selectedRequisition) return <Panel title="New Store Requisition" note="">
    <div style={{ padding: '34px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
      <Icon name="assignment" size={24} color="var(--text-faint)" />
      <div style={{ marginTop: 9, fontWeight: 700, color: 'var(--text)' }}>Select a Store Requisition</div>
      <div style={{ marginTop: 4 }}>Choose a requisition from the list to assign suppliers and confirm prices.</div>
    </div>
  </Panel>

  return <Panel title={`Store Requisition · ${id(selectedRequisition.source_store_requisition_no) || id(selectedRequisition.requisition_number)}`} note="">
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{reqLines.length} item{reqLines.length === 1 ? '' : 's'}</div>
      <span style={{ padding: '5px 8px', borderRadius: 999, background: allAllocated ? 'var(--good-soft)' : 'var(--warn-soft)', color: allAllocated ? 'var(--good)' : 'var(--warn)', fontSize: 10.5, fontWeight: 750 }}>{allocatedCount}/{reqLines.length} allocated</span>
    </div>

    <SectionLabel>Items</SectionLabel>
    <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
      {reqLines.map((line: Row) => {
        const active = id(line.id) === id(form.reqLine)
        const article = items.find((item: Row) => id(item.id) === id(line.item))
        const allocated = Boolean(line.procurement_supplier_price && num(line.procurement_quantity) > 0 && num(line.procurement_unit_cost) > 0)
        return <button key={id(line.id)} type="button" onClick={() => selectArticle(id(line.id))} style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', alignItems: 'center', gap: 9, padding: '9px 10px', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 7, background: active ? 'var(--accent-soft)' : 'var(--surface)', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
          <span style={{ minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5 }}>{names.items.get(id(line.item)) || id(line.item)}</strong><small style={{ color: 'var(--text-muted)' }}>Store Keeper: {id(line.approved_quantity ?? line.quantity)} {id(article?.uom)}</small></span>
          <span style={{ color: allocated ? 'var(--good)' : 'var(--warn)', fontSize: 10.5, fontWeight: 750 }}>{allocated ? 'Allocated' : 'Needs supplier'}</span>
          <Icon name="chevron_right" size={16} color="var(--text-faint)" />
        </button>
      })}
    </div>

    {selectedReqLine && <>
      <SectionLabel>Supplier quotations</SectionLabel>
      {catalogue.length ? <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
        {catalogue.map((entry: Row) => {
          const selected = id(entry.id) === id(selectedCatalogue?.id)
          const supplierName = names.suppliers.get(id(entry.supplierId)) || id(entry.supplier) || 'Supplier'
          return <button key={id(entry.id)} type="button" onClick={() => {
            setForm({ ...form, cataloguePrice: id(entry.id), price: entry.price, quantity: requestedBase })
          }} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) .75fr .65fr auto', alignItems: 'center', gap: 8, padding: '9px 10px', border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 7, background: selected ? 'var(--accent-soft)' : 'var(--surface)', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
            <span style={{ minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.3 }}>{supplierName}</strong><small style={{ color: 'var(--text-muted)' }}>{id(entry.quotationReference) || 'Quotation'} · {id(entry.unit) || id(selectedItem?.uom) || 'unit'}</small></span>
            <strong style={{ fontSize: 11.3 }}>{money(entry.price)}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: 10.3 }}>{id(entry.leadTime || 0)} days</span>
            <span style={{ color: selected ? 'var(--accent)' : 'var(--text-faint)', fontSize: 10.3, fontWeight: 750 }}>{selected ? 'Selected' : 'Select'}</span>
          </button>
        })}
      </div> : <Hint>No active supplier quotation is available for this article.</Hint>}
    </>}

    {selectedCatalogue && <>
      <ReadOnlyValue label="Supplier" value={selectedSupplier?.name || names.suppliers.get(id(selectedCatalogue.supplierId)) || id(selectedCatalogue.supplier)} />
      <Two><Field label={`Quantity to order (${id(selectedItem?.uom) || 'item unit'})`}><Input type="number" value={form.quantity || maxOrderQuantity} onChange={(v) => setForm({ ...form, quantity: v })} /></Field><Field label={`Supplier price per ${id(selectedCatalogue.unit) || 'quoted unit'}`}><Input type="number" value={form.price ?? selectedCatalogue.price} onChange={(v) => setForm({ ...form, price: v })} /></Field></Two>
      <Field label={priceChanged ? 'Reason for price change *' : 'Note'}><Input value={form.procurementNote || ''} onChange={(v) => setForm({ ...form, procurementNote: v })} placeholder={priceChanged ? 'Reason for the revised price' : 'Optional'} /></Field>
      {selectedCatalogue && <QuoteConversionNote orderQuantity={enteredOrderQuantity} factor={selectedFactor} quotedUnit={id(selectedCatalogue.unit) || 'quoted unit'} baseUnit={id(selectedItem?.uom) || 'item unit'} quotedPrice={confirmedPrice} basePrice={confirmedBasePrice} />}
      {allocationExceedsRequest && <Hint>Quantity exceeds the Store Keeper quantity. Maximum is {maxOrderQuantity} {id(selectedItem?.uom) || 'units'}.</Hint>}
      <Action tone="good" disabled={busy || !form.reqLine || !form.cataloguePrice || enteredOrderQuantity <= 0 || allocationExceedsRequest || confirmedPrice <= 0 || (priceChanged && !id(form.procurementNote).trim())} onClick={() => run(
        () => runBackendAction('requisitions', id(form.requisition), 'allocate-line', { line_id: form.reqLine, supplier_price: form.cataloguePrice, quantity: enteredOrderQuantity, unit_price: num(form.price ?? selectedCatalogue.price), note: form.procurementNote || '' }),
        'Supplier allocation saved',
        { requisition: form.requisition },
      )}>Save item</Action>
    </>}

    {allAllocated && <>
      <Divider />
      <Action tone="good" disabled={busy} onClick={() => onContinueToLpo(id(selectedRequisition.id))}>Continue to LPO preparation</Action>
    </>}
  </Panel>
}

function LpoPanel({ data, form, setForm, busy, run, names, suppliers, units, items, itemUnits, canManage, role, userName, lpoQueue, setLpoQueue }: any) {
  const activeOrderRequisitions = new Set(
    data.orders.filter((row: Row) => id(row.status) !== 'cancelled').map((row: Row) => id(row.requisition)),
  )
  const readyRequisitions = data.requisitions.filter((row: Row) => {
    if (!['approved', 'partially_ordered'].includes(id(row.status)) || activeOrderRequisitions.has(id(row.id))) return false
    const reqLines = data.requisitionItems.filter((line: Row) => id(line.requisition) === id(row.id))
    return Boolean(reqLines.length) && reqLines.every((line: Row) => Boolean(line.procurement_supplier_price) && num(line.procurement_quantity) > 0 && num(line.procurement_unit_cost) > 0)
  })
  const order = data.orders.find((row: Row) => id(row.id) === id(form.order))
  const selectedRequisition = readyRequisitions.find((row: Row) => id(row.id) === id(form.requisition))
  const selectedRequisitionLines = data.requisitionItems.filter((row: Row) => id(row.requisition) === id(selectedRequisition?.id))
  const supplierCount = new Set(selectedRequisitionLines.map((row: Row) => id(row.procurement_supplier)).filter(Boolean)).size
  const registeredSupplier = suppliers.find((row: Row) => id(row.id) === id(order?.supplier))
  const registeredSupplierEmail = id(order?.supplier_email || registeredSupplier?.email).trim()
  const lines = data.orderItems.filter((row: Row) => id(row.purchase_order) === id(form.order))
  const line = lines.find((row: Row) => id(row.id) === id(form.orderLine))
  const selectedItem = items.find((item: Row) => id(item.id) === id(line?.item))
  const availableUnits = configuredUnitsForItem(selectedItem, units, itemUnits)
  const conversion = conversionFactorFor(selectedItem, form.unit || line?.unit, itemUnits)
  const sourceLine = data.requisitionItems.find((row: Row) => id(row.id) === id(line?.requisition_item))
  const approvedBaseLimit = num(sourceLine?.remaining_order_quantity ?? sourceLine?.approved_base_quantity)
  const enteredBaseQuantity = num(form.quantity ?? line?.quantity) * conversion
  const quantityExceedsApproval = Boolean(line && conversion > 0 && approvedBaseLimit >= 0 && enteredBaseQuantity > approvedBaseLimit + 0.000001)
  const currentApproval = order ? currentApprovalStep(order) : undefined
  const financeLineId = id(form.financeLine || (lpoQueue === 'finance' ? lines[0]?.id : ''))
  const financeLine = lines.find((row: Row) => id(row.id) === financeLineId)
  const financeQuantityValue = form.financeQuantity ?? financeLine?.approved_quantity ?? financeLine?.quantity ?? ''
  const canDecideFinance = role === 'financial manager' || role === 'system administrator'
  const canDecideManagement = role === 'general manager' || role === 'system administrator'
  const draftHasQuantityOverage = lines.some((orderLine: Row) => {
    const requisitionLine = data.requisitionItems.find((row: Row) => id(row.id) === id(orderLine.requisition_item))
    if (!requisitionLine) return false
    return num(orderLine.base_quantity) > num(requisitionLine.remaining_order_quantity ?? requisitionLine.approved_base_quantity) + 0.000001
  })
  const safeQuantityForLine = (orderLine: Row, unitId: unknown = orderLine.unit) => {
    const article = items.find((item: Row) => id(item.id) === id(orderLine.item))
    const factor = conversionFactorFor(article, unitId, itemUnits)
    if (factor <= 0) return num(orderLine.quantity)
    const requisitionLine = data.requisitionItems.find((row: Row) => id(row.id) === id(orderLine.requisition_item))
    const remainingBase = num(requisitionLine?.remaining_order_quantity ?? requisitionLine?.approved_base_quantity)
    const targetBase = requisitionLine ? Math.min(num(orderLine.base_quantity), remainingBase) : num(orderLine.base_quantity)
    return floorPurchaseQuantity(targetBase / factor)
  }
  const panelTitle = lpoQueue === 'prepare' ? 'LPO Preparation'
    : lpoQueue === 'finance' ? 'Financial Review'
      : lpoQueue === 'management' ? 'Final Approval'
        : lpoQueue === 'approved' ? 'Approved LPO'
          : order ? `LPO ${id(order.lpo_number) || id(order.po_number)}` : 'LPO History'

  if (lpoQueue === 'prepare' && !selectedRequisition && !order) return <Panel title={panelTitle} note="">
    <div style={{ padding: '34px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
      <Icon name="receipt_long" size={24} color="var(--text-faint)" />
      <div style={{ marginTop: 9, fontWeight: 700, color: 'var(--text)' }}>Select a requisition or draft LPO</div>
      <div style={{ marginTop: 4 }}>Choose a record from the list to continue.</div>
    </div>
  </Panel>

  if (['finance', 'management', 'approved', 'history'].includes(lpoQueue) && !order) return <Panel title={panelTitle} note="">
    <div style={{ padding: '34px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
      <Icon name="receipt_long" size={24} color="var(--text-faint)" />
      <div style={{ marginTop: 9, fontWeight: 700, color: 'var(--text)' }}>Select an LPO</div>
      <div style={{ marginTop: 4 }}>Choose a record from the list to view its details.</div>
    </div>
  </Panel>

  return <Panel title={panelTitle} note="">
    {lpoQueue === 'prepare' && selectedRequisition && canManage && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, marginBottom: 13 }}>
        <ReadOnlyValue label="Store Requisition" value={id(selectedRequisition.source_store_requisition_no) || id(selectedRequisition.requisition_number)} />
        <ReadOnlyValue label="Prepared by" value={userName} />
        <ReadOnlyValue label="Items" value={id(selectedRequisitionLines.length)} />
        <ReadOnlyValue label="Suppliers" value={id(supplierCount || 1)} />
      </div>
      <section style={{ marginBottom: 13, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {selectedRequisitionLines.map((row: Row) => <div key={id(row.id)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) .6fr 1fr', gap: 8, padding: '9px 10px', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
          <strong style={{ color: 'var(--text)' }}>{names.items.get(id(row.item)) || id(row.item)}</strong>
          <span style={{ color: 'var(--text-muted)' }}>{id(row.procurement_quantity)}</span>
          <span style={{ color: 'var(--text-muted)' }}>{names.suppliers.get(id(row.procurement_supplier)) || 'Selected supplier'}</span>
        </div>)}
      </section>
      <Action tone="good" disabled={busy} onClick={() => run(
        () => runBackendAction('requisitions', id(selectedRequisition.id), 'create-allocated-lpos', {}),
        'LPO draft created',
        {},
      )}>Create LPO{supplierCount > 1 ? 's' : ''}</Action>
    </>}

    {lpoQueue === 'prepare' && order && canManage && <>
      <LpoSummary order={order} lines={lines} names={names} />
      {draftHasQuantityOverage ? <>
        <Hint>This draft contains a quantity that must be corrected before it can be sent to Finance.</Hint>
        <Field label="Item to correct"><Select value={form.orderLine} onChange={(v) => { const found = lines.find((row: Row) => id(row.id) === v); setForm({ ...form, orderLine: v, quantity: found ? safeQuantityForLine(found) : '', cost: found?.unit_cost, unit: found?.unit }) }} rows={lines} label={(row: Row) => names.items.get(id(row.item)) || id(row.item)} /></Field>
        {line && <><Field label="Purchase unit"><Select value={form.unit} onChange={(v) => setForm({ ...form, unit: v, quantity: safeQuantityForLine(line, v) })} rows={availableUnits} /></Field><Two><Field label="Quantity"><Input type="number" value={form.quantity ?? line.quantity} onChange={(v) => setForm({ ...form, quantity: v })} /></Field><Field label="Unit price"><Input type="number" value={form.cost ?? line.unit_cost} onChange={(v) => setForm({ ...form, cost: v })} /></Field></Two></>}
        {quantityExceedsApproval && <Hint>Quantity is above the approved limit.</Hint>}
        <Action disabled={busy || !form.orderLine || conversion <= 0 || quantityExceedsApproval || num(form.quantity) <= 0} onClick={() => run(() => updateBackendRecord('purchase-order-items', id(form.orderLine), { quantity: num(form.quantity), unit_cost: num(form.cost), unit: form.unit || null }), 'LPO item corrected', { ...form })}>Save correction</Action>
      </> : <Action tone="good" disabled={busy || !lines.length} onClick={() => run(() => runBackendAction('purchase-orders', id(order.id), 'submit-for-approval'), 'LPO sent to Financial Manager')}>Send to Financial Manager</Action>}
    </>}

    {lpoQueue === 'finance' && order && <>
      <LpoSummary order={order} lines={lines} names={names} />
      {!canDecideFinance && <div style={{ padding: '10px 11px', borderRadius: 7, background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 11.3, fontWeight: 700 }}>Awaiting Financial Manager decision</div>}
      {canDecideFinance && <>
        <SectionLabel>Quantity review</SectionLabel>
        <Field label="LPO item"><Select value={financeLineId} onChange={(v) => { const selected = lines.find((row: Row) => id(row.id) === v); setForm({ ...form, financeLine: v, financeQuantity: selected?.approved_quantity ?? selected?.quantity ?? '', financeReason: selected?.finance_reduction_reason || '' }) }} rows={lines} label={(row: Row) => `${names.items.get(id(row.item)) || id(row.item)} · Procurement ${row.procurement_quantity ?? row.quantity}`} /></Field>
        <Two><Field label="Finance approved quantity"><Input type="number" value={financeQuantityValue} onChange={(v) => setForm({ ...form, financeLine: financeLineId, financeQuantity: v })} /></Field><Field label="Reason if reduced"><Input value={form.financeReason || ''} onChange={(v) => setForm({ ...form, financeLine: financeLineId, financeReason: v })} placeholder="Required only when quantity is reduced" /></Field></Two>
        {financeLine && <Hint>Procurement quantity: {id(financeLine.procurement_quantity ?? financeLine.quantity)}. Finance may keep or reduce it, but cannot increase it.</Hint>}
        <Action disabled={busy || !financeLine || num(financeQuantityValue) < 0 || num(financeQuantityValue) > num(financeLine.procurement_quantity ?? financeLine.quantity) || (num(financeQuantityValue) < num(financeLine.procurement_quantity ?? financeLine.quantity) && !id(form.financeReason).trim())} onClick={() => run(() => runBackendAction('purchase-orders', id(order.id), 'finance-reduce-quantities', { comments: '', lines: [{ id: id(financeLine.id), approved_quantity: num(financeQuantityValue), reason: form.financeReason || '' }] }), 'Finance quantity saved')}>Save quantity decision</Action>
        <Action tone="good" disabled={busy || !currentApproval} onClick={() => run(() => runBackendAction('purchase-orders', id(order.id), 'approve', { comments: '' }), 'LPO approved and sent to General Manager')}>Approve LPO</Action>
        {!form.showReject ? <Action tone="danger" disabled={busy} onClick={() => setForm({ ...form, showReject: true })}>Reject LPO</Action> : <><Field label="Rejection reason *"><Input value={form.approvalComments || ''} onChange={(v) => setForm({ ...form, approvalComments: v })} /></Field><Action tone="danger" disabled={busy || !id(form.approvalComments).trim()} onClick={() => run(() => runBackendAction('purchase-orders', id(order.id), 'reject', { comments: form.approvalComments }), 'LPO rejected')}>Confirm rejection</Action></>}
      </>}
    </>}

    {lpoQueue === 'management' && order && <>
      {(() => {
        const sourceRequisition = data.requisitions.find((row: Row) => id(row.id) === id(order.requisition))
        const financeStep = (Array.isArray(order.approval_steps) ? order.approval_steps as Row[] : []).find((step: Row) => /finance/i.test(id(step.stage_name)))
        return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, marginBottom: 12 }}>
          <ReadOnlyValue label="Source requisition" value={id(sourceRequisition?.source_store_requisition_no) || id(sourceRequisition?.requisition_number) || '—'} />
          <ReadOnlyValue label="Finance decision" value={id(financeStep?.status) === 'approved' ? `Approved by ${id(financeStep?.approver_name) || 'Financial Manager'}` : 'Finance review completed'} />
        </div>
      })()}
      <LpoSummary order={order} lines={lines} names={names} />
      {!canDecideManagement && <div style={{ padding: '10px 11px', borderRadius: 7, background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 11.3, fontWeight: 700 }}>Awaiting General Manager decision</div>}
      {canDecideManagement && <>
        <Action tone="good" disabled={busy || !currentApproval} onClick={() => run(async () => { const result = await runBackendAction('purchase-orders', id(order.id), 'approve', { comments: '' }); setLpoQueue('history'); return result }, 'Final LPO approval recorded', (result: unknown) => ({ order: id((result as Row).id) }))}>Approve LPO</Action>
        {!form.showReject ? <Action tone="danger" disabled={busy} onClick={() => setForm({ ...form, showReject: true })}>Reject LPO</Action> : <><Field label="Rejection reason *"><Input value={form.approvalComments || ''} onChange={(v) => setForm({ ...form, approvalComments: v })} /></Field><Action tone="danger" disabled={busy || !id(form.approvalComments).trim()} onClick={() => run(async () => { const result = await runBackendAction('purchase-orders', id(order.id), 'reject', { comments: form.approvalComments }); setLpoQueue('history'); return result }, 'LPO rejected', (result: unknown) => ({ order: id((result as Row).id) }))}>Confirm rejection</Action></>}
      </>}
    </>}

    {lpoQueue === 'approved' && order && canManage && <>
      <LpoSummary order={order} lines={lines} names={names} />
      <Action disabled={busy} onClick={() => run(() => downloadControlledPurchaseOrder(id(order.id)), `${id(order.next_print_classification) || 'Controlled'} LPO downloaded`, { ...form })}>Download {id(order.next_print_classification) || 'controlled'} LPO</Action>
      <ReadOnlyValue label="Supplier email" value={registeredSupplierEmail || 'No supplier email registered'} />
      <Action tone="good" disabled={busy || !registeredSupplierEmail} onClick={() => run(async () => { const result = await runBackendAction('purchase-orders', id(order.id), 'issue'); setLpoQueue('history'); return result }, 'LPO emailed to supplier and lead time started', (result: unknown) => ({ order: id((result as Row).id) }))}>Email LPO to Supplier</Action>
    </>}

    {lpoQueue === 'history' && order && <>
      {canManage && ['approved', 'issued', 'partially_received', 'received'].includes(id(order.status)) && <div style={{ marginBottom: 10, padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: 'var(--text)', fontWeight: 800, fontSize: 11.5 }}>{num(order.print_count) > 0 ? 'Controlled LPO copy available' : 'Original LPO still available'}</div>
            <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 10.5 }}>{num(order.print_count) > 0 ? `${id(order.print_count)} controlled print${num(order.print_count) === 1 ? '' : 's'} recorded.` : 'The supplier email did not consume the controlled ORIGINAL print.'}</div>
          </div>
          <Action disabled={busy} onClick={() => run(() => downloadControlledPurchaseOrder(id(order.id)), `${id(order.next_print_classification) || 'Controlled'} LPO downloaded`, { ...form })}>Download {id(order.next_print_classification) || 'controlled'} LPO</Action>
        </div>
      </div>}
      <LpoSummary order={order} lines={lines} names={names} />
      {role === 'general manager' ? (() => {
        const decision = managementApprovalStep(order)
        return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
          <ReadOnlyValue label="Final decision" value={id(decision?.status) ? id(decision?.status).replace(/_/g, ' ') : '—'} />
          <ReadOnlyValue label="Decided by" value={id(decision?.approver_name) || '—'} />
          <ReadOnlyValue label="Decision date" value={formatDateTime(decision?.decided_at)} />
          {id(decision?.comments) && <ReadOnlyValue label="Decision reason" value={id(decision?.comments)} />}
        </div>
      })() : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
        <ReadOnlyValue label="Supplier email" value={id(order.sent_to_email) || registeredSupplierEmail || '—'} />
        <ReadOnlyValue label="Sent at" value={formatDateTime(order.issued_at || order.sent_at)} />
        <ReadOnlyValue label="Expected delivery" value={id(order.expected_date) || '—'} />
        <ReadOnlyValue label="Status" value={friendlyLpoStatus(id(order.status), Array.isArray(order.approval_steps) ? order.approval_steps as Row[] : [])} />
      </div>}
    </>}
  </Panel>
}

function friendlyLpoStatus(status: string, steps: Row[]) { if (status === 'pending_approval') { const pending = steps.find((step) => id(step.status) === 'pending'); if (/finance/i.test(id(pending?.stage_name))) return 'Awaiting Finance'; if (/(general manager|management)/i.test(id(pending?.stage_name))) return 'Awaiting General Manager'; return 'Awaiting Approval' } if (status === 'approved') return 'Approved · Print & Send'; if (status === 'issued') return 'Sent to Supplier'; if (status === 'partially_received') return 'Partially Received'; if (status === 'received') return 'Fully Received'; return status.replace(/_/g, ' ') }

function LpoSummary({ order, lines, names }: { order: Row; lines: Row[]; names: Record<string, Map<string, string>> }) {
  const approvalSteps = Array.isArray(order.approval_steps) ? order.approval_steps as Row[] : []
  return <section style={{ margin: '10px 0 14px', overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, padding: 11, background: 'var(--surface-2)' }}>
      <ReadOnlyValue label="LPO number" value={id(order.lpo_number) || id(order.po_number)} />
      <ReadOnlyValue label="Supplier" value={names.suppliers.get(id(order.supplier)) || 'Inherited supplier'} />
      <ReadOnlyValue label="Status" value={friendlyLpoStatus(id(order.status), approvalSteps)} />
      <ReadOnlyValue label="LPO total" value={money(order.total_amount)} />
    </div>
    {approvalSteps.length > 0 && (() => {
      const firstPending = approvalSteps.findIndex((step) => id(step.status) === 'pending')
      return <div style={{ padding: '10px 11px', borderTop: '1px solid var(--border)' }}><div style={{ marginBottom: 7, color:'var(--text-faint)', fontSize:9.5, fontWeight:750, textTransform:'uppercase' }}>Approval timeline</div><div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>{approvalSteps.map((step, index) => {
        const rawStatus = id(step.status)
        const waiting = rawStatus === 'pending' && firstPending >= 0 && index > firstPending
        const displayStatus = waiting ? 'waiting' : rawStatus
        const tone = rawStatus === 'approved' ? 'good' : rawStatus === 'rejected' ? 'bad' : waiting ? 'muted' : 'warn'
        return <span key={`${id(step.stage_name)}-${id(step.stage)}`} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 8px', borderRadius:999, background:tone==='good'?'var(--good-soft)':tone==='bad'?'var(--bad-soft)':tone==='warn'?'var(--warn-soft)':'var(--surface-2)', color:tone==='good'?'var(--good)':tone==='bad'?'var(--bad)':tone==='warn'?'var(--warn)':'var(--text-muted)', fontSize:10, fontWeight:700 }}><Icon name={rawStatus==='approved'?'check_circle':rawStatus==='rejected'?'cancel':waiting?'hourglass_empty':'schedule'} size={13} />{id(step.stage_name)} · {displayStatus.replace(/_/g,' ')}</span>
      })}</div></div>
    })()}
    <div style={{ padding: '8px 11px', display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) .6fr .7fr .8fr', gap: 8, borderTop: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}><span>Article</span><span>Quantity</span><span>Unit price</span><span>Total</span></div>
    {lines.map((row) => <div key={id(row.id)} style={{ padding: '9px 11px', display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) .6fr .7fr .8fr', gap: 8, borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 10.8 }}><strong style={{ color: 'var(--text)' }}>{names.items.get(id(row.item)) || id(row.item)}</strong><span>{id(row.approved_quantity ?? row.quantity)}</span><span>{money(row.unit_cost)}</span><span>{money(num(row.approved_quantity ?? row.quantity) * num(row.unit_cost))}</span></div>)}
    {!lines.length && <div style={{ padding: 13, borderTop: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10.5 }}>No LPO items are available.</div>}
  </section>
}

function ReceiptPanel({ data, form, setForm, busy, run, orderLabel, receiptLabel, names, stores }: any) {
  const readyOrders = data.orders.filter((row: Row) => ['issued', 'partially_received'].includes(id(row.status)))
  const selectedOrder = readyOrders.find((row: Row) => id(row.id) === id(form.order))
  const receipt = data.receipts.find((row: Row) => id(row.id) === id(form.receipt))
  const orderId = id(receipt?.purchase_order || selectedOrder?.id)
  const lines = data.orderItems.filter((row: Row) => id(row.purchase_order) === orderId)
  const line = lines.find((row: Row) => id(row.id) === id(form.orderLine))
  const allPrevious = data.receiptItems.filter((row: Row) => id(row.purchase_order_item) === id(form.orderLine))
  const previouslyReceived = allPrevious.reduce((sum: number, row: Row) => sum + num(row.quantity_received), 0)
  const orderedQuantity = num(line?.approved_quantity ?? line?.quantity)
  const outstanding = Math.max(0, orderedQuantity - previouslyReceived)
  const receiptLines = data.receiptItems.filter((row: Row) => id(row.goods_receipt) === id(form.receipt))
  const duplicate = receiptLines.some((row: Row) => id(row.purchase_order_item) === id(form.orderLine))
  return <Panel title="Receiving & GRN" note="Select an issued LPO. Supplier, articles, destination and approved quantities are inherited; only the physical quantity received is entered.">
    <Field label="Ready LPO"><Select value={form.order} onChange={(v) => setForm({ order: v, receipt: '', orderLine: '', quantity: '' })} rows={readyOrders} label={orderLabel} /></Field>
    {!readyOrders.length && <Hint>Nothing is ready for Receiving yet. After final General Manager approval, Procurement must open “Approved · Print & Send” and email the LPO to the supplier. It will appear here when its status becomes issued.</Hint>}
    {selectedOrder && <Hint>This LPO is the receiving source document. Its approved quantities are never edited by Receiving.</Hint>}
    <Field label="Received date"><Input type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} /></Field>
    <Field label="Supplier invoice number"><Input value={form.invoiceNumber} onChange={(v) => setForm({ ...form, invoiceNumber: v })} /></Field>
    <Field label="Supplier delivery note"><Input value={form.deliveryNote} onChange={(v) => setForm({ ...form, deliveryNote: v })} /></Field>
    <Action disabled={busy || !form.order || !form.invoiceNumber} onClick={() => run(() => createBackendRecord('grns', { purchase_order: form.order, received_date: form.date || new Date().toISOString().slice(0, 10), delivery_note_no: form.deliveryNote || '', supplier_invoice_no: form.invoiceNumber, note: '' }), 'GRN opened from the issued LPO')}>Open GRN from LPO</Action>
    <Divider />
    <Field label="Draft / existing GRN"><Select value={form.receipt} onChange={(v) => { const found = data.receipts.find((row: Row) => id(row.id) === v); setForm({ receipt: v, order: found?.purchase_order || form.order }) }} rows={data.receipts.filter((row: Row) => readyOrders.some((order: Row) => id(order.id) === id(row.purchase_order)))} label={receiptLabel} /></Field>
    <Field label="LPO item"><Select value={form.orderLine} onChange={(v) => setForm({ ...form, orderLine: v, quantity: '' })} rows={lines} label={(row: Row) => `${names.items.get(id(row.item)) || id(row.item)} · approved ${row.approved_quantity ?? row.quantity}`} /></Field>
    {line && <section style={{ margin: '10px 0 12px', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
      <ReadOnlyValue label="LPO approved" value={orderedQuantity} />
      <ReadOnlyValue label="Previously received" value={previouslyReceived} />
      <ReadOnlyValue label="Outstanding" value={outstanding} />
    </section>}
    {line && <Hint>Destination: {line.destination_type === 'workspace' ? `Department · ${names.departments.get(id(line.destination_department)) || 'inherited'}` : names.stores.get(id(line.destination_store)) || stores.find((store: Row) => id(store.id) === id(line.destination_store))?.name || 'Inherited LPO store'} · read only.</Hint>}
    <Field label={`Quantity received now (${names.units.get(id(line?.unit)) || 'LPO unit'})`}><Input type="number" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} /></Field>
    {line && num(form.quantity) > outstanding && <Hint>Cannot receive more than the outstanding quantity of {outstanding}.</Hint>}
    {duplicate && <Hint>This LPO line is already on this GRN. Use a new GRN for a later partial delivery.</Hint>}
    <Action disabled={busy || duplicate || !form.receipt || !form.orderLine || num(form.quantity) <= 0 || num(form.quantity) > outstanding} onClick={() => run(() => createBackendRecord('grn-items', { goods_receipt: form.receipt, purchase_order_item: form.orderLine, quantity_received: num(form.quantity), expiry_date: null }), 'Received quantity recorded; original LPO quantity remains unchanged')}>Record received quantity</Action>
    {receiptLines.length > 0 && <Hint>Next: open “2. Confirm & post GRN” to record accepted/rejected quantities and post accepted stock. The LPO quantity remains unchanged.</Hint>}
  </Panel>
}

function ReadOnlyValue({ label, value }: { label: string; value: unknown }) {
  return <div style={{ padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)' }}><div style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 4, color: 'var(--text)', fontSize: 13, fontWeight: 800 }}>{id(value)}</div></div>
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

function StageTable({ stage, lpoQueue, data, names, role, onSelect }: { stage: Stage; lpoQueue: LpoQueue; data: Datasets; names: Record<string, Map<string, string>>; role: string; onSelect: (row: Row) => void }) {
  const requisitionNumber = (requisitionId: string) =>
    id(data.requisitions.find((record) => id(record.id) === requisitionId)?.requisition_number)
    || `R-${requisitionId.slice(0, 5).toUpperCase()}`

  if (stage === 'quote') {
    const requisitions = data.requisitions.filter((row) => {
      if (!['store_requisition','store_shortage'].includes(id(row.procurement_source)) || !['approved','partially_ordered'].includes(id(row.status))) return false
      const lines = data.requisitionItems.filter((line) => id(line.requisition) === id(row.id))
      return lines.some((line) => !line.procurement_supplier_price || num(line.procurement_quantity) <= 0 || num(line.procurement_unit_cost) <= 0)
    })
    return <div>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><strong style={{ fontSize: 12.8 }}>New Store Requisitions</strong><span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>{requisitions.length} pending</span></div>
      {requisitions.map((requisition) => {
        const lines = data.requisitionItems.filter((line) => id(line.requisition) === id(requisition.id))
        const allocated = lines.filter((line) => line.procurement_supplier_price && num(line.procurement_quantity) > 0 && num(line.procurement_unit_cost) > 0).length
        const preview = lines.slice(0, 2).map((line) => names.items.get(id(line.item)) || id(line.item)).join(', ')
        return <button key={id(requisition.id)} type="button" onClick={() => onSelect(requisition)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr .65fr 1.2fr auto', alignItems: 'center', gap: 12, padding: '13px 16px', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
          <span><strong style={{ display: 'block', color: 'var(--text)', fontSize: 12.2 }}>{id(requisition.source_store_requisition_no) || id(requisition.requisition_number)}</strong><small style={{ color: 'var(--text-muted)' }}>{names.departments.get(id(requisition.department)) || 'Department'} · {lines.length} item{lines.length === 1 ? '' : 's'}</small></span>
          <span style={{ color: allocated === lines.length ? 'var(--good)' : 'var(--warn)', fontSize: 10.8, fontWeight: 750 }}>{allocated}/{lines.length} allocated</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 11.2 }}>{preview}{lines.length > 2 ? ` +${lines.length - 2}` : ''}</span>
          <span style={{ color: 'var(--accent)', fontSize: 10.8, fontWeight: 800 }}>Review</span>
        </button>
      })}
      {!requisitions.length && <div style={{ padding: 42, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No new Store Requisitions are waiting for Procurement.</div>}
    </div>
  }

  if (stage === 'lpo' && lpoQueue === 'prepare') {
    const activeOrderRequisitions = new Set(data.orders.filter((row) => id(row.status) !== 'cancelled').map((row) => id(row.requisition)))
    const readyRequisitions = data.requisitions.filter((row) => {
      if (!['approved','partially_ordered'].includes(id(row.status)) || activeOrderRequisitions.has(id(row.id))) return false
      const lines = data.requisitionItems.filter((line) => id(line.requisition) === id(row.id))
      return Boolean(lines.length) && lines.every((line) => Boolean(line.procurement_supplier_price) && num(line.procurement_quantity) > 0 && num(line.procurement_unit_cost) > 0)
    })
    const drafts = data.orders.filter((row) => id(row.status) === 'draft')
    return <div>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><strong style={{ fontSize: 12.8 }}>LPO Preparation</strong><span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>{readyRequisitions.length + drafts.length} pending</span></div>
      {readyRequisitions.length > 0 && <div style={{ padding: '9px 16px 6px', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}>Ready to create LPO</div>}
      {readyRequisitions.map((requisition) => {
        const lines = data.requisitionItems.filter((line) => id(line.requisition) === id(requisition.id))
        const suppliers = new Set(lines.map((line) => id(line.procurement_supplier)).filter(Boolean)).size
        return <button key={id(requisition.id)} type="button" onClick={() => onSelect({ ...requisition, __workspace_kind: 'ready_requisition' })} style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr .7fr .7fr auto', gap: 12, alignItems: 'center', padding: '12px 16px', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}><strong style={{ color: 'var(--text)', fontSize: 12 }}>{id(requisition.source_store_requisition_no) || id(requisition.requisition_number)}</strong><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{lines.length} items</span><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{suppliers || 1} supplier{suppliers === 1 ? '' : 's'}</span><span style={{ color: 'var(--accent)', fontSize: 10.8, fontWeight: 800 }}>Prepare</span></button>
      })}
      {drafts.length > 0 && <div style={{ padding: '11px 16px 6px', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}>Draft LPOs</div>}
      {drafts.map((row) => <button type="button" key={id(row.id)} onClick={() => onSelect(row)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1.3fr .8fr auto', gap: 12, alignItems: 'center', padding: '12px 16px', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}><strong style={{ color: 'var(--text)', fontSize: 12 }}>LPO {id(row.lpo_number) || id(row.po_number)}</strong><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{names.suppliers.get(id(row.supplier)) || id(row.supplier)}</span><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{money(row.total_amount)}</span><span style={{ color: 'var(--accent)', fontSize: 10.8, fontWeight: 800 }}>Review</span></button>)}
      {!readyRequisitions.length && !drafts.length && <div style={{ padding: 42, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No requisition is ready for LPO preparation. Complete supplier allocation under New Store Requisitions first.</div>}
    </div>
  }

  let rows: Row[] = []
  let title = ''
  if (stage === 'request') { rows = data.requisitionItems; title = 'Requisition lines' }
  if (stage === 'lpo') {
    if (lpoQueue === 'finance') { rows = Array.isArray(data.approvalQueueOrders) ? data.approvalQueueOrders : data.orders.filter((row) => id(row.status) === 'pending_approval' && isFinanceApproval(row)); title = 'Awaiting Finance' }
    if (lpoQueue === 'management') { rows = Array.isArray(data.approvalQueueOrders) ? data.approvalQueueOrders : data.orders.filter((row) => id(row.status) === 'pending_approval' && isManagementApproval(row)); title = 'Awaiting General Manager' }
    if (lpoQueue === 'approved') { rows = data.orders.filter((row) => id(row.status) === 'approved'); title = 'Approved to Send' }
    if (lpoQueue === 'history') { rows = role === 'general manager' ? (Array.isArray(data.decisionHistoryOrders) ? data.decisionHistoryOrders : data.orders.filter((row) => hasManagementDecision(row))) : data.orders.filter((row) => ['issued', 'partially_received', 'received', 'rejected', 'cancelled'].includes(id(row.status))); title = role === 'general manager' ? 'Decision History' : 'LPO History' }
  }
  if (stage === 'receipt') { rows = data.receipts; title = 'Goods receipt notes' }
  if (stage === 'inspect') { rows = data.inspections; title = 'Inspection records' }
  if (stage === 'return') { rows = data.returns; title = 'Supplier returns' }

  const cells = (row: Row): string[] => {
    if (stage === 'request') return [requisitionNumber(id(row.requisition)), names.items.get(id(row.item)) || id(row.item), id(row.quantity), money(row.estimated_total)]
    if (stage === 'lpo') {
      const finalDecision = role === 'general manager' && lpoQueue === 'history' ? managementApprovalStep(row) : undefined
      const decisionLabel = finalDecision ? `Final ${id(finalDecision.status).replace(/_/g, ' ')}` : friendlyLpoStatus(id(row.status), Array.isArray(row.approval_steps) ? row.approval_steps as Row[] : [])
      return [`LPO ${id(row.lpo_number) || id(row.po_number)}`, names.suppliers.get(id(row.supplier)) || id(row.supplier), money(row.total_amount), decisionLabel]
    }
    if (stage === 'receipt') return [id(row.grn_number) || `GRN-${id(row.id).slice(0, 8)}`, id(row.received_date), names.employees.get(id(row.received_by)) || id(row.received_by), `${data.receiptItems.filter((line) => id(line.goods_receipt) === id(row.id)).length} lines`]
    if (stage === 'inspect') return [`INS-${id(row.id).slice(0, 8)}`, `GRN-${id(row.goods_receipt).slice(0, 8)}`, names.employees.get(id(row.inspected_by)) || id(row.inspected_by), id(row.status)]
    return [id(row.return_no), names.suppliers.get(id(row.supplier)) || id(row.supplier), id(row.return_date), id(row.status)]
  }
  return <><div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong style={{ fontSize: 12.8 }}>{title}</strong><span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>{rows.length} record{rows.length === 1 ? '' : 's'}</span></div>
    {rows.map((row) => <button type="button" key={id(row.id)} onClick={() => onSelect(row)} className="procurement-record-row" style={{ width: '100%', display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1fr .9fr 24px', alignItems: 'center', gap: 12, padding: '12px 16px', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 12 }}>{cells(row).map((cell, i) => <span key={i} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: i === 0 ? 'var(--text)' : 'var(--text-muted)', fontWeight: i === 0 ? 750 : 500 }}>{cell || '—'}</span>)}<Icon name="chevron_right" size={17} color="var(--text-faint)" /></button>)}
    {!rows.length && <div style={{ padding: 42, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}><div style={{ color: 'var(--text)', fontWeight: 750 }}>{role === 'general manager' && lpoQueue === 'management' ? 'No LPOs need your decision' : 'No records in this queue.'}</div>{role === 'general manager' && lpoQueue === 'management' && <div style={{ marginTop: 5 }}>Finance-approved LPOs will appear here automatically.</div>}</div>}
  </>
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
      : stage === 'lpo' ? id(row.lpo_number) || id(row.po_number) || id(row.id)
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
    ['LPO number', id(row.lpo_number)],
    ['PO number', id(row.po_number)],
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
    ['LPO', id(data.orders.find((order) => id(order.id) === id(row.purchase_order))?.lpo_number) || id(row.purchase_order)],
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

function floorPurchaseQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor((value + Number.EPSILON) * 100) / 100
}

function QuoteConversionNote({ orderQuantity, factor, quotedUnit, baseUnit, quotedPrice, basePrice }: { orderQuantity: number; factor: number; quotedUnit: string; baseUnit: string; quotedPrice: number; basePrice: number }) {
  if (factor <= 0) return <Hint>This supplier quotation UOM has no active conversion for the selected Article.</Hint>
  return <div style={{ marginBottom: 11, padding: 10, border: '1px solid var(--accent)', borderRadius: 6, color: 'var(--text)', background: 'var(--accent-soft)', fontSize: 10.5, lineHeight: 1.55 }}>
    <strong>LPO quantity:</strong> {orderQuantity || 0} {baseUnit}.
    {factor !== 1 && <> Supplier quotation basis: 1 {quotedUnit} = {factor} {baseUnit}. </>}
    {quotedPrice > 0 && <>Quoted price: <strong>{money(quotedPrice)} per {quotedUnit}</strong>{factor !== 1 && <> = <strong>{money(basePrice)} per {baseUnit}</strong></>}.</>}
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
function SectionLabel({ children }: { children: ReactNode }) { return <div style={{ margin: '2px 0 10px', color: 'var(--text)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</div> }
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
