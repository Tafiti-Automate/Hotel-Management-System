import { useEffect, useRef, type CSSProperties } from 'react'
import { Icon } from './Icon'

export type FeedbackTone = 'success' | 'failure' | 'warning'

interface FeedbackDialogProps {
  tone: FeedbackTone
  title?: string
  message: string
  details?: string[]
  onClose: () => void
}

const presentations: Record<FeedbackTone, {
  heading: string
  button: string
  icon: string
  color: string
  soft: string
  shadow: string
}> = {
  success: {
    heading: 'Success!',
    button: 'Continue',
    icon: 'check',
    color: 'var(--good)',
    soft: 'var(--good-soft)',
    shadow: 'rgba(22,163,74,.3)',
  },
  failure: {
    heading: 'Failure',
    button: 'Try Again',
    icon: 'close',
    color: 'var(--bad)',
    soft: 'var(--bad-soft)',
    shadow: 'rgba(220,38,38,.3)',
  },
  warning: {
    heading: 'Attention',
    button: 'Review',
    icon: 'priority_high',
    color: 'var(--warn)',
    soft: 'var(--warn-soft)',
    shadow: 'rgba(217,119,6,.3)',
  },
}

export default function FeedbackDialog({ tone, title, message, details = [], onClose }: FeedbackDialogProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const view = presentations[tone]

  useEffect(() => {
    buttonRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const iconStyle: CSSProperties = {
    width: 66,
    height: 66,
    margin: '0 auto 16px',
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    background: `linear-gradient(145deg,color-mix(in srgb,${view.color} 76%,#fff),${view.color})`,
    border: '5px solid color-mix(in srgb,var(--surface) 72%,transparent)',
    boxShadow: `0 8px 20px ${view.shadow}, inset 0 1px 0 rgba(255,255,255,.5)`,
  }

  return <>
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 109, background: 'rgba(8,18,32,.58)', backdropFilter: 'blur(3px)' }} />
    <section
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`feedback-${tone}-heading`}
      aria-describedby={`feedback-${tone}-message`}
      style={{
        position: 'fixed',
        zIndex: 110,
        left: '50%',
        top: '50%',
        transform: 'translate(-50%,-50%)',
        width: 'min(410px,calc(100vw - 32px))',
        padding: '30px 28px 26px',
        textAlign: 'center',
        background: 'var(--surface)',
        border: '1px solid color-mix(in srgb,var(--border) 75%,#fff)',
        borderRadius: 24,
        boxShadow: '0 28px 80px rgba(3,18,35,.34)',
        animation: 'pop .2s ease',
      }}
    >
      <span style={iconStyle}><Icon name={view.icon} size={38} color="#fff" weight={750} /></span>
      <h2 id={`feedback-${tone}-heading`} style={{ margin: 0, color: 'var(--text)', fontSize: 26, lineHeight: 1.15, fontWeight: 750 }}>{view.heading}</h2>
      {title && <div style={{ marginTop: 12, color: 'var(--text)', fontSize: 15, lineHeight: 1.4, fontWeight: 750 }}>{title}</div>}
      <p id={`feedback-${tone}-message`} style={{ margin: title ? '6px auto 0' : '10px auto 0', maxWidth: 330, color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.55 }}>{message}</p>

      {details.length > 0 && <div style={{ marginTop: 14, padding: '9px 12px', borderRadius: 10, background: view.soft, textAlign: 'left' }}>
        {details.map((detail, index) => <div key={`${detail}-${index}`} style={{ display: 'flex', gap: 8, padding: '5px 0', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.45 }}>
          <Icon name="error" size={16} color={view.color} style={{ flex: 'none', marginTop: 1 }} />
          <span>{detail}</span>
        </div>)}
      </div>}

      <button
        ref={buttonRef}
        type="button"
        onClick={onClose}
        style={{
          width: '100%',
          height: 44,
          marginTop: 22,
          border: '3px solid color-mix(in srgb,var(--surface) 68%,transparent)',
          borderRadius: 999,
          background: `linear-gradient(180deg,color-mix(in srgb,${view.color} 72%,#fff),${view.color})`,
          color: '#fff',
          boxShadow: `0 7px 18px ${view.shadow}, inset 0 1px 0 rgba(255,255,255,.55)`,
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: '.04em',
          textTransform: 'uppercase',
        }}
      >{view.button}</button>
    </section>
  </>
}
