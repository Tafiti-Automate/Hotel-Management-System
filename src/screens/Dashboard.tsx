import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import type { Tab } from '../state/AppContext'

interface Badge { type: 'good' | 'muted' | 'bad'; icon?: string; text: string }
interface Kpi {
  icon: string
  iconBad?: boolean
  label: string
  value: string
  badge: Badge
  line: string
  bad?: boolean
}

const kpis: Kpi[] = [
  { icon: 'request_quote', label: 'Open Requisitions', value: '24', badge: { type: 'good', icon: 'arrow_upward', text: '5' }, line: '0,24 18,20 36,22 54,15 72,17 90,8 120,5' },
  { icon: 'receipt_long', label: 'Pending POs', value: '9', badge: { type: 'muted', text: 'UGX 178M' }, line: '0,16 18,18 36,13 54,15 72,11 90,13 120,9' },
  { icon: 'savings', label: 'Inventory Value', value: 'UGX 1.15B', badge: { type: 'good', icon: 'arrow_upward', text: '2.9%' }, line: '0,22 18,23 36,18 54,20 72,14 90,15 120,8' },
  { icon: 'warning', iconBad: true, bad: true, label: 'Low-stock Items', value: '12', badge: { type: 'bad', icon: 'priority_high', text: 'Action' }, line: '0,8 18,11 36,9 54,15 72,14 90,20 120,24' },
  { icon: 'move_to_inbox', label: 'GRNs This Week', value: '7', badge: { type: 'good', icon: 'arrow_upward', text: '2' }, line: '0,20 18,22 36,17 54,19 72,13 90,16 120,10' },
  { icon: 'payments', label: 'Spend (MTD)', value: 'UGX 319M', badge: { type: 'good', icon: 'arrow_downward', text: '4.1%' }, line: '0,9 18,12 36,11 54,17 72,16 90,22 120,25' },
]

const pipeline = [
  { icon: 'request_quote', label: 'Requisitions', value: 24 },
  { icon: 'price_check', label: 'Quotations', value: 12 },
  { icon: 'receipt_long', label: 'Orders', value: 9 },
  { icon: 'move_to_inbox', label: 'Receipts', value: 7 },
  { icon: 'fact_check', label: 'Inspections', value: 5 },
]

const activity = [
  { icon: 'receipt_long', color: 'accent', html: <>Created <b style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>PO-2041</b> for Fresh Foods Ltd</>, meta: 'admin · 14m ago' },
  { icon: 'move_to_inbox', color: 'accent', html: <><b style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>GRN-0188</b> received against PO-2039</>, meta: 'k.owusu · 1h ago' },
  { icon: 'check_circle', color: 'good', html: <>Requisition <b style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>REQ-3120</b> approved</>, meta: 'store manager · 2h ago' },
  { icon: 'local_shipping', color: 'accent', html: <>New supplier <b>Sunrise Linens</b> added</>, meta: 'admin · 5h ago' },
]

const spend = [
  { label: 'Food & Beverage', pct: 100, amt: 'UGX 119M' },
  { label: 'Housekeeping', pct: 57, amt: 'UGX 68M' },
  { label: 'Maintenance', pct: 40, amt: 'UGX 48M' },
  { label: 'Linen & Laundry', pct: 30, amt: 'UGX 36M' },
  { label: 'Amenities', pct: 24, amt: 'UGX 29M' },
]

const poLegend = [
  { color: 'var(--accent)', label: 'Awaiting GRN', value: 4 },
  { color: 'var(--good)', label: 'In transit', value: 2 },
  { color: 'var(--warn)', label: 'Completed', value: 2 },
  { color: 'var(--border-2)', label: 'Draft', value: 1 },
]

const approvals = [
  { id: 'REQ-3125', total: 'UGX 15.5M', meta: 'Housekeeping · raised by J. Mensah' },
  { id: 'REQ-3126', total: 'UGX 28.3M', meta: 'Food & Beverage · raised by K. Owusu' },
  { id: 'REQ-3127', total: 'UGX 6.8M', meta: 'Maintenance · raised by A. Boateng' },
]

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)', padding: 18 }

