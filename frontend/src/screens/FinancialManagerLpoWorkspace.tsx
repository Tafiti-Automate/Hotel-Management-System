import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { errorMessage, readBackendPayload, runBackendAction } from '../lib/api'
import type { Row } from '../lib/data'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

type FinanceTab = 'pending' | 'reviewed'

type FinanceWorkspaceData = {
  requisitions: Row[]
  orders: Row[]
  orderItems: Row[]
  approvalQueueOrders: Row[]
}

const emptyData: FinanceWorkspaceData = {
  requisitions: [],
  orders: [],
  orderItems: [],
  approvalQueueOrders: [],
}

const id = (value: unknown) => String(value ?? '')
const num = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function financeStep(order: Row): Row | undefined {
  const steps = Array.isArray(order.approval_steps) ? order.approval_steps as Row[] : []
  return steps.find((step) => /finance/i.test(id(step.stage_name)) || Number(step.stage) === 2)
}

function purchasingStep(order: Row): Row | undefined {
  const steps = Array.isArray(order.approval_steps) ? order.approval_steps as Row[] : []
  return steps.find((step) => /(purchasing|procurement)/i.test(id(step.stage_name)) || Number(step.stage) === 1)
}

function upstreamQuantity(line: Row): number {
  return num(line.purchasing_approved_quantity ?? line.procurement_quantity ?? line.quantity)
}

function financeQuantity(line: Row): number {
  return num(line.finance_approved_quantity ?? upstreamQuantity(line))
}

