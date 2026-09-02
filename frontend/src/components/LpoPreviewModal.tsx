import { useEffect, useState, type CSSProperties } from 'react'
import { errorMessage, fetchPurchaseOrderPreview } from '../lib/api'
import { Icon } from './Icon'

interface LpoPreviewModalProps {
  orderId: string
  reference: string
  onClose: () => void
}

export default function LpoPreviewModal({ orderId, reference, onClose }: LpoPreviewModalProps) {
  const [previewUrl, setPreviewUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let objectUrl = ''
    setPreviewUrl('')
    setError('')
    void fetchPurchaseOrderPreview(orderId)
      .then((url) => {
        objectUrl = url
        if (active) setPreviewUrl(url)
        else URL.revokeObjectURL(url)
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason))
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [orderId])

  return (
    <>
      <div onClick={onClose} style={backdrop} />
      <section role="dialog" aria-modal="true" aria-label={`Preview LPO ${reference}`} style={modal}>
        <header style={header}>
          <span style={iconBox}><Icon name="description" size={21} color="var(--accent)" /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: 'var(--text)', fontSize: 15, fontWeight: 800 }}>LPO {reference}</div>
            <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11.5 }}>Preview only · controlled copy numbering applies to printed or downloaded output</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close LPO preview" style={closeButton}><Icon name="close" size={19} /></button>
        </header>
        <div style={viewer}>
          {!previewUrl && !error && <div style={message}><Icon name="progress_activity" size={24} color="var(--accent)" /><span>Preparing the LPO preview…</span></div>}
          {error && <div role="alert" style={{ ...message, color: 'var(--bad)' }}><Icon name="error" size={24} color="var(--bad)" /><strong>Preview unavailable</strong><span style={{ maxWidth: 520, textAlign: 'center', fontWeight: 500 }}>{error}</span></div>}
          {previewUrl && <iframe title={`LPO ${reference} preview`} src={`${previewUrl}#toolbar=1&navpanes=0`} style={{ width: '100%', height: '100%', border: 0, background: '#eef1f5' }} />}
        </div>
      </section>
    </>
  )
}

const backdrop: CSSProperties = { position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(15,23,42,.68)' }
const modal: CSSProperties = { position: 'fixed', inset: '24px', zIndex: 111, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', boxShadow: '0 24px 70px rgba(15,23,42,.35)' }
const header: CSSProperties = { minHeight: 66, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }
const iconBox: CSSProperties = { width: 38, height: 38, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 8, background: 'var(--accent-soft)' }
const closeButton: CSSProperties = { width: 34, height: 34, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--text-muted)', cursor: 'pointer' }
const viewer: CSSProperties = { position: 'relative', flex: 1, minHeight: 0, background: '#eef1f5' }
const message: CSSProperties = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13, fontWeight: 700 }
