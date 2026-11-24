import { useEffect,useMemo,useState } from 'react'
import { Icon } from '../components/Icon'
import { canViewReport, reportIdsForUser } from '../lib/access'
import { reports, type ReportCard } from '../lib/data'
import { useApp } from '../state/AppContext'
import { reportPreferenceKey,readReportPreferences,emptyReportPreferences,type ReportPreferences } from '../lib/reportPreferences'

function scopeForRole(role: string) {
  const key = role.trim().toLowerCase()
  if (key === 'department head') return 'My department'
  if (key === 'store keeper') return 'Assigned stores'
  if (key === 'cost controller') return 'Current property · Cost Control'
  if (key === 'system administrator') return 'Permitted properties'
  return 'Current property'
}

function documentLabel(report: ReportCard) {
  if (report.controlledDocument === 'lpo') return 'Controlled LPO'
  if (report.controlledDocument === 'grn') return 'GRN document'
  return ''
}

function areaDescription(area: string) {
  const key = area.toLowerCase()
  if (key.includes('department') || key.includes('store')) return 'Department demand, stock issues, movement and store accountability.'
  if (key.includes('procurement') || key.includes('supplier')) return 'Purchasing activity, supplier performance, orders and sourcing controls.'
  if (key.includes('receiv') || key.includes('grn')) return 'Deliveries, goods receipts, inspections and receiving controls.'
  if (key.includes('finance') || key.includes('management')) return 'Approval, value, spend and management-level procurement reporting.'
  if (key.includes('audit') || key.includes('control')) return 'Audit trail, exceptions, approvals and operational control reports.'
  if (key.includes('inventory') || key.includes('stock')) return 'Inventory balances, valuation, aging and stock movement reports.'
  return 'Operational reports available within your current responsibility.'
}

function areaIcon(area: string) {
  const key = area.toLowerCase()
  if (key.includes('department')) return 'assignment'
  if (key.includes('store') || key.includes('inventory') || key.includes('stock')) return 'warehouse'
  if (key.includes('procurement')) return 'shopping_cart_checkout'
  if (key.includes('supplier')) return 'local_shipping'
  if (key.includes('receiv') || key.includes('grn')) return 'inventory_2'
  if (key.includes('finance') || key.includes('management')) return 'payments'
  if (key.includes('audit') || key.includes('control')) return 'history'
  return 'bar_chart'
}