function formatDateTime(value: unknown): string {
  const raw = id(value).trim()
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('en-UG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(order: Row): string {
  const step = financeStep(order)
  if (id(step?.status) === 'approved') return 'Finance approved'
  if (id(step?.status) === 'rejected') return 'Finance rejected'
  if (id(order.status) === 'pending_approval') return 'Awaiting Finance'
  return id(order.status).replace(/_/g, ' ') || '—'
}

export default function FinancialManagerLpoWorkspace() {
  const app = useApp()
  const [data, setData] = useState<FinanceWorkspaceData>(emptyData)
  const [tab, setTab] = useState<FinanceTab>('pending')
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [rejectReason, setRejectReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await readBackendPayload(
        'requisitions/workspace?stage=lpo&approval_role=Financial%20Manager',
      )
      setData({
        requisitions: Array.isArray(payload.requisitions) ? payload.requisitions : [],
        orders: Array.isArray(payload.orders) ? payload.orders : [],
        orderItems: Array.isArray(payload.orderItems) ? payload.orderItems : [],
        approvalQueueOrders: Array.isArray(payload.approvalQueueOrders) ? payload.approvalQueueOrders : [],
      })
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Financial approval queue unavailable', detail)
    } finally {
      setLoading(false)
    }
  }, [app.showWorkflowAlert])

  useEffect(() => { void load() }, [load])

  const reviewedOrders = useMemo(
    () => data.orders
      .filter((order) => ['approved', 'rejected'].includes(id(financeStep(order)?.status)))
      .sort((left, right) => id(right.updated_at).localeCompare(id(left.updated_at))),
    [data.orders],
  )

  const pendingOrders = data.approvalQueueOrders
  const visibleOrders = tab === 'pending' ? pendingOrders : reviewedOrders
  const selectedOrder = data.orders.find((order) => id(order.id) === selectedOrderId)
    || visibleOrders.find((order) => id(order.id) === selectedOrderId)
  const selectedLines = selectedOrder
    ? data.orderItems.filter((line) => id(line.purchase_order) === id(selectedOrder.id))
    : []
  const selectedRequisition = selectedOrder
    ? data.requisitions.find((row) => id(row.id) === id(selectedOrder.requisition))
    : undefined

  const supplierNames = useMemo(
    () => new Map(app.data.suppliers.map((row) => [id(row.id), id(row.name)])),
    [app.data.suppliers],
  )
  const itemNames = useMemo(
    () => new Map(app.data.items.map((row) => [id(row.id), id(row.name)])),
    [app.data.items],
  )
  const unitNames = useMemo(
    () => new Map(app.data.uoms.map((row) => [id(row.id), id(row.name || row.abbr)])),
    [app.data.uoms],
  )

  useEffect(() => {
    if (!selectedOrder || tab !== 'pending') {
      setQuantities({})
      setReasons({})
      setRejectReason('')
      return
    }
    const nextQuantities: Record<string, string> = {}
    const nextReasons: Record<string, string> = {}
    selectedLines.forEach((line) => {
      nextQuantities[id(line.id)] = String(financeQuantity(line))
      nextReasons[id(line.id)] = id(line.finance_reduction_reason)
    })
    setQuantities(nextQuantities)
    setReasons(nextReasons)
    setRejectReason('')
  }, [selectedOrderId, tab, data.orderItems])

  useEffect(() => {
    if (selectedOrderId && visibleOrders.some((order) => id(order.id) === selectedOrderId)) return
    setSelectedOrderId(visibleOrders.length ? id(visibleOrders[0].id) : '')
  }, [selectedOrderId, visibleOrders])

  const invalidLines = selectedLines.filter((line) => {
    const maximum = upstreamQuantity(line)
    const entered = num(quantities[id(line.id)] ?? financeQuantity(line))
    const reduced = entered < maximum
    return entered < 0 || entered > maximum || (reduced && !id(reasons[id(line.id)]).trim())
  })

  const pendingValue = pendingOrders.reduce((total, order) => total + num(order.total_amount), 0)
  const approvedCount = reviewedOrders.filter((order) => id(financeStep(order)?.status) === 'approved').length
  const rejectedCount = reviewedOrders.filter((order) => id(financeStep(order)?.status) === 'rejected').length

  const refreshAfterDecision = async (orderId: string, message: string) => {
    await load()
    await Promise.resolve(app.refreshData())
    setTab('reviewed')
    setSelectedOrderId(orderId)
    app.showToast(message)
  }

  const approveSelected = async () => {
    if (!selectedOrder || !selectedLines.length || invalidLines.length) return
    setBusy(true)
    setError('')
    try {
      const lines = selectedLines.map((line) => ({
        id: id(line.id),
        approved_quantity: num(quantities[id(line.id)] ?? financeQuantity(line)),
        reason: id(reasons[id(line.id)]).trim(),
      }))
      await runBackendAction('purchase-orders', id(selectedOrder.id), 'review-quantities', { lines })
      await runBackendAction('purchase-orders', id(selectedOrder.id), 'approve', {
        comments: 'Financial Manager approval completed.',
      })
      await refreshAfterDecision(id(selectedOrder.id), 'LPO approved and sent to General Manager')
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Financial approval could not be completed', detail)
    } finally {
      setBusy(false)
    }
  }

  const rejectSelected = async () => {
    if (!selectedOrder || !rejectReason.trim()) return
    setBusy(true)
    setError('')
    try {
      await runBackendAction('purchase-orders', id(selectedOrder.id), 'reject', {
        comments: rejectReason.trim(),
      })
      await refreshAfterDecision(id(selectedOrder.id), 'LPO rejected by Financial Manager')
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('LPO rejection could not be completed', detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="enterprise-workspace finance-lpo-workspace" style={{ maxWidth: 1480, margin: '0 auto' }}>
      <header className="workbench-hero finance-lpo-hero" style={{ ...card, padding: 20, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={heroIcon}><Icon name="account_balance_wallet" size={23} color="#fff" /></span>
        <div style={{ flex: '1 1 280px' }}>
          <div style={eyebrow}>Financial control</div>
          <h1 style={{ margin: '3px 0', color: 'var(--text)', fontSize: 24 }}>Level 2 · LPO Approval</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12.5 }}>
            Review purchasing-approved quantities and value. Finance may retain or reduce a quantity, never increase it.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || busy} style={secondaryButton}>
          <Icon name="refresh" size={17} />{loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <section className="workbench-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
        <Metric label="Awaiting Finance" value={String(pendingOrders.length)} icon="approval" tone="warn" />
        <Metric label="Pending value" value={money(pendingValue)} icon="payments" />
        <Metric label="Finance approved" value={String(approvedCount)} icon="check_circle" tone="good" />
        <Metric label="Finance rejected" value={String(rejectedCount)} icon="cancel" tone="bad" />
      </section>

      <div className="procurement-queue-tabs" style={{ ...card, padding: 7, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(150px,230px))', gap: 7 }}>
        <TabButton active={tab === 'pending'} label="Pending review" count={pendingOrders.length} onClick={() => { setTab('pending'); setSelectedOrderId('') }} />
        <TabButton active={tab === 'reviewed'} label="Reviewed / history" count={reviewedOrders.length} onClick={() => { setTab('reviewed'); setSelectedOrderId('') }} />
      </div>

      {error && <div style={{ ...card, marginBottom: 14, padding: 12, borderColor: 'rgba(214,69,93,.34)', color: 'var(--bad)', fontSize: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ ...card, padding: 54, textAlign: 'center', color: 'var(--text-muted)' }}>Loading Financial Manager LPOs…</div>
      ) : (
        <div className="workbench-grid procurement-workbench-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(330px,.78fr) minmax(520px,1.22fr)', gap: 14, alignItems: 'start' }}>
          <section style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '13px 15px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <strong style={{ color: 'var(--text)', fontSize: 12.5 }}>{tab === 'pending' ? 'LPOs awaiting your decision' : 'Your Finance decisions'}</strong>
              <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>{visibleOrders.length} record{visibleOrders.length === 1 ? '' : 's'}</span>
            </div>
            {visibleOrders.map((order) => {
              const active = id(order.id) === selectedOrderId
              const supplier = supplierNames.get(id(order.supplier)) || `Supplier ${id(order.supplier).slice(0, 8)}`
              return <button
                key={id(order.id)}
                type="button"
                onClick={() => setSelectedOrderId(id(order.id))}
                style={{
                  width: '100%',
                  border: 0,
                  borderTop: '1px solid var(--border)',
                  borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                  padding: '13px 14px',
                  background: active ? 'var(--accent-soft)' : 'var(--surface)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <strong style={{ color: 'var(--text)', fontSize: 12.4 }}>LPO {id(order.lpo_number || order.po_number || order.id).slice(0, 18)}</strong>
                  <span style={{ color: tab === 'pending' ? 'var(--warn)' : id(financeStep(order)?.status) === 'approved' ? 'var(--good)' : 'var(--bad)', fontSize: 9.8, fontWeight: 800 }}>{statusLabel(order)}</span>
                </div>
                <div style={{ marginTop: 5, color: 'var(--text-muted)', fontSize: 11.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{supplier}</div>
                <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ color: 'var(--text)', fontSize: 12 }}>{money(order.total_amount)}</strong>
                  <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>{formatDateTime(order.submitted_for_approval_at || order.created_at)}</span>
                </div>
              </button>
            })}
            {!visibleOrders.length && <EmptyState tab={tab} />}
          </section>

          <section style={{ ...card, padding: 18, minWidth: 0 }}>
            {!selectedOrder ? <div style={{ padding: '52px 18px', textAlign: 'center', color: 'var(--text-muted)' }}><Icon name="receipt_long" size={30} /><div style={{ marginTop: 8 }}>Select an LPO to review.</div></div> : <>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                <div>
                  <div style={eyebrow}>{tab === 'pending' ? 'Finance review' : 'Finance history'}</div>
                  <h2 style={{ margin: '4px 0 2px', color: 'var(--text)', fontSize: 19 }}>LPO {id(selectedOrder.lpo_number || selectedOrder.po_number || selectedOrder.id)}</h2>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{supplierNames.get(id(selectedOrder.supplier)) || 'Registered supplier'}</div>
                </div>
                <span style={statusChip(tab === 'pending' ? 'warn' : id(financeStep(selectedOrder)?.status) === 'approved' ? 'good' : 'bad')}>{statusLabel(selectedOrder)}</span>
              </div>

              <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
                <ReadOnly label="Source request" value={id(selectedRequisition?.source_store_requisition_no || selectedRequisition?.requisition_number) || '—'} />
                <ReadOnly label="Purchasing decision" value={id(purchasingStep(selectedOrder)?.status).replace(/_/g, ' ') || 'Approved'} />
                <ReadOnly label="Current LPO value" value={money(selectedOrder.total_amount)} />
                <ReadOnly label="Submitted" value={formatDateTime(selectedOrder.submitted_for_approval_at)} />
              </div>

              <div className="data-table" style={{ border: '1px solid var(--border)', borderRadius: 9, overflowX: 'auto' }}>
                <div className="finance-lpo-line-grid" style={{ minWidth: 690, display: 'grid', gridTemplateColumns: 'minmax(160px,1.35fr) .65fr .75fr .72fr .8fr', gap: 8, padding: '9px 10px', background: 'var(--surface-2)', color: 'var(--text-faint)', fontSize: 9.3, fontWeight: 800, textTransform: 'uppercase' }}>
                  <span>Article</span><span>Purchasing qty</span><span>Finance qty</span><span>Unit price</span><span>Finance amount</span>
                </div>
                {selectedLines.map((line) => {
                  const lineId = id(line.id)
                  const upstream = upstreamQuantity(line)
                  const entered = tab === 'pending' ? num(quantities[lineId] ?? upstream) : financeQuantity(line)
                  const reduced = entered < upstream
                  const invalid = entered < 0 || entered > upstream
                  return <div key={lineId} style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="finance-lpo-line-grid" style={{ minWidth: 690, display: 'grid', gridTemplateColumns: 'minmax(160px,1.35fr) .65fr .75fr .72fr .8fr', gap: 8, alignItems: 'center', padding: '10px', fontSize: 11.2 }}>
                      <strong style={{ color: 'var(--text)' }}>{itemNames.get(id(line.item)) || `Article ${id(line.item).slice(0, 8)}`}</strong>
                      <span style={{ color: 'var(--text-muted)' }}>{upstream} {unitNames.get(id(line.unit)) || ''}</span>
                      {tab === 'pending' ? <input
                        type="number"
                        min="0"
                        max={upstream}
                        step="0.01"
                        value={quantities[lineId] ?? String(upstream)}
                        onChange={(event) => setQuantities((current) => ({ ...current, [lineId]: event.target.value }))}
                        style={{ ...control, height: 36, minWidth: 0, borderColor: invalid ? 'var(--bad)' : 'var(--border)' }}
                        aria-label={`Finance approved quantity for ${itemNames.get(id(line.item)) || id(line.item)}`}
                      /> : <strong style={{ color: 'var(--text)' }}>{entered}</strong>}
                      <span style={{ color: 'var(--text-muted)' }}>{money(line.unit_cost)}</span>
                      <strong style={{ color: 'var(--text)' }}>{money(entered * num(line.unit_cost))}</strong>
                    </div>
                    {tab === 'pending' && (reduced || invalid) && <div style={{ padding: '0 10px 10px' }}>
                      {invalid ? <div style={{ color: 'var(--bad)', fontSize: 10.4 }}>Finance cannot increase this quantity above {upstream}.</div> : <input
                        value={reasons[lineId] || ''}
                        onChange={(event) => setReasons((current) => ({ ...current, [lineId]: event.target.value }))}
                        placeholder="Reason for reduction *"
                        style={{ ...control, width: '100%' }}
                      />}
                    </div>}
                    {tab === 'reviewed' && id(line.finance_reduction_reason) && <div style={{ padding: '0 10px 10px', color: 'var(--text-muted)', fontSize: 10.5 }}>Finance reduction reason: {id(line.finance_reduction_reason)}</div>}
                  </div>
                })}
                {!selectedLines.length && <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 11 }}>No LPO lines are available.</div>}
              </div>

              {tab === 'pending' ? <>
                <div style={{ marginTop: 12, padding: '10px 11px', borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--text-muted)', fontSize: 10.8, lineHeight: 1.45 }}>
                  Quantity control is monotonic: Finance may retain the Purchasing Manager quantity or reduce it. Any increase is blocked by both this screen and the backend.
                </div>
                <div className="form-grid" style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) auto auto', gap: 8, alignItems: 'end' }}>
                  <label style={{ display: 'grid', gap: 5 }}>
                    <span style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}>Full rejection reason</span>
                    <input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Required only when rejecting the whole LPO" style={control} />
                  </label>
                  <button type="button" disabled={busy || !rejectReason.trim()} onClick={() => void rejectSelected()} style={{ ...dangerButton, opacity: busy || !rejectReason.trim() ? .5 : 1 }}>Reject LPO</button>
                  <button type="button" disabled={busy || !selectedLines.length || invalidLines.length > 0} onClick={() => void approveSelected()} style={{ ...primaryButton, opacity: busy || !selectedLines.length || invalidLines.length > 0 ? .5 : 1 }}><Icon name="check" size={16} color="#fff" />Approve & send to GM</button>
                </div>
              </> : <FinanceDecisionSummary order={selectedOrder} />}
            </>}
          </section>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, icon, tone = 'accent' }: { label: string; value: string; icon: string; tone?: 'accent' | 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--accent)'
  return <div style={{ ...card, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'var(--surface-2)', color }}><Icon name={icon} size={18} /></span><div><div style={{ color: 'var(--text-faint)', fontSize: 9.2, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div><strong style={{ display: 'block', marginTop: 3, color: 'var(--text)', fontSize: 15 }}>{value}</strong></div></div>
}

function TabButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ padding: '10px 12px', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: active ? 'var(--accent-soft)' : 'var(--surface)', color: active ? 'var(--accent)' : 'var(--text)', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}><strong style={{ display: 'block', fontSize: 11.4 }}>{label}</strong><span style={{ display: 'block', marginTop: 3, fontSize: 17, fontWeight: 850 }}>{count}</span></button>
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return <div style={{ minWidth: 0, padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}><div style={{ color: 'var(--text-faint)', fontSize: 8.8, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 4, color: 'var(--text)', fontSize: 11.2, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div></div>
}

function FinanceDecisionSummary({ order }: { order: Row }) {
  const step = financeStep(order)
  return <div className="detail-grid" style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
    <ReadOnly label="Finance decision" value={id(step?.status).replace(/_/g, ' ') || '—'} />
    <ReadOnly label="Decided by" value={id(step?.approver_name) || 'Financial Manager'} />
    <ReadOnly label="Decision time" value={formatDateTime(step?.decided_at)} />
    {id(step?.comments) && <div style={{ gridColumn: '1 / -1' }}><ReadOnly label="Comments" value={id(step?.comments)} /></div>}
  </div>
}

function EmptyState({ tab }: { tab: FinanceTab }) {
  return <div style={{ padding: '48px 18px', textAlign: 'center' }}><Icon name={tab === 'pending' ? 'task_alt' : 'history'} size={28} color="var(--text-faint)" /><div style={{ marginTop: 8, color: 'var(--text)', fontWeight: 750 }}>{tab === 'pending' ? 'No LPOs awaiting Finance' : 'No Finance decisions yet'}</div><div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11 }}>{tab === 'pending' ? 'New Level 1 approvals will remain visible here until you decide them.' : 'Approved and rejected LPOs will remain available here for review.'}</div></div>
}

function statusChip(tone: 'good' | 'warn' | 'bad'): CSSProperties {
  const color = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--warn)'
  return { padding: '6px 9px', borderRadius: 999, background: 'var(--surface-2)', color, fontSize: 10, fontWeight: 800 }
}

const card: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-sm)',
}

const heroIcon: CSSProperties = {
  width: 42,
  height: 42,
  display: 'grid',
  placeItems: 'center',
  flex: '0 0 42px',
  borderRadius: 10,
  background: 'linear-gradient(145deg,var(--accent),#1f5fd6)',
}

const eyebrow: CSSProperties = {
  color: 'var(--accent)',
  fontSize: 9.2,
  fontWeight: 850,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
}

const control: CSSProperties = {
  minHeight: 38,
  padding: '0 10px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 11.5,
  outline: 'none',
}

const secondaryButton: CSSProperties = {
  minHeight: 38,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 12px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 11,
  fontWeight: 750,
  cursor: 'pointer',
}

const primaryButton: CSSProperties = {
  ...secondaryButton,
  borderColor: 'var(--accent)',
  background: 'var(--accent)',
  color: '#fff',
}

const dangerButton: CSSProperties = {
  ...secondaryButton,
  borderColor: 'var(--bad)',
  color: 'var(--bad)',
}
