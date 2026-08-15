import type { CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const panel: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-sm)',
}

export default function StoresDashboard() {
  const app = useApp()
  const submittedRequests = app.data.storeRequisitions.filter(
    (row) => String(row.status).toLowerCase() === 'submitted',
  )
  const openIssues = app.data.stockIssues.filter(
    (row) => String(row.status).toLowerCase() !== 'applied',
  )
  const lowStock = app.data.items.filter((row) =>
    ['low', 'critical'].includes(String(row.status).toLowerCase()),
  )
  const expiring = app.data.batches.filter(
    (row) => String(row.status).toLowerCase() === 'expiring',
  )
  const inventoryValue = app.data.balances.reduce((sum, row) => sum + Number(row.value || 0), 0)
  const availableUnits = app.data.balances.reduce((sum, row) => sum + Number(row.available || 0), 0)
  const syncTone = app.apiStatus === 'live' ? 'var(--good)' : app.apiStatus === 'loading' ? 'var(--warn)' : 'var(--bad)'

  const kpis = [
    { label: 'Requests awaiting approval', value: submittedRequests.length, icon: 'approval', tone: submittedRequests.length ? 'warning' : 'neutral' },
    { label: 'Issues awaiting posting', value: openIssues.length, icon: 'outbox', tone: openIssues.length ? 'warning' : 'neutral' },
    { label: 'Low-stock articles', value: lowStock.length, icon: 'warning', tone: lowStock.length ? 'danger' : 'neutral' },
    { label: 'Near-expiry batches', value: expiring.length, icon: 'event_busy', tone: expiring.length ? 'warning' : 'neutral' },
    { label: 'Available stock units', value: availableUnits, icon: 'inventory', tone: 'success' },
    { label: 'Inventory value', value: money(inventoryValue), icon: 'savings', tone: 'neutral' },
  ]

  return (
    <div className="dashboard-screen">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div style={{ color: 'var(--accent)', fontSize: 10, fontWeight: 750, letterSpacing: '.1em', textTransform: 'uppercase' }}>Store Keeper</div>
          <h1 style={{ margin: '3px 0 0', color: 'var(--text)', fontSize: 25, fontWeight: 650, letterSpacing: '-.03em' }}>Stores overview</h1>
          <p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>Stock responsibilities and decisions for {app.currentBranch || 'your assigned property'}.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: syncTone }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{app.apiStatus === 'live' ? 'Live data' : app.apiStatus === 'loading' ? 'Refreshing' : 'Connection unavailable'}</span>
          <button onClick={app.refreshData} title="Refresh stores data" style={iconButton}><Icon name="refresh" size={18} /></button>
        </div>
      </div>

      <div className="enterprise-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(150px,1fr))', gap: 10 }}>
        {kpis.map((kpi) => {
          const colors = tone(kpi.tone)
          return (
            <div key={kpi.label} style={{ ...panel, minHeight: 112, padding: 15 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 500 }}>{kpi.label}</span>
                <span style={{ width: 29, height: 29, borderRadius: 6, display: 'grid', placeItems: 'center', background: colors.bg }}><Icon name={kpi.icon} size={17} color={colors.fg} /></span>
              </div>
              <div style={{ color: 'var(--text)', fontSize: typeof kpi.value === 'string' && kpi.value.length > 8 ? 20 : 25, fontWeight: 650, letterSpacing: '-.025em', marginTop: 18 }}>{kpi.value}</div>
            </div>
          )
        })}
      </div>

      <div className="dashboard-ops-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(300px,.75fr)', gap: 14, marginTop: 14 }}>
        <section style={panel}>
          <PanelHeader title="Store requests awaiting your decision" subtitle="Submitted department requests that require quantity review" action="Open workbench" onAction={() => app.navTo('workflow-stores', 'Stores workbench')} />
          {submittedRequests.slice(0, 7).map((row) => (
            <button key={row.id} onClick={() => app.navTo('workflow-stores', 'Stores workbench')} className="hover-surface2" style={queueRow}>
              <span><span style={primaryText}>{row.id}</span><span style={secondaryText}>{row.department || 'Department'} · {row.requester || 'Requester'}</span></span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{row.store || 'Store'}</span>
              <span style={pendingChip}>Awaiting decision</span>
              <Icon name="chevron_right" size={18} color="var(--text-faint)" />
            </button>
          ))}
          {!submittedRequests.length && <Empty text="No store requests are awaiting your decision." />}
        </section>

        <section style={{ ...panel, padding: 16 }}>
          <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 650 }}>Your store tools</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 3, marginBottom: 8 }}>Only tools assigned to the Store Keeper role are shown.</div>
          <QuickAction icon="warehouse" title="Stores workbench" subtitle="Approve, issue, transfer and count stock" onClick={() => app.navTo('workflow-stores', 'Stores workbench')} />
          <QuickAction icon="equalizer" title="Stock balances" subtitle="Review on-hand, reserved and available stock" onClick={() => app.navTo('balances', 'Stock balances')} />
          <QuickAction icon="move_to_inbox" title="Goods received" subtitle="Review receipts delivered to the store" onClick={() => app.navTo('grns', 'Goods received')} />
          <QuickAction icon="layers" title="Batches & expiry" subtitle="Monitor batches and near-expiry stock" onClick={() => app.navTo('batches', 'Batches & expiry')} />
        </section>
      </div>

      <div className="dashboard-ops-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14, marginTop: 14 }}>
        <section style={panel}>
          <PanelHeader title="Low-stock articles" subtitle="Articles at or below their reorder level" action="View inventory" onAction={() => app.navTo('items', 'Articles')} />
          {lowStock.slice(0, 6).map((row) => (
            <button key={row.id} onClick={() => app.navTo('items', 'Articles')} className="hover-surface2" style={queueRow}>
              <span><span style={primaryText}>{row.name}</span><span style={secondaryText}>{row.sku || 'No SKU'} · {row.store || 'Assigned store'}</span></span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{row.onHand || 0} on hand</span>
              <span style={dangerChip}>{row.status}</span>
              <Icon name="chevron_right" size={18} color="var(--text-faint)" />
            </button>
          ))}
          {!lowStock.length && <Empty text="No low-stock exceptions." />}
        </section>

        <section style={panel}>
          <PanelHeader title="Batches nearing expiry" subtitle="Stock that should be issued first under FEFO" action="View batches" onAction={() => app.navTo('batches', 'Batches & expiry')} />
          {expiring.slice(0, 6).map((row) => (
            <button key={row.id} onClick={() => app.navTo('batches', 'Batches & expiry')} className="hover-surface2" style={queueRow}>
              <span><span style={primaryText}>{row.item}</span><span style={secondaryText}>{row.batch || 'Batch'} · {row.store || 'Assigned store'}</span></span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Expires {row.expiry || '—'}</span>
              <span style={pendingChip}>{row.qty || 0} units</span>
              <Icon name="chevron_right" size={18} color="var(--text-faint)" />
            </button>
          ))}
          {!expiring.length && <Empty text="No batches are nearing expiry." />}
        </section>
      </div>
    </div>
  )
}

