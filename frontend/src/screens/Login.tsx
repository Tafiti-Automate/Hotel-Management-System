import { FormEvent, KeyboardEvent, ReactNode, useId, useState } from 'react'
import { useApp } from '../state/AppContext'

type AuthIconName =
  | 'building'
  | 'user'
  | 'lock'
  | 'eye'
  | 'eyeOff'
  | 'info'
  | 'support'
  | 'error'
  | 'caps'
  | 'shield'
  | 'arrow'

function AuthIcon({ name, size = 20 }: { name: AuthIconName; size?: number }) {
  let paths: ReactNode

  switch (name) {
    case 'building':
      paths = (
        <>
          <path d="M4 21V6.5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 15 6.5V21" />
          <path d="M15 10.5h3.5A1.5 1.5 0 0 1 20 12v9M2.5 21h19M8 9h3M8 13h3M8 17h3" />
        </>
      )
      break
    case 'user':
      paths = (
        <>
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5.5 20c.55-4.1 2.72-6.15 6.5-6.15S17.95 15.9 18.5 20" />
        </>
      )
      break
    case 'lock':
      paths = (
        <>
          <rect x="4.5" y="10" width="15" height="11" rx="2.5" />
          <path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14.5v2.25" />
        </>
      )
      break
    case 'eye':
      paths = (
        <>
          <path d="M2.5 12s3.5-5.25 9.5-5.25S21.5 12 21.5 12s-3.5 5.25-9.5 5.25S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      )
      break
    case 'eyeOff':
      paths = (
        <>
          <path d="m3 3 18 18M10.2 7c.58-.17 1.18-.25 1.8-.25 6 0 9.5 5.25 9.5 5.25a15.5 15.5 0 0 1-2.25 2.72M6.1 8.1A15.7 15.7 0 0 0 2.5 12s3.5 5.25 9.5 5.25c1.05 0 2.02-.16 2.9-.43" />
          <path d="M9.75 9.75a3.18 3.18 0 0 0-.25 1.25 2.5 2.5 0 0 0 3.75 2.17" />
        </>
      )
      break
    case 'info':
      paths = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </>
      )
      break
    case 'support':
      paths = (
        <>
          <path d="M4.5 13v-2a7.5 7.5 0 0 1 15 0v2M6.5 17.5H6a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2h.5v5.5ZM17.5 17.5h.5a2 2 0 0 0 2-2V14a2 2 0 0 0-2-2h-.5v5.5Z" />
          <path d="M17.5 17.5c-.7 2-2.2 3-4.5 3h-1" />
        </>
      )
      break
    case 'error':
      paths = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.75M12 16.5h.01" />
        </>
      )
      break
    case 'caps':
      paths = <path d="m5 11 7-7 7 7h-4v5H9v-5H5ZM8 20h8" />
      break
    case 'shield':
      paths = (
        <>
          <path d="M12 3 5 6v5c0 4.5 2.45 7.85 7 10 4.55-2.15 7-5.5 7-10V6l-7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </>
      )
      break
    case 'arrow':
      paths = <path d="M5 12h14M14 7l5 5-5 5" />
      break
  }

  return (
    <svg
      aria-hidden="true"
      className="auth-svg-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths}
    </svg>
  )
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'The staff portal could not reach the hotel server. Check your connection and try again.'
  }
  if (/\b404\b|not found/i.test(message)) {
    return 'The authentication service is unavailable. Please contact your system administrator.'
  }
  if (/invalid credentials/i.test(message)) {
    return 'The username, employee ID, or password is incorrect.'
  }
  return message || 'We could not sign you in. Please try again.'
}

