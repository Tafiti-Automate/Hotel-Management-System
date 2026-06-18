import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import type { Line } from '../lib/data'
import { chipStyleFor, money } from '../lib/theme'

const lineGrid = 'minmax(0,1.8fr) 80px 70px 100px 110px'

const fieldLabel: CSSProperties = { fontSize: 11, color: 'var(--text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }
const fieldValue: CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }
const lineHead: CSSProperties = { padding: '9px 12px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }

export default function DetailView() {
  const app = useApp()
  const d = app.detail
  if (!d) return null
  const r = app.data[d.entity].find((x) => x.id === d.id)
  if (!r) return null

  const isReq = d.entity === 'requisitions'
  const kind = isReq ? 'Requisition' : 'Purchase Order'
  const lines: Line[] = r.lines || []
  const isPending = isReq && r.status === 'Pending'
  const decided = isReq && (r.status === 'Approved' || r.status === 'Rejected')

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
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{kind}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: "'JetBrains Mono',monospace", letterSpacing: '-.01em', marginTop: 3 }}>{r.id}</div>
            </div>
            <span style={chipStyleFor(r.status)}>{r.status}</span>
          </div>

          <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 16, borderBottom: '1px solid var(--border)' }}>
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
          {isPending && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)', padding: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Approval decision</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>Review the requisition and record your decision. This will notify the requester.</div>
              <textarea placeholder="Add a comment (optional)…" style={{ width: '100%', height: 74, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: 10, fontSize: 12.5, color: 'var(--text)', outline: 'none', resize: 'none', marginBottom: 12 }} />
              <button onClick={app.approveReq} className="hover-bright" style={{ width: '100%', height: 42, border: 'none', cursor: 'pointer', background: 'var(--good)', color: '#fff', borderRadius: 11, font: 'inherit', fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 9 }}>
                <Icon name="check_circle" size={19} />Approve
              </button>
              <button onClick={app.rejectReq} className="hover-reject" style={{ width: '100%', height: 42, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--bad)', borderRadius: 11, font: 'inherit', fontSize: 13.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
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

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)', padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 14 }}>Activity</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 13 }}>
              <span style={{ color: 'var(--accent)', background: 'var(--accent-soft)', width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="edit_note" size={15} color="var(--accent)" /></span>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{kind} created</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{f2} · {r.date}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ color: 'var(--text-faint)', background: 'var(--surface-2)', width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name="hourglass_top" size={15} color="var(--text-faint)" /></span>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>Awaiting decision</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Store Manager</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
