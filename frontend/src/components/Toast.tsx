import { useEffect } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import './toast-feedback.css'

export default function Toast() {
  const app = useApp()
  const message = app.toast

  useEffect(() => {
    if (!message) return
    const timeout = window.setTimeout(app.closeToast, 5500)
    return () => window.clearTimeout(timeout)
  }, [message, app.closeToast])

  if (!message) return null
  return <aside className="mc-feedback-toast" role="status" aria-live="polite" aria-atomic="true">
    <span className="mc-feedback-toast-icon" aria-hidden="true"><Icon name="check_circle" size={22} /></span>
    <div className="mc-feedback-toast-copy">
      <strong>Action completed</strong>
      <span>{message}</span>
    </div>
    <button type="button" onClick={app.closeToast} aria-label="Dismiss notification" title="Dismiss notification">
      <Icon name="close" size={18} />
    </button>
    <span className="mc-feedback-toast-progress" aria-hidden="true" style={{ animationDuration: "5500ms" }} />
  </aside>
}
