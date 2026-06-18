import { useApp } from '../state/AppContext'
import { Icon } from './Icon'

export default function ConfirmDialog() {
  const app = useApp()
  if (!app.confirm) return null

  return (
    <div onClick={app.closeConfirm} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(16,17,33,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', borderRadius: 18, boxShadow: 'var(--shadow)', padding: 24, animation: 'pop .18s ease' }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--bad-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Icon name="delete" size={24} color="var(--bad)" />
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>Delete record?</div>
        <p style={{ margin: '8px 0 20px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          You are about to delete <b style={{ color: 'var(--text)' }}>{app.confirm.name}</b>. This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={app.closeConfirm} className="hover-surface2" style={{ flex: 1, height: 42, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', borderRadius: 11, font: 'inherit', fontSize: 13.5, fontWeight: 700 }}>Cancel</button>
          <button onClick={app.doDelete} className="hover-bright" style={{ flex: 1, height: 42, border: 'none', cursor: 'pointer', background: 'var(--bad)', color: '#fff', borderRadius: 11, font: 'inherit', fontSize: 13.5, fontWeight: 700 }}>Delete</button>
        </div>
      </div>
    </div>
  )
}
