import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import { reports } from '../lib/data'

export default function Reports() {
  const app = useApp()

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--text)' }}>Reports</h1>
        <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>Generate reports across every area of stock management.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 'var(--gap)' }}>
        {reports.map((rc) => (
          <button key={rc.id} onClick={() => app.openReport(rc.id)} className="hover-card" style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 15, padding: 18, boxShadow: 'var(--shadow)', transition: 'transform .15s ease,box-shadow .15s ease,border-color .15s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={rc.icon} size={21} color="var(--accent)" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 750, color: rc.source === 'backend' ? 'var(--good)' : 'var(--text-faint)', background: rc.source === 'backend' ? 'var(--good-soft)' : 'var(--surface-2)', border: '1px solid var(--border)', padding: '3px 7px', borderRadius: 20 }}>{rc.source === 'backend' ? 'Live' : 'Snapshot'}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '3px 8px', borderRadius: 20 }}>{rc.grp}</span>
              </div>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em' }}>{rc.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{rc.desc}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, fontSize: 12.5, fontWeight: 700, color: 'var(--accent)' }}>Generate<Icon name="arrow_forward" size={17} /></div>
          </button>
        ))}
      </div>
    </div>
  )
}
