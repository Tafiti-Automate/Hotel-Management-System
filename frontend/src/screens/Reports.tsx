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
    <div className="enterprise-workspace reports-screen ui-page">
      <header className="ui-page-header reports-page-header">
        <div className="ui-page-heading">
          <span className="ui-eyebrow">{app.user.role} · Reporting</span>
          <h1>Reports</h1>
          <p>Operational and management reports available within your current role and working scope.</p>
        </div>
        <div className="reports-search-box">
          <Icon name="search" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reports"
            aria-label="Search reports"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear report search">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </header>

      <section className="reports-summary-bar" aria-label="Reporting scope">
        <div><strong>{permittedReports.length}</strong><span>Available reports</span></div>
        <div><strong>{areas.length}</strong><span>Report areas</span></div>
        <div><strong>{scope}</strong><span>Current scope</span></div>
        <div><strong>PDF · Excel · CSV</strong><span>Export formats</span></div>
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

      {visibleReports.length > 0 ? (
        <section className="reports-card-grid" aria-label="Available reports">
          {visibleReports.map((report) => (
            <button
              key={report.id}
              type="button"
              onClick={() => app.openReport(report.id)}
              className="report-catalog-card"
            >
              <div className="report-catalog-card-top">
                <span className="report-catalog-icon"><Icon name={report.icon} size={18} /></span>
                <span className="report-catalog-area">{report.grp}</span>
              </div>

              <div className="report-catalog-copy">
                <div className="report-catalog-title-row">
                  <h2>{report.title}</h2>
                  {report.controlledDocument && <span className="report-catalog-control">{documentLabel(report)}</span>}
                </div>
                <p>{report.desc}</p>
              </div>

              <div className="report-catalog-meta">
                <div><span>Scope</span><strong>{scope}</strong></div>
                <div className="report-catalog-formats"><span>Output</span><strong>PDF · Excel · CSV</strong></div>
              </div>

              <div className="report-catalog-open">Open report <Icon name="arrow_forward" size={15} /></div>
            </button>
          ))}
        </section>
      ) : (
        <section className="reports-empty-state">
          <span><Icon name="search_off" size={22} /></span>
          <strong>No reports found</strong>
          <p>{search ? 'Try a different report name or clear the search.' : 'No reports are available in this area for your role.'}</p>
          {(search || activeArea !== 'All') && <button type="button" onClick={() => { setSearch(''); setSelectedArea('All') }}>Clear filters</button>}
        </section>
      )}
    </div>
  )
}
