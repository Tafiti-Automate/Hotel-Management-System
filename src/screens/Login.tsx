import { useState } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'

export default function Login() {
  const { enterLaunch } = useApp()
  const [showPw, setShowPw] = useState(false)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'radial-gradient(1100px 560px at 50% -8%,var(--accent-soft),transparent 62%),var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 404 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginBottom: 22 }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(135deg,var(--accent),var(--accent-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' }}>
            <Icon name="hotel" size={25} color="#fff" fill weight={500} />
          </div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em' }}>Hotel Management Software</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '.12em' }}>ERP SUITE</div>
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, boxShadow: 'var(--shadow)', padding: 28 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em' }}>Sign in</h1>
          <p style={{ margin: '6px 0 22px', fontSize: 13, color: 'var(--text-muted)' }}>Enter your employee credentials to continue.</p>

          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7 }}>Employee ID</label>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <Icon name="badge" size={19} color="var(--text-faint)" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
            <input defaultValue="EMP-1042" style={{ width: '100%', height: 44, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 11, padding: '0 13px 0 40px', fontSize: 14, fontWeight: 600, color: 'var(--text)', outline: 'none' }} />
          </div>

          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7 }}>Password</label>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Icon name="lock" size={19} color="var(--text-faint)" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }} />
            <input type={showPw ? 'text' : 'password'} defaultValue="password123" style={{ width: '100%', height: 44, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 11, padding: '0 40px 0 40px', fontSize: 14, color: 'var(--text)', outline: 'none' }} />
            <span onClick={() => setShowPw((v) => !v)} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', display: 'flex' }}>
              <Icon name={showPw ? 'visibility' : 'visibility_off'} size={19} color="var(--text-faint)" />
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" defaultChecked style={{ accentColor: 'var(--accent)', width: 15, height: 15 }} />Remember me
            </label>
            <span style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}>Forgot password?</span>
          </div>

          <button onClick={enterLaunch} style={{ width: '100%', height: 46, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', borderRadius: 12, font: 'inherit', fontSize: 14, fontWeight: 700, boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            Sign in<Icon name="arrow_forward" size={19} />
          </button>
        </div>
        <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--text-faint)', marginTop: 18 }}>Secured access · Hotel Management ERP v1.0</p>
      </div>
    </div>
  )
}
