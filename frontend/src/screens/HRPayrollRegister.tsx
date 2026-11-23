import { useEffect, useMemo, useState } from 'react'
import { getToken } from '../lib/api'
import { currency, text } from './HRWorkspaceKit'

type RegisterKind = 'text' | 'date' | 'number' | 'money'
type RegisterColumn = { key: string; label: string; kind: RegisterKind; width: number }
type RegisterCell = string | number | null
type RegisterLine = Record<string, RegisterCell>
type RegisterLayout = {
  period: string; period_label: string; property: string; status: string; currency: string
  columns: RegisterColumn[]; rows: RegisterLine[]; totals: Record<string, RegisterCell>
  notes: string[]; unconfirmed: string[]
}

const apiBase = () => (process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1').replace(/\/+$/, '')
const registerEndpoint = (id: string, action: string) =>
  `${apiBase()}/payroll-periods/${encodeURIComponent(id)}/${action}/`

function displayCell(value: RegisterCell | undefined, kind: RegisterKind): string {
  if (value === undefined || value === null || value === '') return '—'
  if (kind === 'money') return currency(value)
  if (kind === 'number') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric.toLocaleString('en-UG', { maximumFractionDigits: 2 }) : text(value)
  }
  if (kind === 'date') {
    const [y, m, d] = text(value).split('-')
    return y && m && d ? `${d}/${m}/${y}` : text(value)
  }
  return text(value)
}

function FileButtons({ busy, disabled, exportFile, print }: {
  busy: boolean; disabled: boolean
  exportFile: (kind: 'register.csv' | 'register.xlsx') => void; print: () => void
}) {
  return <div className="hr-register-actions">
    <button className="hr-btn primary" type="button" disabled={busy || disabled} onClick={() => exportFile('register.xlsx')}>Download Excel (.xlsx)</button>
    <button className="hr-btn" type="button" disabled={busy || disabled} onClick={() => exportFile('register.csv')}>Download CSV</button>
    <button className="hr-btn" type="button" disabled={busy || disabled} onClick={print}>Print landscape register</button>
  </div>
}

