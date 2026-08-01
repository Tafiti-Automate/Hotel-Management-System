import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { chipStyleFor } from '../lib/theme'
import { Icon } from './Icon'

type DetailRecord = Record<string, unknown>

interface RecordDetailDrawerProps {
  title: string
  record: DetailRecord
  onClose: () => void
  subtitle?: string
  preferredKeys?: string[]
  labels?: Record<string, string>
  actions?: ReactNode
}

const hiddenKeys = new Set(['apiId'])

export default function RecordDetailDrawer({
  title,
  record,
  onClose,
  subtitle,
  preferredKeys = [],
  labels = {},
  actions,
}: RecordDetailDrawerProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const orderedKeys = [
    ...preferredKeys,
    ...Object.keys(record).filter((key) => !preferredKeys.includes(key)),
  ].filter((key, index, keys) => keys.indexOf(key) === index && !hiddenKeys.has(key))
  const simpleKeys = orderedKeys.filter((key) => !isCollection(record[key]) && !isObject(record[key]))
  const complexKeys = orderedKeys.filter((key) => isCollection(record[key]) || isObject(record[key]))
  const status = String(record.status || '')
  const reference = String(record.id || record.name || record.reference || '')

  return (
    <>
      <div className="record-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} />
      <aside className="record-detail-drawer" role="dialog" aria-modal="true" aria-label={`${title} details`}>
        <header style={headerStyle}>
          <span style={{ width: 42, height: 42, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 9, color: 'var(--accent)', background: 'var(--accent-soft)' }}>
            <Icon name="description" size={22} />
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>{title}</span>
            <span style={{ display: 'block', marginTop: 3, overflow: 'hidden', color: 'var(--text)', fontSize: 18, fontWeight: 800, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle || reference || 'Record details'}</span>
          </span>
          {status && <span style={chipStyleFor(displayValue(status))}>{displayValue(status)}</span>}
          <button type="button" onClick={onClose} title="Close details" aria-label="Close details" className="hover-surface2" style={closeButton}><Icon name="close" size={19} /></button>
        </header>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          <div style={{ marginBottom: 12, color: 'var(--text-muted)', fontSize: 11.5 }}>Complete information for the selected row.</div>
          <section className="record-detail-grid">
            {simpleKeys.map((key) => (
              <div key={key} style={fieldStyle}>
                <div style={labelStyle}>{labels[key] || humanise(key)}</div>
                <div style={valueStyle}>{displayValue(record[key])}</div>
              </div>
            ))}
            {!simpleKeys.length && <div style={{ gridColumn: '1 / -1', padding: 22, color: 'var(--text-faint)', textAlign: 'center', fontSize: 12 }}>No simple fields are available for this record.</div>}
          </section>

          {complexKeys.map((key) => (
            <DetailCollection key={key} title={labels[key] || humanise(key)} value={record[key]} />
          ))}
        </div>

        {actions && <footer style={{ marginTop: 'auto', padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>{actions}</footer>}
      </aside>
    </>
  )
}

function DetailCollection({ title, value }: { title: string; value: unknown }) {
  const values = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
  if (!values.length) return null
  const objectRows = values.filter((row): row is DetailRecord => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
  const primitiveRows = values.filter((row) => !row || typeof row !== 'object')
  const columns = objectRows.length
    ? Array.from(new Set(objectRows.flatMap((row) => Object.keys(row)))).filter((key) => !hiddenKeys.has(key)).slice(0, 6)
    : []

  return <section style={{ marginTop: 18 }}>
    <div style={{ marginBottom: 8, color: 'var(--text)', fontSize: 12.5, fontWeight: 800 }}>{title} <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>({values.length})</span></div>
    {objectRows.length > 0 && <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ minWidth: Math.max(420, columns.length * 130) }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length},minmax(120px,1fr))`, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          {columns.map((column) => <div key={column} style={{ padding: '8px 10px', color: 'var(--text-faint)', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>{humanise(column)}</div>)}
        </div>
        {objectRows.map((row, index) => <div key={String(row.id || index)} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length},minmax(120px,1fr))`, borderBottom: index < objectRows.length - 1 ? '1px solid var(--border)' : undefined }}>
          {columns.map((column) => <div key={column} style={{ padding: '9px 10px', overflow: 'hidden', color: 'var(--text-muted)', fontSize: 10.5, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayValue(row[column])}</div>)}
        </div>)}
      </div>
    </div>}
    {primitiveRows.length > 0 && <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 11.5, lineHeight: 1.6 }}>{primitiveRows.map(displayValue).join(', ')}</div>}
  </section>
}

function isCollection(value: unknown): boolean {
  return Array.isArray(value)
}

function isObject(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function humanise(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-UG') : '—'
  if (typeof value === 'object') return Array.isArray(value) ? `${value.length} records` : 'Related information'
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }
  return text.includes('_') ? humanise(text) : text
}

const headerStyle: CSSProperties = {
  minHeight: 76,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '14px 18px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--surface)',
}

const closeButton: CSSProperties = {
  width: 32,
  height: 32,
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  border: 0,
  borderRadius: 7,
  background: 'var(--surface-2)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
}

const fieldStyle: CSSProperties = {
  minHeight: 70,
  padding: 12,
  borderRight: '1px solid var(--border)',
  borderBottom: '1px solid var(--border)',
}

const labelStyle: CSSProperties = {
  color: 'var(--text-faint)',
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
}

const valueStyle: CSSProperties = {
  marginTop: 6,
  overflowWrap: 'anywhere',
  color: 'var(--text)',
  fontSize: 12,
  fontWeight: 650,
  lineHeight: 1.45,
}