export default function Reports() {
  const app = useApp()
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [filter,setFilter]=useState<'all'|'favorites'|'recent'>('all')
  const [prefState,setPrefState]=useState<{key:string;preferences:ReportPreferences}>({key:'',preferences:emptyReportPreferences()})
  const prefKey=reportPreferenceKey(app.user.id,app.user.role,app.currentBranch||app.user.branchId||'all-permitted')
  const preferences=prefState.key===prefKey?prefState.preferences:emptyReportPreferences()
  useEffect(()=>{setPrefState({key:prefKey,preferences:readReportPreferences(prefKey)});setFilter('all')},[prefKey])
  const allowedIds = reportIdsForUser(app.user)
  const scope = scopeForRole(app.user.role)

  const permittedReports = useMemo(
    () => allowedIds.includes('*') ? reports : reports.filter((report) => canViewReport(app.user, report.id)),
    [allowedIds, app.user],
  )

  const visibleReports = useMemo(() => {
    const query = search.trim().toLowerCase()
    const ids=filter==='favorites'?preferences.favorites:filter==='recent'?preferences.recent:null
    let rows=permittedReports.filter(report=>(!ids||ids.includes(report.id))&&(!query||[report.title,report.desc,report.grp].some(value=>value.toLowerCase().includes(query))))
    if(filter==='recent')rows=rows.slice().sort((a,b)=>preferences.recent.indexOf(a.id)-preferences.recent.indexOf(b.id))
    return rows
  }, [permittedReports, search,filter,preferences.favorites,preferences.recent])

  const groups = useMemo(() => {
    const byArea = new Map<string, ReportCard[]>()
    visibleReports.forEach((report) => {
      const rows = byArea.get(report.grp) || []
      rows.push(report)
      byArea.set(report.grp, rows)
      // The original MC menu exposes the same Booking Journal in two groups.
      if (report.id === 'bookingJournal') byArea.set('Result', [...(byArea.get('Result') || []), report])
    })
    const order = ['Purchase Analysis','Stock Analysis','Sales Analysis','Result']
    const rank = (name: string) => order.includes(name) ? order.indexOf(name) : order.length
    return Array.from(byArea.entries()).sort(([a], [b]) => rank(a)-rank(b) || a.localeCompare(b))
  }, [visibleReports])

  return (
    <section className="enterprise-workspace reports-screen tafiti-report-center">
      <header className="tafiti-report-center-header">
        <div className="tafiti-report-center-heading">
          <span className="tafiti-report-center-icon"><Icon name="bar_chart" size={22} /></span>
          <div>
            <h1>Report Center</h1>
            <p>Operational, inventory, procurement and management reports available to your current role.</p>
            <div className="tafiti-report-center-meta">
              <span>{app.user.role}</span>
              <i />
              <span>{scope}</span>
              <i />
              <span>{permittedReports.length} report{permittedReports.length === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>

        <form className="tafiti-report-search" onSubmit={event=>{event.preventDefault();setSearch(searchDraft)}}>
          <Icon name="search" size={15} />
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search reports…"
            aria-label="Search reports"
          />
          <button type="submit" aria-label="Find reports">Search</button>
          {searchDraft && <button type="button" onClick={() => {setSearch('');setSearchDraft('')}} aria-label="Clear report search"><Icon name="close" size={14} /></button>}
        </form>
      </header>

      {prefKey && <nav aria-label="Report shortcuts" style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>{([['all','All reports'],['favorites','Favourites'],['recent','Recently opened']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={filter===id} onClick={()=>setFilter(id)} style={{padding:'7px 12px',borderRadius:6,border:'1px solid var(--border)',background:filter===id?'var(--accent)':'var(--surface)',color:filter===id?'#fff':'var(--text)',cursor:'pointer',fontWeight:650}}>{label}</button>)}</nav>}
      {groups.length > 0 ? (
        <div className="tafiti-report-groups">
          {groups.map(([area, areaReports]) => (
            <article key={area} className="tafiti-report-group-card">
              <div className="tafiti-report-group-header">
                <span className="tafiti-report-group-icon"><Icon name={areaIcon(area)} size={18} /></span>
                <div>
                  <h2>{area}</h2>
                  <p>{areaDescription(area)}</p>
                </div>
                <span className="tafiti-report-group-count">{areaReports.length}</span>
              </div>

              <div className="tafiti-report-group-list">
                {areaReports.map((report, index) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => app.openReport(report.id)}
                    className="tafiti-report-link"
                  >
                    <span className="tafiti-report-link-icon"><Icon name={index % 2 ? 'description' : 'bar_chart'} size={15} /></span>
                    <span className="tafiti-report-link-copy">
                      <strong>{report.title}{preferences.favorites.includes(report.id)&&<span title="Favourite" style={{marginLeft:6,color:'var(--warn)'}}>★</span>}</strong>
                      <small>{report.desc}</small>
                    </span>
                    {report.controlledDocument && <em>{documentLabel(report)}</em>}
                    <span className="tafiti-report-link-open">Open <Icon name="arrow_forward" size={13} /></span>
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="reports-empty-state tafiti-card-empty">
          <span><Icon name="search" size={22} /></span>
          <strong>No reports found</strong>
          <p>{search ? 'Try a different report name or clear the search.' : filter==='favorites'?'Open a report and add it to your favourites.':filter==='recent'?'Recently opened permitted reports will appear here.':'No reports are available for your current role.'}</p>
          {search && <button type="button" onClick={() => {setSearch('');setSearchDraft('')}}>Clear search</button>}
        </div>
      )}
    </section>
  )
}