export default function HRPayrollRegister({ periodId, periodStatus, onPayslip }: {
  periodId: string; periodStatus: string; onPayslip?: (entryId: string) => void
}) {
  const [layout, setLayout] = useState<RegisterLayout | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [employeeFilter, setEmployeeFilter] = useState('')

  useEffect(() => {
    if (!periodId) { setLayout(null); setError(''); setLoading(false); return }
    const controller = new AbortController()
    const load = async () => {
      setLoading(true); setError(''); setLayout(null)
      try {
        const token = getToken()
        if (!token) throw new Error('Payroll session expired. Please sign in again.')
        const response = await fetch(registerEndpoint(periodId, 'register-layout'), {
          headers: { Authorization: `Token ${token}`, Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!response.ok) {
          const json = await response.json().catch(() => ({})) as { detail?: string }
          throw new Error(json.detail || `Could not load the payroll register (${response.status}).`)
        }
        const data = await response.json() as RegisterLayout
        if (!controller.signal.aborted) setLayout(data)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Payroll register could not be loaded.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [periodId, periodStatus, revision])

  const query = employeeFilter.trim().toLocaleLowerCase()
  const rows = useMemo(() => !layout ? [] : layout.rows.filter((row) =>
    !query || [row.department_and_name, row.dept_section].some(value => text(value).toLocaleLowerCase().includes(query)),
  ), [layout, query])

  const exportFile = async (kind: 'register.csv' | 'register.xlsx') => {
    if (!periodId || periodStatus === 'draft' || busy) return
    setBusy(true); setError('')
    try {
      const token = getToken()
      if (!token) throw new Error('Payroll session expired. Please sign in again.')
      const response = await fetch(registerEndpoint(periodId, kind), {
        headers: { Authorization: `Token ${token}` },
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as {detail?:string}
        throw new Error(body.detail || `Register export failed (${response.status}).`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `payroll-register-${layout?.period_label || periodId}.${kind.endsWith('.xlsx') ? 'xlsx' : 'csv'}`
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to export register.')
    } finally {
      setBusy(false)
    }
  }
  const print = () => { if (layout && periodStatus !== 'draft') window.print() }

  const headings = layout?.columns || []
  // Printed report repeats employee identity on each landscape page and
  // splits the 32-column reference into three legible sections.
  const printPages = [
    { title: 'Employee details and earnings', columns: headings.slice(2, 13) },
    { title: 'Allowances and statutory contributions', columns: headings.slice(13, 23) },
    { title: 'Deductions and net pay', columns: headings.slice(23) },
  ]

  return <section className="hr-register-root hr-panel" aria-label="Client payroll register">
    <header className="hr-register-head">
      <div><h2>Client-format payroll register</h2>
        <p>Original column order · all figures in UGX · horizontally scroll to review</p>
      </div>
      <div className="hr-register-actions">
        <label className="hr-register-search">Find employee
          <input type="search" placeholder="Name or department" value={employeeFilter} onChange={event => setEmployeeFilter(event.target.value)} />
        </label>
        <button type="button" className="hr-btn" onClick={() => setRevision(value => value + 1)} disabled={loading || busy}>Refresh register</button>
        {layout && <FileButtons busy={busy} disabled={periodStatus === 'draft'} exportFile={kind => void exportFile(kind)} print={print}/>}
      </div>
    </header>
    {loading && <p className="hr-register-hint" role="status">Loading the official payroll register…</p>}
    {error && <p className="hr-register-error" role="alert">{error}</p>}
    {!periodId && <p className="hr-empty">Open or select a payroll period to review the register.</p>}
    {layout && <>
      <div className="hr-register-metadata"><span>{layout.property} · {layout.period_label}</span><strong>{layout.status.toUpperCase()} · {layout.currency}</strong><span>{rows.length} of {layout.rows.length} employees</span></div>
      <div className="hr-register-scroll" tabIndex={0} role="region" aria-label="Scrollable payroll register table">
        <table className="hr-reference-table">
          <thead><tr>{headings.map((column, index) =>
            <th key={column.key} scope="col" title={column.label}
              className={`hr-register-column-${index < 2 ? index : 'normal'} ${layout.unconfirmed.includes(column.key) ? 'is-unconfirmed' : ''}`}>
              {column.label}
            </th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={text(row.serial)}>
            {headings.map((column, colIndex) => <td key={column.key}
              className={`hr-register-column-${colIndex < 2 ? colIndex : 'normal'} ${column.kind === 'money' || column.kind === 'number' ? 'is-number' : ''} ${layout.unconfirmed.includes(column.key) ? 'is-unconfirmed' : ''}`}>
              {column.key === 'department_and_name' && periodStatus === 'posted' && onPayslip && row.entry_id
                ? <button type="button" className="hr-register-employee" onClick={() => onPayslip(text(row.entry_id))} title="Open posted payslip">{displayCell(row[column.key], column.kind)}</button>
                : displayCell(row[column.key], column.kind)}
            </td>)}
          </tr>)}
          {!rows.length && <tr><td colSpan={headings.length} className="hr-empty">No calculated employee records match this search.</td></tr>}
          </tbody>
          <tfoot><tr>{headings.map((column) => <td key={column.key} className={column.kind==='money'?'is-number':''}>
            {column.key === 'department_and_name' ? 'FULL PERIOD TOTAL' : column.key in layout.totals ? displayCell(layout.totals[column.key], column.kind) : ''}
          </td>)}</tr></tfoot>
        </table>
      </div>
      <p className="hr-register-hint">The total is for the full payroll period, even when search filters the displayed employees. Blank columns indicate unconfirmed client formulas.</p>
      <details className="hr-register-notes"><summary>Calculation notes & fields requiring client confirmation ({layout.notes.length})</summary>
        <ol>{layout.notes.map(note => <li key={note}>{note}</li>)}</ol>
      </details>
      <div className="hr-register-print" aria-hidden="true">
        {printPages.map((page, index) => <section className="hr-register-print-page" key={page.title}>
          <h1>HOTEL ERP · PAYROLL REGISTER</h1>
          <p>{layout.property} · {layout.period_label} · {page.title} (page {index + 1} of {printPages.length})</p>
          <table><thead><tr>{[...headings.slice(0, 2), ...page.columns].map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{layout.rows.map(row => <tr key={text(row.serial)}>{[...headings.slice(0, 2), ...page.columns].map(c =>
              <td key={c.key} className={c.kind === 'money' || c.kind === 'number' ? 'is-number' : ''}>{displayCell(row[c.key], c.kind)}</td>,
            )}</tr>)}
              <tr className="hr-print-totals">{[...headings.slice(0, 2), ...page.columns].map(c => <td key={c.key}>
                {c.key === 'department_and_name' ? 'TOTAL' : c.key in layout.totals ? displayCell(layout.totals[c.key], c.kind) : ''}
              </td>)}</tr>
            </tbody></table>
          {index === printPages.length - 1 && <div className="hr-print-notes">{layout.notes.map(n => <p key={n}>{n}</p>)}</div>}
        </section>)}
      </div>
    </>}
  </section>
}