function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action: string; onAction: () => void }) {
  return <div style={{ minHeight: 61, display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--border)' }}><div><div style={{ color: 'var(--text)', fontSize: 13.5, fontWeight: 650 }}>{title}</div><div style={{ color: 'var(--text-faint)', fontSize: 10.5, marginTop: 2 }}>{subtitle}</div></div><button onClick={onAction} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--accent)', font: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>{action}</button></div>
}

function QuickAction({ icon, title, subtitle, onClick }: { icon: string; title: string; subtitle: string; onClick: () => void }) {
  return <button onClick={onClick} className="hover-surface2" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 8px', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}><span style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: 6, color: 'var(--accent)', background: 'var(--accent-soft)' }}><Icon name={icon} size={18} /></span><span style={{ minWidth: 0, flex: 1 }}><span style={primaryText}>{title}</span><span style={secondaryText}>{subtitle}</span></span><Icon name="chevron_right" size={18} color="var(--text-faint)" /></button>
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
const pendingChip: CSSProperties = { justifySelf: 'end', color: 'var(--warn)', background: 'var(--warn-soft)', borderRadius: 12, padding: '3px 8px', fontSize: 10, fontWeight: 600 }
const dangerChip: CSSProperties = { justifySelf: 'end', color: 'var(--bad)', background: 'var(--bad-soft)', borderRadius: 12, padding: '3px 8px', fontSize: 10, fontWeight: 600 }
const iconButton: CSSProperties = { width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
