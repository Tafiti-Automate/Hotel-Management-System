import { useEffect, useId, useRef } from 'react'
import { Icon } from './Icon'
import './toast-feedback.css'

export type FeedbackTone = 'success' | 'failure' | 'warning'

interface FeedbackDialogProps {
  tone: FeedbackTone
  title?: string
  message: string
  details?: string[]
  onClose: () => void
}

const presentation: Record<FeedbackTone, { heading: string; button: string; icon: string }> = {
  success: { heading: 'Action completed', button: 'Done', icon: 'check_circle' },
  failure: { heading: 'Action could not be completed', button: 'Close', icon: 'error' },
  warning: { heading: 'Attention required', button: 'Understood', icon: 'warning' },
}

/**
 * Critical server errors and business-rule warnings should stay visible until
 * acknowledged. The action only dismisses the message; it never retries an
 * irreversible request or claims that an unsuccessful save succeeded.
 */
export default function FeedbackDialog({ tone, title, message, details = [], onClose }: FeedbackDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const view = presentation[tone]

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
      if (event.key === 'Tab') {
        // Single action dialog: keep keyboard focus inside the modal.
        event.preventDefault()
        closeRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      returnFocusRef.current?.focus()
    }
  }, [])

  return <div className="mc-alert-backdrop">
    <section className={`mc-alert-dialog mc-alert-${tone}`} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <span className="mc-alert-icon" aria-hidden="true"><Icon name={view.icon} size={24}/></span>
      <h2 id={titleId}>{title || view.heading}</h2>
      <p id={descriptionId}>{message}</p>
      {details.length > 0 && <ul className="mc-alert-details">
        {details.map((detail, index) => <li key={`${index}-${detail}`}>{detail}</li>)}
      </ul>}
      <div className="mc-alert-actions">
        <button ref={closeRef} type="button" onClick={onClose}>{view.button}</button>
      </div>
    </section>
  </div>
}
