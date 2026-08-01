import { useEffect, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import RecordDetailDrawer from '../components/RecordDetailDrawer'
import { errorMessage, readBackendRecords } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

export default function AuditLog() {
  const app = useApp()
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedRow, setSelectedRow] = useState<Row | null>(null)
  const load = async () => {
    setLoading(true); setError('')
    try { setRows(await readBackendRecords('audit-logs?ordering=-created_at')) }
    catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  if (!app.user.isStaff && !app.user.isSuperuser) return <div style={notice}>You do not have authority to view the audit log.</div>
  const visible = rows.filter((row) => `${row.action} ${row.entity_type} ${row.entity_id}`.toLowerCase().includes(search.toLowerCase()))
  return <div style={{ maxWidth: 1400, margin: '0 auto' }}>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 15 }}><div><h1 style={{ margin: 0, fontSize: 23 }}>Audit log</h1><p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 12.5 }}>Recorded approvals, stock movements and controlled document deletions.</p></div><button onClick={() => void load()} style={{ ...button, marginLeft: 'auto' }}><Icon name="refresh" size={17} />Refresh</button></div>
    <div style={{ ...panel, padding: 10, marginBottom: 0 }}><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions, documents or IDs" style={input} /></div>
    <div style={{ ...panel, overflow: 'hidden', borderRadius: '0 0 8px 8px' }}>
      {error && <div style={{ padding: 20, color: 'var(--bad)' }}>{error}</div>}
      {loading && <div style={notice}>Loading audit evidence…</div>}
      {!loading && visible.map((row) => <button type="button" onClick={() => setSelectedRow(row)} className="procurement-record-row" key={String(row.id)} style={{ ...auditRow, width: '100%', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}><span style={{ fontWeight: 700, color: 'var(--text)' }}>{String(row.action).replace(/_/g, ' ')}</span><span>{String(row.entity_type)}</span><span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{String(row.entity_id || '—').slice(0, 12)}</span><span>{new Date(String(row.created_at)).toLocaleString()}</span><Icon name="chevron_right" size={18} color="var(--text-faint)" /></button>)}
      {!loading && !visible.length && <div style={notice}>No audit events match this view.</div>}
    </div>
    {selectedRow && <RecordDetailDrawer title="Audit event" subtitle={`${String(selectedRow.action || 'Action').replace(/_/g, ' ')} · ${String(selectedRow.entity_type || 'Record')}`} record={selectedRow} onClose={() => setSelectedRow(null)} />}
  </div>
}
const panel: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }
const input: CSSProperties = { width: 340, height: 36, border: '1px solid var(--border)', borderRadius: 6, padding: '0 10px', font: 'inherit', fontSize: 12 }
const button: CSSProperties = { height: 36, display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 12px', font: 'inherit' }
const auditRow: CSSProperties = { display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1fr 1.2fr 20px', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12 }
const notice: CSSProperties = { padding: 44, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12.5 }
