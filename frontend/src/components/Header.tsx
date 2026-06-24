import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { accentMap, accentOrder, type AccentName, type Density, type Mode } from '../lib/theme'

const iconBtn: CSSProperties = {
  width: 38, height: 38, border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 11,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)',
}

function segStyle(on: boolean): CSSProperties {
  return {
    flex: 1, border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 700,
    color: on ? 'var(--text)' : 'var(--text-muted)', padding: 7, borderRadius: 7,
    background: on ? 'var(--surface)' : 'transparent', boxShadow: on ? 'var(--shadow-sm)' : 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }
}

export default function Header() {
  const app = useApp()
  const isHotelProfile = app.route === 'hotel-profile'

  return (
    <header style={{ height: 62, flex: 'none', display: 'flex', alignItems: 'center', gap: 16, padding: '0 var(--pad)', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flex: 'none' }}>
        <Icon name="home" size={18} color="var(--text-faint)" />
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{isHotelProfile ? 'Administration' : 'Stock Management'}</span>
        <span style={{ color: 'var(--text-faint)' }}>/</span>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{app.crumb}</span>
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 400 }}>
          <Icon name="search" size={19} color="var(--text-faint)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input placeholder="Search items, POs, suppliers…" style={{ width: '100%', height: 38, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 11, padding: '0 12px 0 38px', fontSize: 13, color: 'var(--text)', outline: 'none' }} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <button onClick={app.toggleMode} title="Toggle theme" className="hover-surface2" style={iconBtn}>
          <Icon name={app.mode === 'dark' ? 'light_mode' : 'dark_mode'} size={19} />
        </button>

        <div style={{ position: 'relative' }}>
          <button onClick={app.toggleSettings} title="Appearance" className="hover-surface2" style={iconBtn}>
            <Icon name="tune" size={19} />
          </button>
          {app.settingsOpen && (
            <>
              <div onClick={app.closePop} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 8, zIndex: 50, width: 268, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)', padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 14 }}>Appearance</div>

                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>Accent color</div>
                <div style={{ display: 'flex', gap: 9, marginBottom: 16 }}>
                  {accentOrder.map((a: AccentName) => {
                    const on = a === app.accentName
                    return (
                      <button key={a} title={a} onClick={() => app.setAccent(a)} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer', background: accentMap[a], boxShadow: on ? '0 0 0 2px var(--surface),0 0 0 4px var(--accent)' : 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
                    )
                  })}
                </div>

                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>Theme</div>
                <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 3, marginBottom: 16 }}>
                  {(['light', 'dark'] as Mode[]).map((m) => (
                    <button key={m} onClick={() => app.setMode(m)} style={segStyle(app.mode === m)}>
                      <Icon name={m === 'light' ? 'light_mode' : 'dark_mode'} size={16} />{m === 'light' ? 'Light' : 'Dark'}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>Density</div>
                <div style={{ display: 'flex', gap: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 3 }}>
                  {(['Airy', 'Compact'] as Density[]).map((d) => (
                    <button key={d} onClick={() => app.setDensity(d)} style={segStyle(app.density === d)}>{d}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <button title="Notifications" className="hover-surface2" style={{ ...iconBtn, position: 'relative' }}>
          <Icon name="notifications" size={19} />
          <span style={{ position: 'absolute', top: 9, right: 10, width: 7, height: 7, borderRadius: '50%', background: 'var(--bad)', border: '1.5px solid var(--surface)' }} />
        </button>

        <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 2px' }} />

        {!isHotelProfile && (
          <button onClick={() => app.navTo('requisitions', 'Requisitions')} className="hover-accent" style={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 15px', border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', borderRadius: 11, font: 'inherit', fontSize: 13, fontWeight: 700, boxShadow: 'var(--shadow-sm)' }}>
            <Icon name="add" size={18} weight={500} />New Requisition
          </button>
        )}
      </div>
    </header>
  )
}
