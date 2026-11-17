import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'

/**
 * Tafiti School-inspired sign-in.
 * Visual presentation only: credentials, trusted Django authentication,
 * remembered session, role/property access and safe next redirect stay intact.
 */
export default function Login() {
  const { login, authMessage } = useApp()
  const userId = useId()
  const passId = useId()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [caps, setCaps] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    if (!username.trim() || !password) {
      setError('Enter both your username and password.')
      return
    }
    setBusy(true)
    setError('')
    try {
      // Property and role are assigned and verified by Django after login.
      await login(username.trim(), password, remember)
      const destination = new URLSearchParams(window.location.search).get('next')
      if (destination && destination.startsWith('/') && !destination.startsWith('//') && !destination.includes('\\')) {
        window.location.assign(destination)
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Authentication unsuccessful'
      setError(/failed to fetch|networkerror/i.test(message)
        ? 'The hotel authentication server is not reachable.'
        : message)
    } finally {
      setBusy(false)
    }
  }

  const detectCaps = (event: KeyboardEvent<HTMLInputElement>) => {
    setCaps(event.getModifierState('CapsLock'))
  }

  return <main className="tafiti-login-page">
    <div className="tafiti-login-stack">
      <header className="tafiti-login-brand-card">
        <span className="tafiti-login-brand-icon" aria-hidden="true"><Icon name="hotel" size={25} /></span>
        <h1>Sign in</h1>
        <p>Hotel Inventory &amp; Cost Control</p>
      </header>

      <section className="tafiti-login-form-card" aria-label="Hotel staff sign in">
        {authMessage && <div className="tafiti-login-notice" role="status">{authMessage}</div>}
        {error && <div className="tafiti-login-error" role="alert">{error}</div>}

        <form onSubmit={submit} className="tafiti-login-form" noValidate>
          <div className="tafiti-login-field">
            <label htmlFor={userId}>Username</label>
            <input id={userId} name="username" autoFocus autoComplete="username"
              autoCapitalize="none" spellCheck={false} placeholder="Enter your username"
              value={username} onChange={event => setUsername(event.target.value)}
              disabled={busy} required />
          </div>

          <div className="tafiti-login-field">
            <label htmlFor={passId}>Password</label>
            <div className="tafiti-login-password-wrap">
              <input id={passId} name="password" type={showPassword ? 'text' : 'password'}
                autoComplete="current-password" placeholder="Enter your password"
                value={password} onChange={event => setPassword(event.target.value)}
                onKeyDown={detectCaps} onKeyUp={detectCaps} disabled={busy} required />
              <button type="button" className="tafiti-login-password-toggle"
                onClick={() => setShowPassword(value => !value)} disabled={busy}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {caps && <p className="tafiti-login-caps">Caps Lock is on</p>}
          </div>

          <label className="tafiti-login-remember">
            <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)}
              disabled={busy} />
            <span>Remember me</span>
          </label>

          <button className="tafiti-login-submit" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>

      <p className="tafiti-login-credit">Powered by Tafiti Automate</p>
    </div>
  </main>
}
