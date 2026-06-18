import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import { buildReport } from '../lib/reports'

const exportBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 14px', border: '1px solid var(--border)',
  cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', borderRadius: 10, font: 'inherit',
  fontSize: 12.5, fontWeight: 700,
}

const filterChip: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 11px', border: '1px solid var(--border)',
  borderRadius: 9, background: 'var(--surface-2)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
}

export default function ReportView() {
  const app = useApp()
  if (!app.reportId) return null
  const report = buildReport(app.reportId, app.data)

  return (
    <div>
      <button onClick={app.backFromReport} className="hover-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0', marginBottom: 14 }}>
        <Icon name="arrow_back" size={19} />All reports
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--text)' }}>{report.title}</h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{report.subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button className="hover-surface2" style={exportBtn}><Icon name="picture_as_pdf" size={17} color="var(--text-muted)" />PDF</button>
          <button className="hover-surface2" style={exportBtn}><Icon name="table_view" size={17} color="var(--text-muted)" />Excel</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '11px 14px', marginBottom: 'var(--gap)', boxShadow: 'var(--shadow-sm)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Filters</span>
        <div style={filterChip}><Icon name="calendar_today" size={16} color="var(--text-faint)" />This month<Icon name="expand_more" size={16} color="var(--text-faint)" /></div>
        <div style={filterChip}><Icon name="warehouse" size={16} color="var(--text-faint)" />All stores<Icon name="expand_more" size={16} color="var(--text-faint)" /></div>
        <div style={filterChip}><Icon name="category" size={16} color="var(--text-faint)" />All categories<Icon name="expand_more" size={16} color="var(--text-faint)" /></div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: report.grid, borderBottom: '1px solid var(--border)', padding: '0 8px', background: 'var(--surface-2)' }}>
          {report.columns.map((col, i) => <div key={i} style={col.style}>{col.label}</div>)}
        </div>
        {report.rows.map((row, ri) => (
          <div key={ri} className="hover-surface2" style={{ display: 'grid', gridTemplateColumns: report.grid, borderBottom: '1px solid var(--border)', padding: '0 8px' }}>
            {row.cells.map((cell, ci) => <div key={ci} style={cell.style}>{cell.text}</div>)}
          </div>
        ))}
        {report.hasTotals && (
          <div style={{ display: 'grid', gridTemplateColumns: report.grid, padding: '0 8px', background: 'var(--surface-2)' }}>
            {report.totals.map((cell, ci) => <div key={ci} style={cell.style}>{cell.text}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}
