import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * Confirmation barrier for irreversible workflow transitions.
 * The existing Django action remains responsible for permission and status checks.
 */
export default function ConfirmTransaction({
  title, description, confirmLabel, disabled, busy, onConfirm, className, children,
}: {
  title: string
  description: string
  confirmLabel: string
  disabled?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<unknown>
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const dialogTitleId = useId()
  const dialogDescriptionId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const confirm = () => {
    if (busy || disabled) return
    setOpen(false)
    triggerRef.current?.focus()
    void onConfirm()
  }

  return <>
    <button ref={triggerRef} type="button" className={className} disabled={disabled || busy} onClick={() => setOpen(true)}>{children}</button>
    {open && <div className="neo-transaction-overlay" onMouseDown={(event) => { if (event.currentTarget === event.target) close() }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby={dialogTitleId} aria-describedby={dialogDescriptionId} className="neo-transaction-dialog" onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        if (event.shiftKey && document.activeElement === cancelRef.current) { event.preventDefault(); confirmRef.current?.focus() }
        if (!event.shiftKey && document.activeElement === confirmRef.current) { event.preventDefault(); cancelRef.current?.focus() }
      }}>
        <h2 id={dialogTitleId}>{title}</h2>
        <p id={dialogDescriptionId}>{description}</p>
        <div className="neo-transaction-actions">
          <button ref={cancelRef} type="button" onClick={close}>Cancel</button>
          <button ref={confirmRef} type="button" onClick={confirm} disabled={disabled || busy}>{confirmLabel}</button>
        </div>
      </section>
    </div>}
  </>
}
