import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { canViewReport, reportIdsForUser } from '../lib/access'
import { reports, type ReportCard } from '../lib/data'
import { useApp } from '../state/AppContext'

function scopeForRole(role: string) {
  const key = role.trim().toLowerCase()
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
  const [selectedArea, setSelectedArea] = useState('All')
  const allowedIds = reportIdsForUser(app.user)
  const scope = scopeForRole(app.user.role)

  const permittedReports = useMemo(
    () => allowedIds.includes('*') ? reports : reports.filter((report) => canViewReport(app.user, report.id)),
    [allowedIds, app.user],
  )
  const areas = useMemo(
    () => Array.from(new Set(permittedReports.map((report) => report.grp))).sort((a, b) => a.localeCompare(b)),
    [permittedReports],
  )
  const activeArea = selectedArea === 'All' || areas.includes(selectedArea) ? selectedArea : 'All'
  const visibleReports = useMemo(() => {
    const query = search.trim().toLowerCase()
    return permittedReports.filter((report) => {
      if (activeArea !== 'All' && report.grp !== activeArea) return false
      if (!query) return true
      return [report.title, report.desc, report.grp].some((value) => value.toLowerCase().includes(query))
    })
  }, [activeArea, permittedReports, search])

  return (
    <div className="enterprise-workspace reports-screen">
      <header className="reports-page-header">
        <div>
          <div className="reports-page-eyebrow">{app.user.role} · Reporting</div>
          <h1>Reports</h1>
          <p>Only reports assigned to your role and working scope are shown here.</p>
        </div>
        <div className="reports-search-box">
          <Icon name="search" size={18} color="var(--text-faint)" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reports, areas or documents"
            aria-label="Search reports"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear report search">
              <Icon name="close" size={17} />
            </button>
          )}
        </div>
      </header>

      <section className="reports-overview-grid" aria-label="Report overview">
        <ReportMetric label="Available reports" value={String(permittedReports.length)} icon="analytics" />
        <ReportMetric label="Report areas" value={String(areas.length)} icon="category" />
        <ReportMetric label="Current scope" value={scope} icon="visibility" compact />
        <ReportMetric label="Exports" value="PDF · Excel · CSV" icon="download" compact />
      </section>

      <div className="reports-toolbar">
        <div className="reports-area-tabs" role="tablist" aria-label="Filter reports by area">
          {['All', ...areas].map((area) => (
            <button
              key={area}
              type="button"
              role="tab"
              aria-selected={activeArea === area}
              className={activeArea === area ? 'is-active' : ''}
              onClick={() => setSelectedArea(area)}
            >
              {area}
              <span>{area === 'All' ? permittedReports.length : permittedReports.filter((report) => report.grp === area).length}</span>
            </button>
          ))}
        </div>
        <div className="reports-result-count">{visibleReports.length} report{visibleReports.length === 1 ? '' : 's'}</div>
      </div>

      <section className="reports-index" aria-label="Available reports">
        <div className="reports-index-header">
          {['Report', 'Area', 'Scope', 'Output', ''].map((label) => <div key={label || 'action'}>{label}</div>)}
        </div>

        {visibleReports.map((report) => (
          <button
            key={report.id}
            type="button"
            onClick={() => app.openReport(report.id)}
            className="reports-index-row hover-surface2"
          >
            <div className="reports-index-main">
              <span className="reports-index-icon"><Icon name={report.icon} size={18} /></span>
              <span className="reports-index-copy">
                <span className="reports-index-title">
                  <strong>{report.title}</strong>
                  {report.controlledDocument && <em>{documentLabel(report)}</em>}
                </span>
                <small>{report.desc}</small>
              </span>
            </div>
            <div className="reports-index-area">{report.grp}</div>
            <div className="reports-index-scope">{scope}</div>
            <div className="reports-index-formats">
              {['PDF', 'Excel', 'CSV'].map((format) => <span key={format}>{format}</span>)}
            </div>
            <div className="reports-index-open">Open <Icon name="arrow_forward" size={16} /></div>
          </button>
        ))}

        {!visibleReports.length && (
          <div className="reports-empty-state">
            <span><Icon name="search_off" size={22} /></span>
            <strong>No reports found</strong>
            <p>{search ? 'Try a different report name or clear the search.' : 'No reports are available in this area for your role.'}</p>
            {(search || activeArea !== 'All') && <button type="button" onClick={() => { setSearch(''); setSelectedArea('All') }}>Clear filters</button>}
          </div>
        )}
      </section>
    </div>
  )
}

function ReportMetric({ label, value, icon, compact = false }: { label: string; value: string; icon: string; compact?: boolean }) {
  return <div className="reports-overview-card">
    <span><Icon name={icon} size={17} /></span>
    <small>{label}</small>
    <strong className={compact ? 'is-compact' : ''}>{value}</strong>
  </div>
}
