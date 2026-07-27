import type { CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const panel: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-sm)' }

export default function Dashboard() {
  const app = useApp()
  const requisitions = app.data.requisitions
  const pending = requisitions.filter((row) => !['Approved', 'Rejected', 'Cancelled'].includes(String(row.status)))
  const lowStock = app.data.items.filter((row) => ['Low', 'Critical'].includes(String(row.status)))
  const expiring = app.data.batches.filter((row) => String(row.status) === 'Expiring')
  const todaysReceipts = app.data.grns.filter((row) => String(row.date) === new Date().toISOString().slice(0, 10))
  const todaysIssues = app.data.stockIssues.filter((row) => String(row.date) === new Date().toISOString().slice(0, 10))
  const inventoryValue = app.data.balances.reduce((sum, row) => sum + Number(row.value || 0), 0)

  const kpis = [
    { label: 'Pending purchase requests', value: pending.length, icon: 'request_quote', tone: 'neutral' },
    { label: 'Pending approvals', value: pending.length, icon: 'approval', tone: pending.length ? 'warning' : 'neutral' },
    { label: 'Low stock articles', value: lowStock.length, icon: 'warning', tone: lowStock.length ? 'danger' : 'neutral' },
    { label: 'Items near expiry', value: expiring.length, icon: 'event_busy', tone: expiring.length ? 'warning' : 'neutral' },
    { label: "Today's receipts", value: todaysReceipts.length, icon: 'move_to_inbox', tone: 'success' },
    { label: 'Inventory value', value: money(inventoryValue), icon: 'savings', tone: 'neutral' },
  ]

  const movements = app.data.ledgers.slice(0, 7)
  const syncTone = app.apiStatus === 'live' ? 'var(--good)' : app.apiStatus === 'loading' ? 'var(--warn)' : 'var(--bad)'

  return (
    <div className="dashboard-screen">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div><h1 style={{ margin: 0, color: 'var(--text)', fontSize: 25, fontWeight: 650, letterSpacing: '-.03em' }}>Operations dashboard</h1><p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>Current workload and stock exceptions for {app.currentBranch}.</p></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: syncTone }} /><span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{app.apiStatus === 'live' ? 'Live data' : app.apiStatus === 'loading' ? 'Refreshing' : 'Connection unavailable'}</span><button onClick={app.refreshData} style={iconButton}><Icon name="refresh" size={18} /></button></div>
      </div>

      <div className="enterprise-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(150px,1fr))', gap: 10 }}>
        {kpis.map((kpi) => {
          const colors = tone(kpi.tone)
          return <button key={kpi.label} className="hover-card" style={{ ...panel, minHeight: 112, padding: 15, textAlign: 'left', cursor: 'pointer', font: 'inherit', transition: 'all .15s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 500 }}>{kpi.label}</span><span style={{ width: 29, height: 29, borderRadius: 6, display: 'grid', placeItems: 'center', background: colors.bg }}><Icon name={kpi.icon} size={17} color={colors.fg} /></span></div>
            <div style={{ color: 'var(--text)', fontSize: typeof kpi.value === 'string' && kpi.value.length > 8 ? 20 : 25, fontWeight: 650, letterSpacing: '-.025em', marginTop: 18 }}>{kpi.value}</div>
          </button>
        })}
      </div>

      <div className="dashboard-ops-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', gap: 14, marginTop: 14 }}>
        <section style={panel}>
          <PanelHeader title="Purchase requests awaiting action" subtitle="Prioritised approval and procurement queue" action="View all" onAction={() => app.navTo('approvals', 'Approvals')} />
          {pending.slice(0, 6).map((row) => <button key={row.id} onClick={() => app.openDetail('requisitions', row.id, 'dashboard')} className="hover-surface2" style={queueRow}>
            <span><span style={primaryText}>{String(row.id).slice(0, 18)}</span><span style={secondaryText}>{row.dept || 'Department'} · {row.requester || 'Requester'}</span></span>
            <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>{money(row.total)}</span>
            <Status value={String(row.status || 'Pending')} />
            <Icon name="chevron_right" size={18} color="var(--text-faint)" />
          </button>)}
          {!pending.length && <Empty text="No purchase requests require attention." />}
        </section>

        <section style={panel}>
          <PanelHeader title="Low stock" subtitle="Articles at or below minimum level" action="Open inventory" onAction={() => app.navTo('items', 'Articles')} />
          {lowStock.slice(0, 6).map((row) => <button key={row.id} onClick={() => app.navTo('items', 'Articles')} className="hover-surface2" style={queueRow}>
            <span><span style={primaryText}>{row.name}</span><span style={secondaryText}>{row.sku || 'No SKU'} · {row.store || 'All stores'}</span></span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{row.onHand || 0} available</span>
            <Status value={String(row.status)} />
            <Icon name="chevron_right" size={18} color="var(--text-faint)" />
          </button>)}
          {!lowStock.length && <Empty text="No low-stock exceptions." />}
        </section>
      </div>

      <div className="dashboard-ops-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', gap: 14, marginTop: 14 }}>
        <section style={panel}>
          <PanelHeader title="Recent stock movements" subtitle="Latest posted inventory transactions" action="Stock ledger" onAction={() => app.navTo('ledgers', 'Stock ledger')} />
          {movements.map((row) => <button key={row.id} onClick={() => app.navTo('ledgers', 'Stock ledger')} className="hover-surface2" style={queueRow}>
            <span><span style={primaryText}>{row.item || 'Article movement'}</span><span style={secondaryText}>{row.date || '—'} · {row.ref || 'No reference'}</span></span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{row.store || 'Store'}</span>
            <span style={{ color: String(row.type).toLowerCase().includes('in') ? 'var(--good)' : 'var(--text)', fontSize: 12, fontWeight: 600 }}>{row.qty || 0}</span>
            <Icon name="open_in_new" size={16} color="var(--text-faint)" />
          </button>)}
          {!movements.length && <Empty text="No stock movements have been posted." />}
        </section>

        <section style={{ ...panel, padding: 16 }}>
          <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 650 }}>Notifications</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 3 }}>Operational alerts requiring follow-up</div>
          {[
            [`${pending.length} purchase requests`, 'Awaiting review or approval', 'approval', pending.length ? 'var(--warn)' : 'var(--text-faint)'],
            [`${lowStock.length} low-stock articles`, 'Reorder action recommended', 'warning', lowStock.length ? 'var(--bad)' : 'var(--text-faint)'],
            [`${expiring.length} near-expiry batches`, 'Review consumption or transfer', 'event_busy', expiring.length ? 'var(--warn)' : 'var(--text-faint)'],
            [`${todaysIssues.length} issues today`, 'Department stock consumption', 'outbox', 'var(--accent)'],
          ].map(([title, subtitle, icon, color]) => <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 0', borderBottom: '1px solid var(--border)' }}><span style={{ width: 31, height: 31, display: 'grid', placeItems: 'center', borderRadius: 6, background: 'var(--surface-2)' }}><Icon name={icon} size={18} color={color} /></span><span><span style={primaryText}>{title}</span><span style={secondaryText}>{subtitle}</span></span></div>)}
        </section>
      </div>
    </div>
  )
}

