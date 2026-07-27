import { FormEvent, KeyboardEvent, useId, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'The system could not reach the server. Check your connection and try again.'
  }
  if (/invalid credentials/i.test(message)) {
    return 'The employee ID or password is incorrect.'
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
      await login(cleanUsername, password)
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
      <section className="auth-panel">
        <div className="auth-card">
          <header>
            <span className="auth-avatar" aria-hidden="true">
              <Icon name="person" size={58} />
            </span>
            <h1>Hotel Staff Login</h1>
            <p>Welcome back. Please enter your account details.</p>
          </header>

          {authMessage && (
            <div className="auth-notice" role="status">
              <Icon name="info" size={19} />
              <span>{authMessage}</span>
            </div>
          )}

          <form onSubmit={submit} noValidate>
            <div className="auth-field">
              <label className="sr-only" htmlFor={usernameId}>Username or employee ID</label>
              <div className={`auth-input ${usernameError ? 'is-invalid' : ''}`}>
                <Icon name="mail" size={20} />
                <input
                  id={usernameId}
                  name="username"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value)
                    if (usernameError) setUsernameError('')
                  }}
                  autoFocus
                  autoComplete="username"
                  inputMode="text"
                  aria-invalid={Boolean(usernameError)}
                  aria-describedby={usernameError ? `${usernameId}-error` : undefined}
                  placeholder="Username or employee ID"
                />
              </div>
              {usernameError && <span id={`${usernameId}-error`} className="auth-field-error">{usernameError}</span>}
            </div>

            <div className="auth-field">
              <label className="sr-only" htmlFor={passwordId}>Password</label>
              <div className={`auth-input ${passwordError ? 'is-invalid' : ''}`}>
                <Icon name="lock" size={20} />
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
                  placeholder="Password"
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={20} />
                </button>
              </div>
              {passwordError && <span id={`${passwordId}-error`} className="auth-field-error">{passwordError}</span>}
              {!passwordError && capsLock && <span id={`${passwordId}-caps`} className="auth-caps"><Icon name="keyboard_capslock" size={15} /> Caps Lock is on</span>}
            </div>

            <div className="auth-options">
              <label className="auth-remember">
                <input type="checkbox" name="remember" />
                <span>Remember me</span>
              </label>
              <button className="auth-help-link" type="button" onClick={() => setShowHelp((value) => !value)} aria-expanded={showHelp}>
                Forgot password?
              </button>
            </div>

            {showHelp && (
              <div className="auth-help" role="note">
                <Icon name="support_agent" size={20} />
                <span><strong>Cannot access your account?</strong> Contact your system administrator to reset your password or confirm your employee ID.</span>
              </div>
            )}

            {error && (
              <div className="auth-error" role="alert">
                <Icon name="error" size={20} />
                <span>{error}</span>
              </div>
            )}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? <><span className="auth-spinner" /> Signing you in…</> : 'Login'}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
