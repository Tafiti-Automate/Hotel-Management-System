import { useState, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import LpoPreviewModal from '../components/LpoPreviewModal'
import type { Line } from '../lib/data'
import { chipStyleFor, money } from '../lib/theme'

const lineGrid = 'minmax(0,1.8fr) 80px 70px 100px 110px'

const fieldLabel: CSSProperties = { fontSize: 12, color: 'var(--text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }
const fieldValue: CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }
const lineHead: CSSProperties = { padding: '9px 12px', fontSize: 12, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }

export default function DetailView() {
  const app = useApp()
  const [decisionComment, setDecisionComment] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const d = app.detail
  if (!d) return null
  const r = app.data[d.entity].find((x) => x.id === d.id)
  if (!r) return null

  const isReq = d.entity === 'requisitions'
  const kind = isReq ? 'Requisition' : 'Purchase Order'
  const lines: Line[] = r.lines || []
  const approvalSteps: Array<Record<string, any>> = r.approvalSteps || []
  const awaitingApproval = r.awaitingApproval
  const isPending = isReq && r.status === 'Pending'
  const decided = isReq && (r.status === 'Approved' || r.status === 'Rejected')
  const canDecide = Boolean(r.approvalActionable) && (
    app.user.isSuperuser || app.user.permissions.includes('approvals.change_approvalworkflow')
  )
  const prerequisites = isReq ? [
    { label: 'At least one Article has been added', met: lines.length > 0 },
    { label: 'Every line has a positive quantity', met: lines.length > 0 && lines.every((line) => Number(line.qty) > 0) },
    { label: 'Estimated prices and total are available', met: Number(r.total || 0) > 0 },
    { label: 'Department and requester are assigned', met: Boolean(r.dept && r.requester) },
    { label: 'Requisition has reached an approval stage', met: r.status === 'Pending' || decided },
  ] : [
    { label: 'Purchase order contains at least one Article', met: lines.length > 0 },
    { label: 'Supplier is assigned', met: Boolean(r.supplier) },
    { label: 'Order has a positive value', met: Number(r.total || 0) > 0 },
  ]
  const blockers = prerequisites.filter((item) => !item.met)
  const guardedApprove = () => {
    if (blockers.length) {
      app.showWorkflowAlert('Approval prerequisites are incomplete', blockers.map((item) => item.label).join('. '), 'warning')
      return
    }
    app.approveReq(decisionComment)
  }
  const guardedDecision = (decision: 'reject' | 'return') => {
    if (!decisionComment.trim()) {
      app.showWorkflowAlert(
        decision === 'reject' ? 'Rejection reason required' : 'Correction instructions required',
        'Add a clear comment so the requester knows why the requisition cannot continue.',
        'warning',
      )
      return
    }
    if (decision === 'reject') app.rejectReq(decisionComment)
    else app.returnReq(decisionComment)
  }

  const f1label = isReq ? 'Department' : 'Supplier'
  const f1 = isReq ? r.dept : r.supplier
  const f2label = isReq ? 'Requested by' : 'Ordered by'
  const f2 = isReq ? r.requester : 'Procurement'

  return (
    <div>
      <button onClick={app.backFromDetail} className="hover-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0', marginBottom: 14 }}>
        <Icon name="arrow_back" size={19} />Back
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 'var(--gap)', alignItems: 'start' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{kind}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '-.01em', marginTop: 3 }}>{r.id}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {!isReq && <button type="button" onClick={() => setPreviewOpen(true)} style={{ height: 36, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 12px', border: '1px solid var(--accent)', borderRadius: 7, background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 750 }}><Icon name="visibility" size={18} />View LPO</button>}
              <span style={chipStyleFor(r.status)}>{r.status}</span>
            </div>
          </div>
          {isReq && awaitingApproval && (
            <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--border)', background: 'var(--accent-soft)', color: 'var(--text)', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="schedule" size={17} color="var(--accent)" />
              Waiting for <strong>{awaitingApproval.approverName}</strong> to complete {awaitingApproval.stageName}.
            </div>
          )}

          <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 16, borderBottom: '1px solid var(--border)' }}>
            {isReq && <div><div style={fieldLabel}>Source</div><div style={fieldValue}>{r.sourceLabel || 'Manual procurement'}</div></div>}
            <div><div style={fieldLabel}>{f1label}</div><div style={fieldValue}>{f1}</div></div>
            <div><div style={fieldLabel}>{f2label}</div><div style={fieldValue}>{f2}</div></div>
            <div><div style={fieldLabel}>Date</div><div style={fieldValue}>{r.date}</div></div>
            <div><div style={fieldLabel}>Total</div><div style={{ ...fieldValue, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>{money(r.total)}</div></div>
          </div>

          <div style={{ padding: '18px 22px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 12 }}>Line items</div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: lineGrid, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <div style={lineHead}>Item</div>
                <div style={{ ...lineHead, textAlign: 'right' }}>Qty</div>
                <div style={lineHead}>UoM</div>
                <div style={{ ...lineHead, textAlign: 'right' }}>Unit cost</div>
                <div style={{ ...lineHead, textAlign: 'right' }}>Line total</div>
              </div>
              {lines.map((ln, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: lineGrid, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ padding: '11px 12px', fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{ln.item}</div>
                  <div style={{ padding: '11px 12px', fontSize: 12.5, color: 'var(--text)', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{ln.qty}</div>
                  <div style={{ padding: '11px 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>{ln.uom}</div>
                  <div style={{ padding: '11px 12px', fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{money(ln.unitCost)}</div>
                  <div style={{ padding: '11px 12px', fontSize: 12.5, color: 'var(--text)', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{money(ln.qty * ln.unitCost)}</div>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 18, padding: '12px', background: 'var(--surface-2)' }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>Grand total</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: "'JetBrains Mono',monospace" }}>{money(r.total)}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
          {blockers.length > 0 && <div style={{ background: 'var(--surface)', border: '1px solid rgba(217,119,6,.35)', borderRadius: 8, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
            <div style={{ padding: '13px 15px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="warning" size={18} color="var(--warn)" />
              <div><div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 650 }}>Operation readiness</div><div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>{blockers.length} requirement{blockers.length === 1 ? '' : 's'} outstanding</div></div>
            </div>
            <div style={{ padding: '8px 15px' }}>{prerequisites.filter((item) => !item.met).map((item) => <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', color: 'var(--text)', fontSize: 12 }}><Icon name="radio_button_unchecked" size={16} color="var(--warn)" />{item.label}</div>)}</div>
          </div>}

          {isPending && canDecide && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-sm)', padding: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Approval decision</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>Review the requisition and record your decision. Comments are retained in the audit history.</div>
              <textarea value={decisionComment} onChange={(event) => setDecisionComment(event.target.value)} placeholder="Decision comment…" style={{ width: '100%', height: 74, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: 10, fontSize: 12.5, color: 'var(--text)', outline: 'none', resize: 'none', marginBottom: 12 }} />
              <button onClick={guardedApprove} className="hover-bright" style={{ width: '100%', height: 42, border: 'none', cursor: blockers.length ? 'not-allowed' : 'pointer', opacity: blockers.length ? .6 : 1, background: 'var(--good)', color: '#fff', borderRadius: 6, font: 'inherit', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 9 }}>
                <Icon name="check_circle" size={19} />Approve
              </button>
              <button onClick={() => guardedDecision('return')} className="hover-surface2" style={{ width: '100%', height: 42, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--warn)', borderRadius: 11, font: 'inherit', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 9 }}>
                <Icon name="assignment_return" size={19} />Return for correction
              </button>
              <button onClick={() => guardedDecision('reject')} className="hover-reject" style={{ width: '100%', height: 42, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--bad)', borderRadius: 11, font: 'inherit', fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Icon name="cancel" size={19} />Reject
              </button>
            </div>
          )}

          {decided && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)', padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name={r.status === 'Approved' ? 'check_circle' : 'cancel'} size={24} color={r.status === 'Approved' ? 'var(--good)' : 'var(--bad)'} />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>Requisition {r.status.toLowerCase()}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Decision recorded by {app.user.role}</div>
                </div>
              </div>
            </div>
          )}

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-sm)', padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 14 }}>Approval route</div>
            {!approvalSteps.length && (
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{ background: 'var(--surface-2)', width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name="edit_note" size={16} color="var(--text-faint)" /></span>
                <div><div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 650 }}>Draft preparation</div><div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>Approval route is assigned when submitted</div></div>
              </div>
            )}
            {approvalSteps.map((approval, index) => {
              const complete = ['approved', 'skipped'].includes(approval.status)
              const failed = ['rejected', 'returned'].includes(approval.status)
              const active = approval.isActionable
              const color = failed ? 'var(--bad)' : complete ? 'var(--good)' : active ? 'var(--accent)' : 'var(--text-faint)'
              const icon = failed ? 'cancel' : complete ? 'check_circle' : active ? 'schedule' : 'radio_button_unchecked'
              return (
                <div key={`${approval.stage}-${approval.approverName}`} style={{ display: 'flex', gap: 10, paddingBottom: index === approvalSteps.length - 1 ? 0 : 14, position: 'relative' }}>
                  {index < approvalSteps.length - 1 && <span style={{ position: 'absolute', left: 13, top: 27, bottom: 0, width: 1, background: 'var(--border)' }} />}
                  <span style={{ background: active ? 'var(--accent-soft)' : 'var(--surface-2)', width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center', flex: 'none', zIndex: 1 }}><Icon name={icon} size={16} color={color} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700 }}>{approval.stageName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{approval.approverName}</div>
                    <div style={{ fontSize: 12, color, marginTop: 3, textTransform: 'capitalize', fontWeight: 650 }}>{active ? 'Waiting for approval' : String(approval.status).replace(/_/g, ' ')}</div>
                    {approval.comments && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.4 }}>{approval.comments}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {previewOpen && !isReq && <LpoPreviewModal orderId={String(r.apiId || r.id)} reference={String(r.id)} onClose={() => setPreviewOpen(false)} />}
    </div>
  )
}
