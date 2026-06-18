import { useApp } from '../state/AppContext'
import { Icon } from './Icon'

export default function Toast() {
  const app = useApp()
  if (!app.toast) return null

  return (
    <div style={{ position: 'fixed', bottom: 26, left: '50%', transform: 'translateX(-50%)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--text)', color: 'var(--bg)', padding: '12px 18px', borderRadius: 12, boxShadow: '0 12px 30px rgba(0,0,0,.25)', fontSize: 13, fontWeight: 700, animation: 'pop .2s ease' }}>
      <Icon name="check_circle" size={19} color="var(--good)" />{app.toast}
    </div>
  )
}