function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action: string; onAction: () => void }) {
  return <div style={{ minHeight: 61, display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--border)' }}><div><div style={{ color: 'var(--text)', fontSize: 13.5, fontWeight: 650 }}>{title}</div><div style={{ color: 'var(--text-faint)', fontSize: 10.5, marginTop: 2 }}>{subtitle}</div></div><button onClick={onAction} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--accent)', font: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>{action}</button></div>
}

function Status({ value }: { value: string }) {
  const bad = ['critical', 'rejected'].some((item) => value.toLowerCase().includes(item))
  const good = ['approved', 'completed', 'active'].some((item) => value.toLowerCase().includes(item))
  return <span style={{ justifySelf: 'end', color: bad ? 'var(--bad)' : good ? 'var(--good)' : 'var(--warn)', background: bad ? 'var(--bad-soft)' : good ? 'var(--good-soft)' : 'var(--warn-soft)', borderRadius: 12, padding: '3px 8px', fontSize: 10, fontWeight: 600, textTransform: 'capitalize' }}>{value.replace(/_/g, ' ')}</span>
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 30, color: 'var(--text-faint)', textAlign: 'center', fontSize: 12.5 }}>{text}</div>
}

function tone(value: string) {
  if (value === 'danger') return { fg: 'var(--bad)', bg: 'var(--bad-soft)' }
  if (value === 'warning') return { fg: 'var(--warn)', bg: 'var(--warn-soft)' }
  if (value === 'success') return { fg: 'var(--good)', bg: 'var(--good-soft)' }
  return { fg: 'var(--accent)', bg: 'var(--accent-soft)' }
}

const queueRow: CSSProperties = { width: '100%', minHeight: 56, display: 'grid', gridTemplateColumns: 'minmax(150px,1fr) auto auto 18px', alignItems: 'center', gap: 12, padding: '8px 16px', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit' }
const primaryText: CSSProperties = { display: 'block', color: 'var(--text)', fontSize: 12.5, fontWeight: 600 }
const secondaryText: CSSProperties = { display: 'block', color: 'var(--text-faint)', fontSize: 10.5, marginTop: 3 }
const iconButton: CSSProperties = { width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
