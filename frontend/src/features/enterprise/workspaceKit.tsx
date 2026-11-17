import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'
import { Icon } from '../../components/Icon'
import RecordDetailDrawer from '../../components/RecordDetailDrawer'
import {
  errorMessage, fetchCommandDocument, fetchDocumentAuditTimeline,
  readBackendRecords, searchGlobalCommands,
} from '../../lib/api'
import { useApp } from '../../state/AppContext'

export type ApiRow = { id?: string; [key: string]: unknown }
export const str = (value: unknown): string => value == null ? '' : String(value)
export const dec = (value: unknown): number => Number(value || 0) || 0
export const amount = (value: unknown): string => dec(value).toLocaleString('en-UG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
export const dateStr = (value: unknown): string => str(value).slice(0, 10) || '—'
const confidentialityRoles = new Set(['department supervisor','outlet supervisor','supervisor','receiving clerk'])
const redactSensitive = (record: ApiRow, role: string): ApiRow => {
  if (!confidentialityRoles.has(role.trim().toLowerCase())) return record
  const result: ApiRow = {}
  for (const [key, value] of Object.entries(record)) {
    if (/supplier.*(price|rate)|price|unit.cost|average.cost|wac|total.cost|stock.asset|quantity.in.stock|physical.soh|stock.on.hand|quantity.available|available.quantity/i.test(key)) {
      result[key] = 'Restricted'
    } else if (/^(items|lines|details)$/i.test(key) && Array.isArray(value)) {
      result[key] = value.map((row) => typeof row === 'object' && row !== null
        ? redactSensitive(row as ApiRow, role) : row)
    } else result[key] = value
  }
  return result
}

type DrawerRequest = { reference: string; record?: ApiRow; kind?: 'order'|'grn'|'transfer'|'article'|'requisition' }
type DrawerContextValue = { open: (request: DrawerRequest) => void }
const DrawerContext = createContext<DrawerContextValue | null>(null)

export function useDocumentDrawer(): DrawerContextValue {
  const value = useContext(DrawerContext)
  if (!value) throw new Error('DocumentDrawerProvider required')
  return value
}

export function DocumentDrawerProvider({ children }: { children: ReactNode }) {
  const { user } = useApp()
  const [request, setRequest] = useState<DrawerRequest | null>(null)
  const [record, setRecord] = useState<ApiRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const open = useCallback((req: DrawerRequest) => { setRequest(req); setError(''); setRecord(null) }, [])
  useEffect(() => {
    if (!request) return
    let active = true
    setLoading(true)
    void (async () => {
      try {
        const attachTimeline = async (document: ApiRow, kind?: DrawerRequest['kind']) => {
          const id = str(document.id)
          if (!id || !kind || kind === 'article' || !/^[0-9a-f-]{36}$/i.test(id)) {
            return redactSensitive(document, user.role)
          }
          try {
            const events = await fetchDocumentAuditTimeline(kind, id)
            return redactSensitive({ ...document, audit_timeline: events }, user.role)
          } catch {
            // The user's business record remains readable even where their
            // role is not entitled to its audit timeline.
            return redactSensitive({ ...document, audit_timeline: [] }, user.role)
          }
        }
        if (request.record) {
          const ready = await attachTimeline(request.record, request.kind)
          if (active) setRecord(ready)
          return
        }
        if (request.kind === 'requisition') {
          const [internal, external] = await Promise.all([
            readBackendRecords('store-requisitions').catch(() => []),
            readBackendRecords('requisitions').catch(() => []),
          ])
          const found = [...internal, ...external].find(row =>
            [row.id, row.requisition_no, row.requisition_number].some(value => str(value) === request.reference))
          if (!found) throw new Error('This requisition is not visible to your role.')
          const ready = await attachTimeline(found, 'requisition')
          if (active) setRecord(ready)
          return
        }
        const results = await searchGlobalCommands(request.reference)
        const hit = results.find(value => value.reference === request.reference
          && (!request.kind || value.kind === request.kind))
        if (!hit) throw new Error('No permitted matching document was returned by the server.')
        const doc = await fetchCommandDocument(hit)
        const ready = await attachTimeline(doc, hit.kind)
        if (active) setRecord(ready)
      } catch (cause) {
        if (active) setError(errorMessage(cause))
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [request, user.role])
  const value = useMemo(() => ({ open }), [open])
  return <DrawerContext.Provider value={value}>
    {children}
    {request && record && !loading && <RecordDetailDrawer
      title={request.reference} record={record} onClose={() => setRequest(null)}
      subtitle="Read-only transaction and audit details" />}
    {request && (loading || error) && <div className="mc-dialog-backdrop" role="presentation" onMouseDown={() => setRequest(null)}>
      <aside className="mc-mini-drawer" role="dialog" aria-modal="true" aria-label="Document details" onMouseDown={event => event.stopPropagation()}>
        <header><strong>{request.reference}</strong><button aria-label="Close details" onClick={() => setRequest(null)}><Icon name="close" size={18}/></button></header>
        <div className="mc-state">{loading ? 'Loading authorised document details…' : error}</div>
      </aside>
    </div>}
  </DrawerContext.Provider>
}

export function DocumentReference({ reference, kind, record, label }: DrawerRequest & { label?: string }) {
  const drawer = useDocumentDrawer()
  return <button type="button" className="mc-document-link" title={'Inspect ' + reference}
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); drawer.open({ reference, kind, record }) }}>
    {label || reference}<Icon name="open_in_new" size={12} />
  </button>
}

export function useBackendRows(paths: readonly string[]) {
  const [data, setData] = useState<Record<string, ApiRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const key = paths.join('|')
  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const pairs = await Promise.all(key.split('|').filter(Boolean).map(async path => [
        path, await readBackendRecords(path),
      ] as const))
      setData(Object.fromEntries(pairs))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally { setLoading(false) }
  }, [key])
  useEffect(() => { void reload() }, [reload])
  return { data, loading, error, reload, setError }
}