export default function Login() {
  const { login, authMessage } = useApp()
  const usernameId = useId()
  const passwordId = useId()
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usernameError, setUsernameError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [capsLock, setCapsLock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    const cleanUsername = username.trim()
    const nextUsernameError = cleanUsername ? '' : 'Enter your username or employee ID.'
    const nextPasswordError = password ? '' : 'Enter your password.'
    setUsernameError(nextUsernameError)
    setPasswordError(nextPasswordError)
    setError(null)
    if (nextUsernameError || nextPasswordError) return

    setBusy(true)
    try {
      await login(cleanUsername, password, remember)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const detectCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState('CapsLock'))
  }

  return (
    <main className="auth-page">
      <div className="auth-orb auth-orb-one" aria-hidden="true" />
      <div className="auth-orb auth-orb-two" aria-hidden="true" />

      <section className="auth-panel" aria-labelledby="staff-login-title">
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">
            <AuthIcon name="building" size={23} />
          </span>
          <span>
            <strong>Hotel Management ERP</strong>
            <small>Secure operations workspace</small>
          </span>
        </div>

        <div className="auth-card">
          <header>
            <span className="auth-avatar" aria-hidden="true">
              <AuthIcon name="user" size={30} />
            </span>
            <span className="auth-kicker">Welcome back</span>
            <h1 id="staff-login-title">Hotel Staff Login</h1>
            <p>Enter your staff credentials to continue to hotel operations.</p>
          </header>

          {authMessage && (
            <div className="auth-notice" role="status">
              <AuthIcon name="info" size={19} />
              <span>{authMessage}</span>
            </div>
          )}

          <form onSubmit={submit} noValidate>
            <div className="auth-field">
              <label className="auth-label" htmlFor={usernameId}>Username or employee ID</label>
              <div className={`auth-input ${usernameError ? 'is-invalid' : ''}`}>
                <AuthIcon name="user" size={19} />
                <input
                  id={usernameId}
                  name="username"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value)
                    if (usernameError) setUsernameError('')
                  }}
                  autoFocus
                  autoCapitalize="none"
                  autoComplete="username"
                  spellCheck={false}
                  aria-invalid={Boolean(usernameError)}
                  aria-describedby={usernameError ? `${usernameId}-error` : undefined}
                  placeholder="e.g. admin or EMP-001"
                />
              </div>
              {usernameError && <span id={`${usernameId}-error`} className="auth-field-error">{usernameError}</span>}
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor={passwordId}>Password</label>
              <div className={`auth-input ${passwordError ? 'is-invalid' : ''}`}>
                <AuthIcon name="lock" size={19} />
                <input
                  id={passwordId}
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    if (passwordError) setPasswordError('')
                  }}
                  onKeyDown={detectCapsLock}
                  onKeyUp={detectCapsLock}
                  onBlur={() => setCapsLock(false)}
                  autoComplete="current-password"
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={passwordError ? `${passwordId}-error` : capsLock ? `${passwordId}-caps` : undefined}
                  placeholder="Enter your password"
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <AuthIcon name={showPassword ? 'eyeOff' : 'eye'} size={19} />
                </button>
              </div>
              {passwordError && <span id={`${passwordId}-error`} className="auth-field-error">{passwordError}</span>}
              {!passwordError && capsLock && (
                <span id={`${passwordId}-caps`} className="auth-caps">
                  <AuthIcon name="caps" size={15} /> Caps Lock is on
                </span>
              )}
            </div>

            <div className="auth-options">
              <label className="auth-remember">
                <input
                  type="checkbox"
                  name="remember"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span>Keep me signed in</span>
              </label>
              <button
                className="auth-help-link"
                type="button"
                onClick={() => setShowHelp((value) => !value)}
                aria-expanded={showHelp}
              >
                Forgot password?
              </button>
            </div>

            {showHelp && (
              <div className="auth-help" role="note">
                <AuthIcon name="support" size={21} />
                <span>
                  <strong>Need help signing in?</strong>
                  Contact your system administrator to reset your password or confirm your employee ID.
                </span>
              </div>
            )}

            {error && (
              <div className="auth-error" role="alert" aria-live="assertive">
                <AuthIcon name="error" size={20} />
                <span>{error}</span>
              </div>
            )}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? (
                <>
                  <span className="auth-spinner" />
                  Signing you in…
                </>
              ) : (
                <>
                  Sign in
                  <AuthIcon name="arrow" size={18} />
                </>
              )}
            </button>
          </form>

          <div className="auth-security-note">
            <AuthIcon name="shield" size={16} />
            <span>Protected access for authorised hotel staff</span>
          </div>
        </div>
      </section>
    </main>
  )
}