function Sparkline({ line, bad }: { line: string; bad?: boolean }) {
  const stroke = bad ? 'var(--bad)' : 'var(--accent)'
  const fill = bad ? 'var(--bad-soft)' : 'var(--accent-soft)'
  const poly = `${line} 120,32 0,32`
  return (
    <svg width="100%" height="32" viewBox="0 0 120 32" preserveAspectRatio="none" style={{ display: 'block' }}>
      <polygon points={poly} fill={fill} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function KpiBadge({ badge }: { badge: Badge }) {
  if (badge.type === 'muted') {
    return <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '2px 7px', borderRadius: 20, marginBottom: 3, fontFamily: "'JetBrains Mono',monospace" }}>{badge.text}</span>
  }
  const c = badge.type === 'bad' ? 'var(--bad)' : 'var(--good)'
  const b = badge.type === 'bad' ? 'var(--bad-soft)' : 'var(--good-soft)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 11, fontWeight: 700, color: c, background: b, padding: '2px 7px', borderRadius: 20, marginBottom: 3 }}>
      {badge.icon && <Icon name={badge.icon} size={13} />}{badge.text}
    </span>
  )
}

export default function Dashboard() {
  const app = useApp()
  const tab = app.tab
  const showProcurement = tab === 'overview' || tab === 'procurement'
  const syncColor = app.apiStatus === 'live' ? 'var(--good)' : app.apiStatus === 'loading' ? 'var(--warn)' : 'var(--bad)'
  const syncText = app.apiStatus === 'live' ? 'Backend connected' : app.apiStatus === 'loading' ? 'Syncing backend' : 'Local demo data'

  const tabBtn = (key: Tab, label: string) => {
    const on = tab === key
    return (
      <button key={key} onClick={() => app.setTab(key)} style={{ border: 'none', background: on ? 'var(--surface)' : 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, color: on ? 'var(--text)' : 'var(--text-muted)', padding: '6px 15px', borderRadius: 8, boxShadow: on ? 'var(--shadow-sm)' : 'none' }}>{label}</button>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-.025em', color: 'var(--text)' }}>Dashboard</h1>
          <p style={{ margin: '7px 0 0', fontSize: 13.5, color: 'var(--text-muted)', maxWidth: 580, lineHeight: 1.5 }}>Procurement &amp; inventory overview for your property — requisitions, purchase orders, stock levels and approvals, all in one place.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <button className="hover-surface2" style={{ display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 13px', border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', borderRadius: 10, font: 'inherit', fontSize: 12.5, fontWeight: 700 }}>
            <Icon name="calendar_today" size={17} color="var(--text-muted)" />Last 30 days<Icon name="expand_more" size={17} color="var(--text-faint)" />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, padding: 3 }}>
          {tabBtn('overview', 'Overview')}
          {tabBtn('procurement', 'Procurement')}
          {tabBtn('inventory', 'Inventory')}
        </div>
        <div title={app.apiMessage || syncText} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-faint)', fontWeight: 600 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: syncColor }} />{syncText}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(184px,1fr))', gap: 'var(--gap)' }}>
          {kpis.map((k) => (
            <div key={k.label} className="hover-card" style={{ ...card, borderRadius: 15, padding: '15px 15px 11px', display: 'flex', flexDirection: 'column', gap: 11, minWidth: 0, transition: 'transform .15s ease,box-shadow .15s ease,border-color .15s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: k.iconBad ? 'var(--bad-soft)' : 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                  <Icon name={k.icon} size={18} color={k.iconBad ? 'var(--bad)' : 'var(--accent)'} />
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{k.label}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <span style={{ fontSize: 27, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.02em', lineHeight: 1 }}>{k.value}</span>
                <KpiBadge badge={k.badge} />
              </div>
              <Sparkline line={k.line} bad={k.bad} />
            </div>
          ))}
        </div>

        {/* Pipeline + Recent activity */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.9fr) minmax(0,320px)', gap: 'var(--gap)' }}>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em' }}>Procurement pipeline</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>From requisition to inspection — this month</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, marginTop: 18, overflowX: 'auto', paddingBottom: 4 }}>
              {pipeline.map((p, i) => (
                <div key={p.label} style={{ display: 'contents' }}>
                  <div style={{ flex: 1, minWidth: 124, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 13, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
                      <Icon name={p.icon} size={17} color="var(--accent)" />
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)' }}>{p.label}</span>
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.02em' }}>{p.value}</div>
                  </div>
                  {i < pipeline.length - 1 && (
                    <div style={{ display: 'flex', alignItems: 'center' }}><Icon name="chevron_right" size={20} color="var(--text-faint)" /></div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em', marginBottom: 16 }}>Recent activity</div>
            {activity.map((a, i) => {
              const last = i === activity.length - 1
              const c = a.color === 'good' ? 'var(--good)' : 'var(--accent)'
              const b = a.color === 'good' ? 'var(--good-soft)' : 'var(--accent-soft)'
              return (
                <div key={i} style={{ display: 'flex', gap: 11 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
                    <span style={{ color: c, background: b, width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={a.icon} size={16} color={c} /></span>
                    {!last && <div style={{ flex: 1, width: 2, background: 'var(--border)', margin: '4px 0', borderRadius: 2 }} />}
                  </div>
                  <div style={{ paddingBottom: last ? 0 : 14 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.45 }}>{a.html}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 3 }}>{a.meta}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Procurement group: spend by category + PO donut */}
        {showProcurement && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 'var(--gap)' }}>
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em' }}>Spend by category</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Total <b style={{ color: 'var(--text)', fontFamily: "'JetBrains Mono',monospace" }}>UGX 319M</b></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                {spend.map((s) => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 118, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600, flex: 'none' }}>{s.label}</span>
                    <div style={{ flex: 1, height: 9, background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${s.pct}%`, background: 'linear-gradient(90deg,var(--accent),var(--accent-strong))', borderRadius: 6 }} />
                    </div>
                    <span style={{ width: 80, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: 'var(--text)', fontFamily: "'JetBrains Mono',monospace" }}>{s.amt}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em' }}>Purchase orders</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>By status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 16 }}>
                <div style={{ position: 'relative', width: 118, height: 118, flex: 'none' }}>
                  <div style={{ width: 118, height: 118, borderRadius: '50%', background: 'conic-gradient(var(--accent) 0 45%,var(--good) 45% 70%,var(--warn) 70% 89%,var(--border-2) 89% 100%)' }} />
                  <div style={{ position: 'absolute', inset: 13, borderRadius: '50%', background: 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>9</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginTop: 1 }}>active</span>
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {poLegend.map((l) => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: l.color, flex: 'none' }} />
                      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{l.label}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{l.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Procurement group: pending approvals */}
        {showProcurement && (
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em' }}>Pending approvals</div>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 9px', borderRadius: 20 }}>3 waiting</span>
              </div>
              <button onClick={() => app.navTo('approvals', 'Approvals')} className="hover-surface2" style={{ border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', padding: '6px 11px', borderRadius: 9 }}>View queue</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 'var(--gap)' }}>
              {approvals.map((a) => (
                <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 13, padding: 14, background: 'var(--surface-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: "'JetBrains Mono',monospace" }}>{a.id}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', fontFamily: "'JetBrains Mono',monospace" }}>{a.total}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 13 }}>{a.meta}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => app.navTo('approvals', 'Approvals')} className="hover-accent" style={{ flex: 1, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', borderRadius: 9, font: 'inherit', fontSize: 12, fontWeight: 700, padding: 8 }}>Review</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
