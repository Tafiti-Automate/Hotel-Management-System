import { FormEvent, KeyboardEvent, useId, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'The hotel server could not be reached. Check your connection and try again.'
  if (/\b404\b|not found/i.test(message)) return 'The authentication service is unavailable. Contact your system administrator.'
  if (/invalid credentials/i.test(message)) return 'The username, employee ID, or password is incorrect.'
  return message || 'We could not sign you in. Please try again.'
}

export default function Login() {
  const { login, authMessage } = useApp()
  const usernameId = useId()
  const passwordId = useId()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [usernameError, setUsernameError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [error, setError] = useState('')
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
    setError('')
    if (nextUsernameError || nextPasswordError) return

    setBusy(true)
    try {
      await login(cleanUsername, password, remember)
    } catch (reason) {
      setError(friendlyError(reason))
    } finally {
      setBusy(false)
    }
  }

  const detectCaps = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState('CapsLock'))

  return <main className="neo-auth-page">
    <section className="neo-auth-brand" aria-label="Hotel ERP">
      <div className="neo-auth-brand-top">
        <span className="neo-auth-logo"><Icon name="hotel" size={24} color="#fff" fill /></span>
        <span><strong>Hotel ERP</strong><small>Operations & administration</small></span>
      </div>

      <div className="neo-auth-brand-copy">
        <span className="neo-auth-kicker">Hotel operations system</span>
        <h1>One workspace for every operational shift.</h1>
        <p>Access your property’s stores, purchasing, finance and workflow controls from one governed system.</p>
        <div className="neo-auth-access-note">
          <Icon name="verified_user" size={18} />
          <span><strong>Authorised staff access</strong><small>Your available tools are determined by your assigned role and property.</small></span>
        </div>
      </div>

      <footer><span>Hotel Operations ERP</span><span>Internal staff access only</span></footer>
    </section>

    <section className="neo-auth-form-panel">
      <div className="neo-auth-form-wrap">
        <header className="neo-auth-form-heading">
          <span className="neo-auth-mobile-logo"><Icon name="hotel" size={21} color="#fff" fill /></span>
          <div><span>Staff access</span><h2>Sign in</h2><p>Use your staff username or employee ID to continue.</p></div>
        </header>

        {authMessage && <div className="neo-auth-notice"><Icon name="info" size={18} /><span>{authMessage}</span></div>}
        {error && <div className="neo-auth-error" role="alert"><Icon name="error" size={18} /><span>{error}</span></div>}

        <form className="neo-auth-form" onSubmit={submit} noValidate>
          <label htmlFor={usernameId}>Username or employee ID</label>
          <div className={`neo-auth-input ${usernameError ? 'is-error' : ''}`}>
            <Icon name="person" size={19} />
            <input
              id={usernameId}
              name="username"
              value={username}
              onChange={(event) => { setUsername(event.target.value); if (usernameError) setUsernameError('') }}
              autoFocus
              autoCapitalize="none"
              autoComplete="username"
              spellCheck={false}
              aria-invalid={Boolean(usernameError)}
              placeholder="e.g. admin or EMP-001"
            />
          </div>
          {usernameError && <small className="neo-field-error">{usernameError}</small>}

          <div className="neo-auth-password-label"><label htmlFor={passwordId}>Password</label><button type="button" onClick={() => setShowHelp((value) => !value)}>Need help?</button></div>
          <div className={`neo-auth-input ${passwordError ? 'is-error' : ''}`}>
            <Icon name="lock" size={19} />
            <input
              id={passwordId}
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => { setPassword(event.target.value); if (passwordError) setPasswordError('') }}
              onKeyDown={detectCaps}
              onKeyUp={detectCaps}
              onBlur={() => setCapsLock(false)}
              autoComplete="current-password"
              aria-invalid={Boolean(passwordError)}
              placeholder="Enter your password"
            />
            <button className="neo-auth-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}><Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} /></button>
          </div>
          {passwordError && <small className="neo-field-error">{passwordError}</small>}
          {!passwordError && capsLock && <small className="neo-caps-warning"><Icon name="keyboard_capslock" size={14} />Caps Lock is on</small>}

          {showHelp && <div className="neo-auth-help"><Icon name="support_agent" size={18} /><span><strong>Access problem?</strong><small>Contact your system administrator to reset your staff credentials or verify your account status.</small></span></div>}

          <label className="neo-auth-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Keep me signed in on this device</span></label>

          <button type="submit" className="neo-auth-submit" disabled={busy}>
            {busy ? <><span className="neo-button-spinner" />Signing in…</> : <>Sign in <Icon name="arrow_forward" size={18} /></>}
          </button>
        </form>

        <div className="neo-auth-security"><Icon name="shield" size={16} /><span>Your session is protected and automatically expires after inactivity.</span></div>
      </div>
    </section>
  </main>
}
