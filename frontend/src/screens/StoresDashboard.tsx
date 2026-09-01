import type { CSSProperties } from 'react'
import { Icon } from '../components/Icon'
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
  const forwarded = app.data.storeRequisitions.filter(
    (row) => String(row.status).toLowerCase() === 'awaiting procurement' || String(row.status).toLowerCase() === 'awaiting_procurement',
  )
  const syncTone = app.apiStatus === 'live' ? 'var(--good)' : app.apiStatus === 'loading' ? 'var(--warn)' : 'var(--bad)'
  return (
    <div className="dashboard-screen">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div style={{ color: 'var(--accent)', fontSize: 11.5, fontWeight: 750, letterSpacing: '.1em', textTransform: 'uppercase' }}>Store Keeper</div>
          <h1 style={{ margin: '3px 0 0', color: 'var(--text)', fontSize: 25, fontWeight: 650, letterSpacing: '-.03em' }}>Stores workspace</h1>
          <p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>Process HOD-approved Department requests and raise direct purchase requests when your assigned store needs replenishment.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => app.navTo('store-purchase-requests', 'Purchase requests')} style={primaryButton}><Icon name="add_shopping_cart" size={17} />Create purchase request</button>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: syncTone }} /><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{app.apiStatus === 'live' ? 'Live data' : app.apiStatus === 'loading' ? 'Refreshing' : 'Connection unavailable'}</span><button onClick={app.refreshData} title="Refresh" style={iconButton}><Icon name="refresh" size={18} /></button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(180px,1fr))', gap: 10, marginBottom: 14 }}>
        <div style={{ ...panel, padding: 16 }}><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Department requests awaiting action</div><div style={{ marginTop: 10, color: 'var(--text)', fontSize: 26, fontWeight: 700 }}>{submittedRequests.length}</div></div>
        <div style={{ ...panel, padding: 16 }}><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Forwarded to Procurement</div><div style={{ marginTop: 10, color: 'var(--text)', fontSize: 26, fontWeight: 700 }}>{forwarded.length}</div></div>
      </div>
      <section style={panel}>
        <PanelHeader title="Department requests" subtitle="No supplier, quotation or price data is shown in this queue" action="Open work queue" onAction={() => app.navTo('workflow-stores', 'Store requests')} />
        {submittedRequests.slice(0, 10).map((row) => <button key={row.id} onClick={() => app.navTo('workflow-stores', 'Store requests')} className="hover-surface2" style={queueRow}><span><span style={primaryText}>{row.id}</span><span style={secondaryText}>{row.department || 'Department'} · {row.itemSummary || 'Requested items'}</span></span><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{row.store || 'Assigned store'}</span><span style={pendingChip}>Needs Store Keeper</span><Icon name="chevron_right" size={18} color="var(--text-faint)" /></button>)}
        {!submittedRequests.length && <Empty text="No department requests are waiting for Store Keeper action." />}
      </section>
    </div>
  )
}

function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action: string; onAction: () => void }) {
  return <div style={{ minHeight: 61, display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--border)' }}><div><div style={{ color: 'var(--text)', fontSize: 13.5, fontWeight: 650 }}>{title}</div><div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>{subtitle}</div></div><button onClick={onAction} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--accent)', font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{action}</button></div>
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 30, color: 'var(--text-faint)', textAlign: 'center', fontSize: 12.5 }}>{text}</div>
}

const queueRow: CSSProperties = { width: '100%', minHeight: 56, display: 'grid', gridTemplateColumns: 'minmax(150px,1fr) auto auto 18px', alignItems: 'center', gap: 12, padding: '8px 16px', border: 0, borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit' }
const primaryText: CSSProperties = { display: 'block', color: 'var(--text)', fontSize: 12.5, fontWeight: 600 }
const secondaryText: CSSProperties = { display: 'block', color: 'var(--text-faint)', fontSize: 12, marginTop: 3 }
const pendingChip: CSSProperties = { justifySelf: 'end', color: 'var(--warn)', background: 'var(--warn-soft)', borderRadius: 12, padding: '3px 8px', fontSize: 11.5, fontWeight: 600 }
const iconButton: CSSProperties = { width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }

const primaryButton: CSSProperties = { height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 11px', border: '1px solid var(--accent)', borderRadius: 6, background: 'var(--accent)', color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 650 }
