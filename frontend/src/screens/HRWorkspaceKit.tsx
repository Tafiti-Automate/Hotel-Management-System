import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import { errorMessage, readBackendRecords } from '../lib/api'

export type HRRow = { id?: unknown; [key: string]: unknown }
export type HRData = Record<string, HRRow[]>
export const text = (value: unknown): string => value == null ? '' : String(value)
export const number = (value: unknown): number => Number(value || 0) || 0
export const currency = (value: unknown): string => number(value).toLocaleString('en-UG', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
export const today = (): string => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) }
export const year = (): number => new Date().getFullYear()
export const month = (): number => new Date().getMonth() + 1
export const dateLabel = (value: unknown): string => {
  const raw = text(value).slice(0, 10)
  if (!raw) return '—'
  const parts = raw.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : raw
}

export function useHRData(resources: string[]) {
  const key = resources.join('|')
  const [data, setData] = useState<HRData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const entries = await Promise.all(key.split('|').map(async resource => [resource, await readBackendRecords(resource)] as const))
      setData(Object.fromEntries(entries))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [key])
  useEffect(() => { void reload() }, [reload])
  return { data, loading, error, reload }
}

export function useHRAction(reload: () => Promise<void>) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const run = async (operation: () => Promise<unknown>, confirmation: string): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await operation()
      await reload()
      setMessage(confirmation)
      app.showToast(confirmation)
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, message, run }
}

export function HRPage({ eyebrow, title, description, children, right }: {
  eyebrow: string; title: string; description: string; children: ReactNode; right?: ReactNode
}) {
  return <div className="hr-workspace">
    <header className="hr-page-head">
      <div><p className="hr-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {right && <div className="hr-page-actions">{right}</div>}
    </header>
    {children}
  </div>
}

export function HRAlerts({ loading, error, message, retry }: {
  loading?: boolean; error?: string; message?: string; retry?: () => void
}) {
  return <>
    {loading && <div className="hr-notice" role="status">Loading authorized records…</div>}
    {error && <div className="hr-notice is-error" role="alert"><span>{error}</span>{retry && <button type="button" onClick={retry}>Retry</button>}</div>}
    {message && !error && <div className="hr-notice is-success" role="status">{message}</div>}
  </>
}

export function HRMetric({ label, value, help }: { label: string; value: string; help?: string }) {
  return <div className="hr-metric"><span>{label}</span><strong>{value}</strong>{help && <small>{help}</small>}</div>
}

export function HRStatus({ value }: { value: unknown }) {
  const status = text(value).toLowerCase()
  const variant = ['posted','approved','active','repaid'].includes(status) ? 'is-success'
    : ['rejected','cancelled','inactive'].includes(status) ? 'is-danger'
      : ['submitted','calculated','pending'].includes(status) ? 'is-warning' : ''
  return <span className={`hr-status ${variant}`}>{status.replace(/_/g, ' ') || '—'}</span>
}

export function HREmployeeOptions({ employees, includeBlank = true }: { employees: HRRow[]; includeBlank?: boolean }) {
  return <>
    {includeBlank && <option value="">Select employee</option>}
    {employees.map(e => <option key={text(e.id)} value={text(e.id)}>
      {text(e.first_name || e.name)} {text(e.last_name)} · {text(e.employee_code)}
    </option>)}
  </>
}
