import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { canViewReport, reportIdsForUser } from '../lib/access'
import { reports, type ReportCard } from '../lib/data'
import { useApp } from '../state/AppContext'

function scopeForRole(role: string) {
  const key = role.trim().toLowerCase()
  if (key === 'requester') return 'My requests'
  if (key === 'department head') return 'My department'
  if (key === 'store keeper') return 'Assigned stores'
  if (key === 'cost controller') return 'Procurement controls'
  if (key === 'system administrator') return 'Permitted properties'
  return 'Current property'
}

function documentLabel(report: ReportCard) {
  if (report.controlledDocument === 'lpo') return 'Controlled LPO'
  if (report.controlledDocument === 'grn') return 'GRN document'
  return 'Operational report'
}

export default function Reports() {
  const app = useApp()
  const [search, setSearch] = useState('')
  const allowedIds = reportIdsForUser(app.user)
  const visibleReports = useMemo(() => {
    const permitted = allowedIds.includes('*') ? reports : reports.filter((report) => canViewReport(app.user, report.id))
    const query = search.trim().toLowerCase()
    if (!query) return permitted
    return permitted.filter((report) => [report.title, report.desc, report.grp].some((value) => value.toLowerCase().includes(query)))
  }, [allowedIds, app.user, search])
  const scope = scopeForRole(app.user.role)

  return (
    <div className="enterprise-workspace reports-screen">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--text)' }}>Reports</h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Reports available to {app.user.role}. Access follows your assigned role and property responsibilities.
          </p>
        </div>
        <div style={{ minWidth: 270, maxWidth: 360, flex: '1 1 290px', position: 'relative' }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reports"
            aria-label="Search reports"
            style={{ width: '100%', height: 40, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--text)', padding: '0 38px 0 38px', font: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear report search" style={{ position: 'absolute', right: 8, top: 7, width: 26, height: 26, border: 0, borderRadius: 7, background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              <Icon name="close" size={17} color="var(--text-muted)" />
            </button>
          )}
          <span style={{ position: 'absolute', left: 12, top: 11, pointerEvents: 'none' }}><Icon name="search" size={18} color="var(--text-faint)" /></span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: 'var(--text-muted)', fontSize: 12.5 }}>
        <span style={{ padding: '4px 9px', border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 20, fontWeight: 700, color: 'var(--text)' }}>{visibleReports.length} report{visibleReports.length === 1 ? '' : 's'}</span>
        <span>PDF, Excel and CSV downloads are available from each report.</span>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        <div className="reports-index-header" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,2.1fr) minmax(120px,.8fr) minmax(130px,.9fr) minmax(150px,1fr) 92px', gap: 12, padding: '11px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
          {['Report', 'Area', 'Scope', 'Output', ''].map((label) => <div key={label || 'action'} style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.035em' }}>{label}</div>)}
        </div>

        {visibleReports.map((report) => (
          <button
            key={report.id}
            type="button"
            onClick={() => app.openReport(report.id)}
            className="reports-index-row hover-surface2"
            style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(260px,2.1fr) minmax(120px,.8fr) minmax(130px,.9fr) minmax(150px,1fr) 92px', gap: 12, alignItems: 'center', padding: '13px 16px', background: 'var(--surface)', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
          >
            <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                <Icon name={report.icon} size={19} color="var(--accent)" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>{report.title}</span>
                  {report.controlledDocument && <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))', padding: '2px 6px', borderRadius: 20 }}>{documentLabel(report)}</span>}
                </div>
                <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.45, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{report.desc}</div>
              </div>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-muted)' }}>{report.grp}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{scope}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {['PDF', 'Excel', 'CSV'].map((format) => <span key={format} style={{ fontSize: 10.5, fontWeight: 750, color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'var(--surface-2)', padding: '3px 6px', borderRadius: 6 }}>{format}</span>)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 5, color: 'var(--accent)', fontSize: 12.5, fontWeight: 800 }}>Open <Icon name="arrow_forward" size={17} /></div>
          </button>
        ))}

        {!visibleReports.length && (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, margin: '0 auto 10px', borderRadius: 12, background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }}><Icon name="search_off" size={22} color="var(--text-faint)" /></div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>No reports found</div>
            <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--text-muted)' }}>Try a different report name or area.</div>
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 900px) {
          .reports-index-header { display: none !important; }
          .reports-index-row { grid-template-columns: 1fr auto !important; gap: 8px 12px !important; }
          .reports-index-row > div:nth-child(1) { grid-column: 1 / -1; }
          .reports-index-row > div:nth-child(2),
          .reports-index-row > div:nth-child(3),
          .reports-index-row > div:nth-child(4) { font-size: 11.5px !important; }
          .reports-index-row > div:nth-child(5) { grid-column: 2; grid-row: 2 / span 2; }
        }
        @media (max-width: 560px) {
          .reports-index-row { grid-template-columns: 1fr !important; }
          .reports-index-row > div:nth-child(5) { grid-column: 1; grid-row: auto; justify-content: flex-start !important; }
        }
      `}</style>
    </div>
  )
}
