import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'
import '../store-analysis.css'

type ReportLink = {
  id: 'departmentRequests' | 'storeIssues' | 'goodsReceipts' | 'valuation' | 'lowstock' | 'movement' | 'aging' | 'consumption'
  title: string
  description: string
  icon: string
  note?: string
}

const registerReports: ReportLink[] = [
  { id: 'departmentRequests', title: 'Request & transfer register', description: 'Department requests moving through Stores and their current status.', icon: 'assignment' },
  { id: 'storeIssues', title: 'Issue request register', description: 'Issued transfer vouchers, handovers and receivers.', icon: 'outbox' },
  { id: 'goodsReceipts', title: 'Daily reception register', description: 'Goods Received Notes, suppliers and inventory posting position.', icon: 'move_to_inbox' },
]

const analysisReports: ReportLink[] = [
  { id: 'valuation', title: 'Monthly store balance sheet', description: 'Live weighted-average stock value by article and store.', icon: 'savings' },
  { id: 'lowstock', title: 'Daily out-of-stock report', description: 'Balances at or below their effective reorder minimum.', icon: 'warning' },
  { id: 'movement', title: 'Stock movement information', description: 'Chronological article history, references and running balance.', icon: 'sync_alt', note: 'Choose an article in the report filters.' },
  { id: 'aging', title: 'Batch & expiry position', description: 'Non-depleted stock batches approaching expiry.', icon: 'schedule' },
]

const usageReports: ReportLink[] = [
  { id: 'consumption', title: 'Usage statistics', description: 'Live outbound quantity grouped by article, store and source.', icon: 'monitoring' },
]

export default function StoreAnalysis({ focus = 'analysis' }: { focus?: 'analysis' | 'usage' }) {
  const app = useApp()
  const open = (report: ReportLink) => app.openReport(report.id)

  return <div className="store-analysis-page">
    <header className="store-analysis-header">
      <span className="store-analysis-icon"><Icon name={focus === 'usage' ? 'monitoring' : 'bar_chart'} size={22} /></span>
      <div>
        <span>Store Keeper</span>
        <h1>{focus === 'usage' ? 'Usage' : 'Stock analysis'}</h1>
        <p>Live operational reports for the stores assigned to your account.</p>
      </div>
    </header>

    {focus === 'usage' ? <ReportSection title="Usage" description="Review recorded consumption and issue usage by article and store." reports={usageReports} open={open} /> : <>
      <ReportSection title="Store registers" description="Oracle-style operational registers for requests, transfers, issues and receptions." reports={registerReports} open={open} />
      <ReportSection title="Stock analysis" description="Use the current stock position, reorder exceptions and article history to plan Stores work." reports={analysisReports} open={open} />
      <ReportSection title="Usage" description="Consumption and usage statistics are kept separate from stock balance valuation." reports={usageReports} open={open} />
    </>}
  </div>
}

function ReportSection({ title, description, reports, open }: { title: string; description: string; reports: ReportLink[]; open: (report: ReportLink) => void }) {
  return <section className="store-analysis-section">
    <header><div><span>{title}</span><p>{description}</p></div></header>
    <div className="store-analysis-grid">
      {reports.map((report) => <button type="button" key={report.id} className="store-analysis-card" onClick={() => open(report)}>
        <span className="store-analysis-card-icon"><Icon name={report.icon} size={19} /></span>
        <span className="store-analysis-card-copy"><strong>{report.title}</strong><small>{report.description}</small>{report.note && <em>{report.note}</em>}</span>
        <Icon name="arrow_forward" size={16} />
      </button>)}
    </div>
  </section>
}
