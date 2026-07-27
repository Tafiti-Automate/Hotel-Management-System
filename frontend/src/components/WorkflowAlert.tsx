import { useApp } from '../state/AppContext'
import { Icon } from './Icon'

export default function WorkflowAlert() {
  const app = useApp()
  const alert = app.workflowAlert
  if (!alert) return null

  const blockers = alert.message
    .replace(/[{}[\]"]/g, '')
    .split(/\n|(?<=\.)\s+|;\s*/)
    .map((item) => item.replace(/^[^:]+:\s*/, '').trim())
    .filter(Boolean)

  return <>
    <div onClick={app.closeWorkflowAlert} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(15,23,42,.42)' }} />
    <section role="alertdialog" aria-modal="true" style={{ position: 'fixed', zIndex: 96, left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(480px,calc(100vw - 32px))', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, boxShadow: '0 20px 50px rgba(15,23,42,.2)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 7, display: 'grid', placeItems: 'center', background: 'var(--bad-soft)' }}><Icon name="block" size={21} color="var(--bad)" /></span>
        <div><h2 style={{ margin: 0, color: 'var(--text)', fontSize: 16, fontWeight: 650 }}>{alert.title}</h2><p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.5 }}>Complete the following requirement before trying again.</p></div>
      </div>
      <div style={{ padding: '15px 20px' }}>
        {blockers.map((blocker, index) => <div key={`${blocker}-${index}`} style={{ display: 'flex', gap: 9, padding: '8px 0', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.5 }}><Icon name="error" size={17} color="var(--bad)" style={{ marginTop: 1 }} /><span>{blocker}</span></div>)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border)', background: '#FBFCFD' }}><button onClick={app.closeWorkflowAlert} style={{ height: 36, border: 0, borderRadius: 6, padding: '0 14px', background: 'var(--accent)', color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600 }}>Understood</button></div>
    </section>
  </>
}