export function WorkspacePage({ section, title, subtitle, actions, children }: {
  section: string; title: string; subtitle: string; actions?: ReactNode; children: ReactNode
}) {
  return <div className="mc-enterprise">
    <header className="mc-workspace-head tw:flex tw:justify-between tw:items-center tw:gap-4 tw:flex-wrap">
      <div><div className="mc-section-path">{section}</div><h1>{title}</h1><p>{subtitle}</p></div>
      {actions && <div className="mc-toolbar-end">{actions}</div>}
    </header>
    {children}
  </div>
}

export function StateMessage({ loading, error, empty, children }: {
  loading?: boolean; error?: string; empty?: boolean; children?: ReactNode
}) {
  if (loading) return <div className="mc-load-state" role="status">
    <div className="mc-skeleton-row"/><div className="mc-skeleton-row"/><div className="mc-skeleton-row"/>
    <span>Loading current property records…</span>
  </div>
  if (error) return <div className="mc-alert" role="alert"><Icon name="error" size={18}/><span>{error}</span></div>
  if (empty) return <div className="mc-empty-state">
    <span className="mc-empty-icon"><Icon name="inbox" size={22}/></span>
    <strong>No records found</strong>
    <p>{children || 'No matching records for this property.'}</p>
  </div>
  return <>{children}</>
}

export function StatusPill({ status }: { status: unknown }) {
  const text = str(status).replace(/_/g, ' ') || 'Unknown'
  const tone = /booked|posted|approved|matched|complete|processed|active/i.test(text) ? 'ok'
    : /reject|closed|blocked|expired|overdue|exception|unmatched|variance/i.test(text) ? 'bad'
      : /transit|issued|dispatch|receiv/i.test(text) ? 'info'
        : 'warn'
  return <span className={'mc-status mc-status-' + tone}>{text}</span>
}

export function FormField({ label, value, onChange, type = 'text', disabled, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; type?: string
  disabled?: boolean; placeholder?: string
}) {
  return <label className="mc-field"><span>{label}</span><input type={type} value={value}
    disabled={disabled} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>
}

/**
 * Enhance plain document references in legacy tables without mutating the DOM
 * or overriding buttons, links, forms and editable controls.
 * Clickable reference cells use the same audited, permission-scoped drawer.
 */
export function EnterpriseDocumentHotspots({ children }: { children: ReactNode }) {
  const drawer = useDocumentDrawer()
  const inspect = (event: import('react').MouseEvent<HTMLElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('a,button,input,select,textarea,[role=button],[contenteditable]')) return
    const cell = target.closest('td, th, strong, .neo-list-number')
    if (!(cell instanceof HTMLElement)) return
    const text = str(cell.textContent).trim()
    const matched = /^(?:LPO|PO|GRN|TRF|REQ|PR|R|SI)-[a-z0-9][a-z0-9-]*$/i.exec(text)
    if (!matched) return
    event.preventDefault(); event.stopPropagation()
    const prefix = matched[0].split('-')[0].toUpperCase()
    const kind = prefix === 'PO' || prefix === 'LPO' ? 'order'
      : prefix === 'GRN' ? 'grn'
      : prefix === 'PR' || prefix === 'REQ' || prefix === 'R' ? 'requisition'
      : 'transfer'
    drawer.open({ reference: matched[0], kind })
  }
  return <div className="mc-document-hotspots" onClickCapture={inspect}>{children}</div>
}
