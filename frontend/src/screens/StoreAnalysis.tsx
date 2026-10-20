import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'
import '../store-analysis.css'

type ReportId = 'departmentRequests' | 'storeIssues' | 'goodsReceipts' | 'valuation' | 'lowstock' | 'movement' | 'aging' | 'consumption' | 'stockMovementControl'
type Destination = { kind: 'report'; value: ReportId } | { kind: 'route'; value: string } | { kind: 'notice'; value: string }
type ReportLink = { title: string; description: string; icon: string; destination: Destination }

const registerReports: ReportLink[] = [
  { title: 'Request and Transfer Report', description: 'Department requests moving through Stores and their current status.', icon: 'assignment', destination: { kind: 'report', value: 'departmentRequests' } },
  { title: 'Issue Request Register', description: 'Issued transfer vouchers, handovers and receivers.', icon: 'outbox', destination: { kind: 'report', value: 'storeIssues' } },
  { title: 'Daily Reception Report', description: 'Goods Received Notes, suppliers and inventory posting position.', icon: 'move_to_inbox', destination: { kind: 'report', value: 'goodsReceipts' } },
]

const analysisReports: ReportLink[] = [
  { title: 'Issue/Transfer Deviation Statistics', description: 'Review inter-store transfer progress, quantities and receipt status.', icon: 'sync_problem', destination: { kind: 'route', value: 'store-transfers' } },
  { title: 'Issue/Transfer Deviation per Reason Code', description: 'Open transfer controls to investigate a variance before it is resolved.', icon: 'rule', destination: { kind: 'route', value: 'store-transfers' } },
  { title: 'Monthly Store Balance Sheet', description: 'Live weighted-average stock value by article and store.', icon: 'savings', destination: { kind: 'report', value: 'valuation' } },
  { title: 'Daily Out of Stock Report', description: 'Balances at or below their effective reorder minimum.', icon: 'warning', destination: { kind: 'report', value: 'lowstock' } },
  { title: 'Stock On Hand Forecast', description: 'Use the current stock position and reorder threshold to plan availability.', icon: 'insights', destination: { kind: 'route', value: 'stock-on-hand' } },
  { title: 'Stock Movement Information', description: 'Posted inventory movement controls, references and responsible actors.', icon: 'swap_horiz', destination: { kind: 'report', value: 'stockMovementControl' } },
  { title: 'Article History', description: 'Chronological article history, references and running balance.', icon: 'history', destination: { kind: 'report', value: 'movement' } },
  { title: 'Article History by Document Date', description: 'Open an Article stock card and apply the document-date filters.', icon: 'event_note', destination: { kind: 'report', value: 'movement' } },
  { title: 'Booking Journal', description: 'Auditable stock postings with their source document reference.', icon: 'book_2', destination: { kind: 'report', value: 'stockMovementControl' } },
  { title: 'Stock Cover Report', description: 'Compare current SOH with recorded outbound stock consumption.', icon: 'inventory_2', destination: { kind: 'report', value: 'consumption' } },
  { title: 'Stock Take Interval', description: 'Review open, submitted and applied inventory sessions.', icon: 'fact_check', destination: { kind: 'route', value: 'store-inventory' } },
  { title: 'Batch & Expiry Position', description: 'Non-depleted stock batches approaching expiry.', icon: 'schedule', destination: { kind: 'report', value: 'aging' } },
]

const usageReports: ReportLink[] = [
  { title: 'Gather Usage', description: 'Usage is gathered from posted issue and inventory-out transactions—without re-entering a stock movement.', icon: 'download_for_offline', destination: { kind: 'notice', value: 'Posted Store issues and inventory-out movements are gathered automatically. Open Usage Statistics to review the recorded result.' } },
  { title: 'Usage Statistics', description: 'Live outbound quantity grouped by article, store and source.', icon: 'monitoring', destination: { kind: 'report', value: 'consumption' } },
  { title: 'Usage Groups', description: 'Review usage through the catalogue Major Group and Item Group classifications.', icon: 'account_tree', destination: { kind: 'route', value: 'store-usage' } },
  { title: 'Usage Over Groups', description: 'Compare consumption across the Article groups assigned to Stores.', icon: 'donut_large', destination: { kind: 'report', value: 'consumption' } },
  { title: 'Consumption Statistics', description: 'Outbound stock usage by article, store and source document.', icon: 'bar_chart', destination: { kind: 'report', value: 'consumption' } },
]

export default function StoreAnalysis({ focus = 'analysis' }: { focus?: 'analysis' | 'usage' }) {
  const app = useApp()
  const open = (report: ReportLink) => {
    if (report.destination.kind === 'report') app.openReport(report.destination.value)
    else if (report.destination.kind === 'route') {
      if (report.destination.value === 'store-usage' && focus === 'usage') app.showWorkflowAlert('Usage Groups', 'Usage is grouped by the Major Group and Item Group configured on each Article. Open Usage Statistics and choose the required Article group in the report filters.', 'warning')
      else app.navTo(report.destination.value, report.title)
    } else app.showWorkflowAlert('Gather Usage', report.destination.value, 'warning')
  }
  return <div className="store-analysis-page">
    <header className="store-analysis-header">
      <span className="store-analysis-icon"><Icon name={focus === 'usage' ? 'monitoring' : 'bar_chart'} size={22} /></span>
      <div><span>Store Keeper</span><h1>{focus === 'usage' ? 'Usage' : 'Stock Analysis'}</h1><p>{focus === 'usage' ? 'Gathered Store usage and grouped consumption statistics.' : 'Store registers and analysis options for your assigned stores.'}</p></div>
    </header>
    {focus === 'usage' ? <ReportSection title="Usage" description="The supplied Usage menu, connected to posted inventory records." reports={usageReports} open={open} /> : <>
      <ReportSection title="Store Registers" description="Request, issue, transfer and reception registers." reports={registerReports} open={open} />
      <ReportSection title="Stock Analysis" description="Stock position, movements, covers and inventory controls." reports={analysisReports} open={open} />
      <ReportSection title="Usage" description="Gathered usage and consumption analysis." reports={usageReports} open={open} />
    </>}
  </div>
}

function ReportSection({ title, description, reports, open }: { title: string; description: string; reports: ReportLink[]; open: (report: ReportLink) => void }) {
  return <section className="store-analysis-section"><header><div><span>{title}</span><p>{description}</p></div></header><div className="store-analysis-grid">{reports.map((report) => <button type="button" key={report.title} className="store-analysis-card" onClick={() => open(report)}><span className="store-analysis-card-icon"><Icon name={report.icon} size={19} /></span><span className="store-analysis-card-copy"><strong>{report.title}</strong><small>{report.description}</small></span><Icon name="arrow_forward" size={16} /></button>)}</div></section>
}
