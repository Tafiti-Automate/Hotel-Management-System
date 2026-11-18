import { useEffect, useId, useRef } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import './toast-feedback.css'

export default function ConfirmDialog() {
  const app = useApp()
  const target = app.confirm
  const titleId = useId()
  const messageId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const busyRef = useRef(app.confirmBusy)
  const closeRef = useRef(app.closeConfirm)
  busyRef.current = app.confirmBusy
  closeRef.current = app.closeConfirm

  useEffect(() => {
    if (!target) return
    previousFocus.current = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busyRef.current) closeRef.current()
      }
      if (event.key !== 'Tab') return
      const available = [cancelRef.current, deleteRef.current].filter(
        (button): button is HTMLButtonElement => Boolean(button && !button.disabled),
      )
      if (!available.length) return
      if (event.shiftKey && document.activeElement === available[0]) {
        event.preventDefault()
        available[available.length - 1].focus()
      } else if (!event.shiftKey && document.activeElement === available[available.length - 1]) {
        event.preventDefault()
        available[0].focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus.current?.focus()
    }
  }, [target?.entity, target?.id])

  if (!target) return null
  return <div className="mc-confirm-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !app.confirmBusy) app.closeConfirm()
  }}>
    <section className="mc-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} aria-busy={app.confirmBusy}>
      <span className="mc-confirm-icon" aria-hidden="true"><Icon name="delete" size={25}/></span>
      <h2 id={titleId}>Delete record?</h2>
      <p id={messageId}>Delete <strong>{target.name}</strong>? This action cannot be undone. Records used in approved or posted transactions may be protected.</p>
      <div className="mc-confirm-actions">
        <button ref={cancelRef} type="button" onClick={app.closeConfirm} disabled={app.confirmBusy}>Keep record</button>
        <button ref={deleteRef} type="button" className="mc-confirm-danger" onClick={app.doDelete} disabled={app.confirmBusy}>
          {app.confirmBusy ? 'Deleting…' : 'Delete record'}
        </button>
      </div>
    </section>
  </div>
}
