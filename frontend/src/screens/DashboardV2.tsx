import FinancialOverview from '../components/FinancialOverview'
import ValueAnalytics from '../components/ValueAnalytics'
import OverviewAnalytics from '../components/OverviewAnalytics'
import { useState } from 'react'
import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'
import { money } from '../lib/theme'
import { operationalStatus, signalStyle } from '../lib/operationalSignals'

type Tone = 'blue' | 'green' | 'amber' | 'red' | 'purple'
interface Metric { label: string; value: string; hint: string; icon: string; tone: Tone; route: string; routeLabel: string; records?: Activity[] }
interface Activity { id: string; title: string; detail: string; status: string; time: string; timestamp: number; route: string; routeLabel: string }
interface QuickLink { label: string; hint: string; icon: string; route: string; routeLabel: string }
interface DashboardView {
  eyebrow: string
  title: string
  description: string
  metrics: Metric[]
  activities: Activity[]
  queueTitle: string
  queueHint: string
  queueRoute: string
  queueLabel: string
  quickLinks: QuickLink[]
  context: Array<{ label: string; value: string }>
}

const key = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
const ref = (row: any) => String(row?.lpo_number || row?.grn_number || row?.requisition_no || row?.requisition_number || row?.po_number || row?.number || row?.id || 'Record')
const dateText = (value: unknown) => {
  const raw = String(value || '')
  const date = new Date(raw)
  if (!raw || Number.isNaN(date.getTime())) return 'Recently'
  return new Intl.DateTimeFormat('en-UG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }).format(date)
}

export default function DashboardV2() {
  const app = useApp()
  const role = key(app.user.role)
  const view = buildDashboard(role, app.data)
  const [selection, setSelection] = useState<{scope:string;label:string} | null>(null)
  const [limit, setLimit] = useState(7)
  const scope = JSON.stringify([app.user.id, role, app.currentBranch || app.user.branchName])
  const selected = selection?.scope === scope ? view.metrics.find(metric => metric.label === selection.label && metric.records !== undefined) : undefined
  const queue = (selected?.records ?? view.activities).slice().sort((a,b)=>b.timestamp-a.timestamp)
  const firstName = app.user.name.split(/\s+/).filter(Boolean)[0] || 'there'
  const branch = app.currentBranch || app.user.branchName || 'Current property'
  const department = app.user.departmentName || 'All departments'

  // A network failure must not be shown as a confirmed zero balance or zero tasks.
  if (app.apiStatus !== 'live') {
    const offline = app.apiStatus === 'offline'
    return <div className="neo-dashboard">
      <section className="neo-data-state" role="status" aria-live="polite">
        <span><Icon name={offline ? 'cloud_off' : 'sync'} size={24} /></span>
        <h2>{offline ? 'Operational data is unavailable' : 'Connecting to hotel records'}</h2>
        <p>{offline
          ? 'The dashboard cannot confirm current stock, orders or approval totals. Check the server connection and retry.'
          : 'The latest accessible stock, purchasing and approval records are being retrieved.'}</p>
        <button type="button" disabled={app.apiStatus === 'loading'} onClick={() => void app.refreshData()}>
          <Icon name="refresh" size={16} /> Refresh records
        </button>
      </section>
    </div>
  }

  return <div className="neo-dashboard">
    <section className="neo-dashboard-intro">
      <div>
        <span className="neo-dashboard-eyebrow">{view.eyebrow}</span>
        <h1>{view.title}</h1>
        <p>{view.description}</p>
      </div>
      <div className="neo-dashboard-intro-actions">
        <button type="button" className="neo-dashboard-refresh" onClick={() => void app.refreshData()}><Icon name="refresh" size={16} />Refresh</button>
        <span className={`neo-dashboard-live is-${app.apiStatus}`}><i />{app.apiStatus === 'live' ? 'Live data' : app.apiStatus === 'loading' ? 'Syncing' : app.apiStatus === 'offline' ? 'Offline' : 'Connecting'}</span>
      </div>
    </section>

    <section className="neo-metric-grid" aria-label="Key metrics">
      {view.metrics.map((metric) => <button type="button" key={metric.label} className={`neo-metric-card tone-${metric.tone}`} aria-pressed={metric.records !== undefined ? selected?.label === metric.label : undefined} onClick={() => { if(metric.records !== undefined){setSelection({scope,label:metric.label});setLimit(7)}else app.navTo(metric.route, metric.routeLabel) }}>
        <span className="neo-metric-icon"><Icon name={metric.icon} size={19} /></span>
        <span className="neo-metric-copy"><small>{metric.label}</small><strong>{metric.value}</strong><em>{metric.hint}</em></span>
        <Icon name="arrow_forward" size={14} />
      </button>)}
    </section>

    <OverviewAnalytics title="Operational analytics" scope={scope} ready={app.apiStatus==='live'} dateLabel="Latest recorded activity date" groups={Array.from(new Set(view.activities.map(a=>a.title.split(' ')[0]))).map(label=>({label:({PR:'Purchase requisitions',LPO:'Purchase orders',GRN:'Goods receipts',Request:'Department requisitions'} as Record<string,string>)[label]||label,rows:view.activities.filter(a=>a.title.split(' ')[0]===label).map(a=>({reference:a.title,status:a.status,analytics_date:a.timestamp?new Date(a.timestamp).toISOString():''}))}))}/>
    {['cost_controller','store_keeper'].includes(role)&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,320px),1fr))',gap:12}}>
      <ValueAnalytics title="Stock availability by store" description="Number of recorded stock positions with positive available quantity; not stock valuation." monetary={false} scope={scope} records={app.data.balances.filter(r=>Number.isFinite(Number(r.available))&&Number(r.available)>0).map(r=>({label:String(r.item||r.id),group:String(r.store||'Unassigned'),amount:1}))}/>
      <ValueAnalytics title="Stock availability exceptions" description="Stock positions with zero or negative recorded availability, grouped by store." monetary={false} scope={scope} records={app.data.balances.filter(r=>r.available!==null&&r.available!==undefined&&r.available!==''&&Number.isFinite(Number(r.available))&&Number(r.available)<=0).map(r=>({label:String(r.item||r.id),group:String(r.store||'Unassigned'),amount:1}))}/>
    </div>}
    {['procurement_manager','procurement_officer','financial_manager','general_manager'].includes(role)&&<ValueAnalytics title="Recorded LPO book by supplier" description="Recorded UGX order amounts, excluding draft, rejected and cancelled orders. Not recognized expenditure or settled payments; other or unknown currencies excluded." scope={scope} records={app.data.orders.filter(r=>String(r.orderCurrency).toUpperCase()==='UGX'&&!['draft','rejected','cancelled','canceled'].includes(key(r.statusCode||r.status))).map(r=>({label:String(r.id),group:String(r.supplier||'Unknown supplier'),amount:r.recordedTotal}))}/>}
    {['cost_controller','financial_manager','general_manager'].includes(role)&&<FinancialOverview/>}
    <section className="neo-dashboard-grid">
      <article className="neo-dashboard-card neo-work-queue">
        <header className="neo-card-head"><div><span>Priority queue</span><h2>{selected?.label ?? view.queueTitle}</h2><p>{selected ? `${queue.length} matching records · ${selected.hint}` : view.queueHint}</p>{selected && <button type="button" onClick={()=>{setSelection(null);setLimit(7)}}>Clear filter</button>}</div><button type="button" onClick={() => app.navTo(selected?.route ?? view.queueRoute, selected?.routeLabel ?? view.queueLabel)}>Open queue <Icon name="arrow_forward" size={14} /></button></header>
        <div className="neo-activity-list">
          {queue.slice(0, limit).map((activity) => <button type="button" key={`${activity.id}-${activity.title}`} className="neo-activity-row" onClick={() => app.navTo(activity.route, activity.routeLabel)}>
            <span className={`neo-activity-status tone-${toneForStatus(activity.status)}`}><Icon name={iconForStatus(activity.status)} size={15} /></span>
            <span className="neo-activity-copy"><strong>{activity.title}</strong><small>{activity.detail}</small></span>
            <span className="neo-activity-meta"><em style={signalStyle(operationalStatus(activity.status).tone)}>{friendlyStatus(activity.status)}</em><time>{activity.time}</time></span>
            <Icon name="chevron_right" size={15} />
          </button>)}
          {queue.length > limit && <button type="button" className="mc-action" onClick={()=>setLimit(value=>value+25)}>Show more ({queue.length-limit} remaining)</button>}
          {!queue.length && <div className="neo-dashboard-empty"><span><Icon name="task_alt" size={22} /></span><strong>{selected ? 'No matching records' : 'Nothing needs your attention right now'}</strong><small>{selected ? 'No accessible records currently match this metric.' : 'New workflow records will appear here when they reach your queue.'}</small></div>}
        </div>
      </article>

      <aside className="neo-dashboard-side">
        <section className="neo-dashboard-card neo-welcome-card">
          <div className="neo-welcome-icon"><Icon name="waving_hand" size={19} /></div>
          <span><small>Signed in as</small><strong>{firstName}</strong><em>{app.user.role}</em></span>
          <div className="neo-scope-list">
            <span><small>Property</small><strong>{branch}</strong></span>
            <span><small>Department</small><strong>{department}</strong></span>
            {view.context.map((item) => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong></span>)}
          </div>
        </section>

        <section className="neo-dashboard-card neo-quick-card">
          <header><span>Shortcuts</span><h2>Quick access</h2></header>
          <div>
            {view.quickLinks.map((link) => <button type="button" key={link.label} onClick={() => app.navTo(link.route, link.routeLabel)}>
              <span><Icon name={link.icon} size={16} /></span><span><strong>{link.label}</strong><small>{link.hint}</small></span><Icon name="chevron_right" size={14} />
            </button>)}
          </div>
        </section>
      </aside>
    </section>
  </div>
}

function buildDashboard(role: string, data: any): DashboardView {
  const storeRequests = data.storeRequisitions || []
  const requisitions = data.requisitions || []
  const orders = data.orders || []
  const grns = data.grns || []
  const inspections = data.inspections || []
  const suppliers = data.suppliers || []
  const items = data.items || []
  const balances = data.balances || []
  const employees = data.employees || []
  const departments = data.departments || []

  const activity = (rows: any[], route: string, routeLabel: string, noun: string): Activity[] => rows.map((row) => ({
    id: ref(row),
    title: `${noun} ${ref(row)}`,
    detail: String(row.purpose || row.department_name || row.department || row.supplier_name || row.supplier || row.itemSummary || 'Operational record'),
    status: String(row.statusCode || row.status || 'Open'),
    time: dateText(row.updated_at || row.created_at || row.date || row.required_date),
    timestamp: new Date(row.updated_at || row.created_at || row.date || row.required_date || '').getTime() || 0,
    route,
    routeLabel,
  }))

  const metric = (label: string, value: string | number, hint: string, icon: string, tone: Tone, route: string, routeLabel: string, records?: Activity[]): Metric => ({ label, value: String(value), hint, icon, tone, route, routeLabel, records })
  const quick = (label: string, hint: string, icon: string, route: string, routeLabel = label): QuickLink => ({ label, hint, icon, route, routeLabel })

  if (['department_supervisor', 'outlet_supervisor', 'supervisor', 'department_employee', 'requester'].includes(role)) {
    const drafts = storeRequests.filter((row: any) => key(row.statusCode || row.status) === 'draft')
    const pending = storeRequests.filter((row: any) => key(row.statusCode || row.status) === 'pending_department_approval')
    const active = storeRequests.filter((row: any) => ['submitted','approved','partially_approved','partially_issued'].includes(key(row.statusCode || row.status)))
    const done = storeRequests.filter((row: any) => ['issued','completed'].includes(key(row.statusCode || row.status)))
    return {
      eyebrow: 'Department workspace', title: 'My requisitions', description: 'Create requests, follow approvals and see what Stores has issued.',
      metrics: [metric('Drafts', drafts.length, 'Continue before submission', 'edit_note', 'blue', 'workflow-stores', 'My requests', activity(drafts, 'workflow-stores', 'My requests', 'Request')), metric('Pending HOD', pending.length, 'Waiting for department approval', 'approval', 'amber', 'workflow-stores', 'My requests', activity(pending, 'workflow-stores', 'My requests', 'Request')), metric('In progress', active.length, 'With control or Stores', 'schedule', 'purple', 'workflow-stores', 'My requests', activity(active, 'workflow-stores', 'My requests', 'Request')), metric('Completed', done.length, 'Issued or completed', 'task_alt', 'green', 'workflow-stores', 'My requests', activity(done, 'workflow-stores', 'My requests', 'Request'))],
      activities: activity(storeRequests, 'workflow-stores', 'My requests', 'Request'), queueTitle: 'Recent requests', queueHint: 'Your latest department requisitions and their current stage.', queueRoute: 'workflow-stores', queueLabel: 'My requests',
      quickLinks: [
        quick('New store request', 'Enter an internal requisition', 'assignment_add', 'new-store-request', 'New internal requisition'),
        quick('Confirm pickup', 'Sign for posted stock', 'fact_check', 'incoming-pickup', 'Incoming transfers'),
        quick('Waste log', 'Record outlet waste at source', 'delete_sweep', 'waste-control', 'Waste control'),
      ],
      context: [{ label: 'Total requests', value: String(storeRequests.length) }],
    }
  }

  if (role === 'department_head') {
    const pending = storeRequests.filter((row: any) => key(row.statusCode || row.status) === 'pending_department_approval')
    const approved = storeRequests.filter((row: any) => ['submitted','approved','partially_approved','partially_issued','issued','completed'].includes(key(row.statusCode || row.status)))
    const rejected = storeRequests.filter((row: any) => key(row.statusCode || row.status) === 'rejected')
    return {
      eyebrow: 'Department approvals', title: 'HOD approval desk', description: 'Review department requests, retain or reduce quantities, and track approved demand through Stores.',
      metrics: [metric('Pending approval', pending.length, 'Requests awaiting your decision', 'approval', 'amber', 'workflow-stores', 'Department approvals', activity(pending, 'workflow-stores', 'Department approvals', 'Request')), metric('Approved', approved.length, 'Requests moved beyond HOD', 'task_alt', 'green', 'workflow-stores', 'Department approvals', activity(approved, 'workflow-stores', 'Department approvals', 'Request')), metric('Rejected', rejected.length, 'Requests declined', 'error', 'red', 'workflow-stores', 'Department approvals', activity(rejected, 'workflow-stores', 'Department approvals', 'Request')), metric('All requests', storeRequests.length, 'Department request history', 'assignment', 'blue', 'reports', 'Reports')],
      activities: activity(storeRequests, 'workflow-stores', 'Department approvals', 'Request'), queueTitle: 'Department approval queue', queueHint: 'Requests that need a decision or have recently moved through your department.', queueRoute: 'workflow-stores', queueLabel: 'Department approvals',
      quickLinks: [quick('Department approvals', 'Review pending requests', 'approval', 'workflow-stores', 'Department approvals'), quick('Recipe costing', 'Maintain yields and ingredients', 'menu_book', 'recipes-production', 'Recipe costing'), quick('Waste review', 'Review outlet variances', 'delete_sweep', 'waste-control', 'Waste control'), quick('Reports', 'Department request and issue history', 'bar_chart', 'reports', 'Reports')],
      context: [{ label: 'Department requests', value: String(storeRequests.length) }],
    }
  }

  if (role === 'store_keeper') {
    const approved = storeRequests.filter((row: any) => ['approved','partially_issued'].includes(key(row.statusCode || row.status)))
    const completed = storeRequests.filter((row: any) => ['issued','completed'].includes(key(row.statusCode || row.status)))
    const low = balances.filter((row: any) => Number(row.available ?? row.on_hand ?? 0) <= 0)
    return {
      eyebrow: 'Stores & inventory', title: 'Store Keeper desk', description: 'Issue approved requests, watch stock availability and hand shortages to Procurement.',
      metrics: [metric('Ready to issue', approved.length, 'Approved requests in queue', 'inventory_2', 'blue', 'transfer-dispatch', 'Transfer fulfillment', activity(approved, 'transfer-dispatch', 'Transfer fulfillment', 'Request')), metric('Stock lines', balances.length, 'Balances in your accessible stores', 'warehouse', 'green', 'stock-on-hand', 'Stock on hand'), metric('Stock alerts', low.length, 'Zero or unavailable stock lines', 'warning', 'red', 'stock-on-hand', 'Stock on hand'), metric('Completed', completed.length, 'Issued requests', 'task_alt', 'purple', 'workflow-stores', 'Issue queue', activity(completed, 'workflow-stores', 'Issue queue', 'Request'))],
      activities: activity(storeRequests, 'workflow-stores', 'Issue queue', 'Request'), queueTitle: 'Stores issue queue', queueHint: 'Approved department requests that require physical preparation or handover.', queueRoute: 'transfer-dispatch', queueLabel: 'Transfer fulfillment',
      quickLinks: [
        quick('GRN posting', 'Verify supplier deliveries', 'move_to_inbox', 'grn-posting', 'GRN posting'),
        quick('Dispatch transfers', 'Pick and pack approved requests', 'local_shipping', 'transfer-dispatch', 'Transfer fulfillment'),
        quick('Stock on hand', 'Check live availability', 'inventory_2', 'stock-on-hand', 'Stock on hand'),
        quick('Purchase requests', 'Review shortage handoffs', 'shopping_cart', 'store-purchase-requests', 'Purchase requests'),
      ],
      context: [{ label: 'Articles', value: String(items.length) }, { label: 'Stock records', value: String(balances.length) }],
    }
  }

  if (role === 'cost_controller') {
    const control = storeRequests.filter((row: any) => key(row.statusCode || row.status) === 'submitted')
    return {
      eyebrow: 'Cost control', title: 'Request control', description: 'Validate approved department demand against stock and master data before Stores issues.',
      metrics: [metric('Awaiting control', control.length, 'HOD-approved requests', 'fact_check', 'amber', 'workflow-stores', 'Request control', activity(control, 'workflow-stores', 'Request control', 'Request')), metric('Suppliers', suppliers.length, 'Active supplier records', 'local_shipping', 'blue', 'suppliers', 'Suppliers'), metric('Articles', items.length, 'Catalogue records', 'inventory_2', 'green', 'items', 'Articles'), metric('Stock lines', balances.length, 'Available inventory positions', 'warehouse', 'purple', 'reports', 'Reports')],
      activities: activity(storeRequests, 'workflow-stores', 'Request control', 'Request'), queueTitle: 'Cost Control queue', queueHint: 'Department requests ready for quantity and availability review.', queueRoute: 'workflow-stores', queueLabel: 'Request control',
      quickLinks: [quick('Request control', 'Review HOD-approved quantities', 'fact_check', 'workflow-stores', 'Request control'), quick('Waste audit', 'Review operational loss', 'delete_sweep', 'waste-control', 'Waste control'), quick('Recipe costing', 'Control yields and food cost', 'menu_book', 'recipes-production', 'Recipe costing'), quick('Month-end inventory', 'Prepare and reconcile physical counts', 'fact_check', 'month-end-stocktake', 'Month-end inventory'), quick('Reports', 'Purchase, stock, sales and results', 'bar_chart', 'reports', 'Reports'), quick('POS depletion', 'Post sales-driven usage', 'point_of_sale', 'pos-control', 'POS depletion')],
      context: [{ label: 'Departments', value: String(departments.length) }],
    }
  }

  if (role === 'procurement_manager' || role === 'procurement_officer') {
    const openReq = requisitions.filter((row: any) => !['completed','cancelled','rejected'].includes(key(row.status)))
    const openOrders = orders.filter((row: any) => !['completed','cancelled','closed'].includes(key(row.status)))
    const total = orders.reduce((sum: number, row: any) => sum + Number(row.total || row.total_amount || 0), 0)
    return {
      eyebrow: 'Procurement', title: 'Procurement command desk', description: 'Move approved demand through sourcing, LPO preparation and supplier delivery.',
      metrics: [metric('Open requisitions', openReq.length, 'Demand requiring procurement work', 'assignment', 'blue', 'workflow-procure', 'Procurement workbench', activity(openReq, 'workflow-procure', 'Procurement workbench', 'PR')), metric('Open LPOs', openOrders.length, 'Purchase orders in progress', 'shopping_cart', 'purple', 'workflow-procure', 'Procurement workbench', activity(openOrders, 'workflow-procure', 'Procurement workbench', 'LPO')), metric('Suppliers', suppliers.length, 'Registered supplier accounts', 'local_shipping', 'green', 'workflow-procure', 'Procurement workbench'), metric('LPO value', money(total), 'Current order book value', 'payments', 'amber', 'reports', 'Reports')],
      activities: [...activity(requisitions, 'workflow-procure', 'Procurement workbench', 'PR'), ...activity(orders, 'workflow-procure', 'Procurement workbench', 'LPO')], queueTitle: 'Procurement workload', queueHint: 'Latest purchase requisitions and orders moving through the buying cycle.', queueRoute: 'workflow-procure', queueLabel: 'Procurement workbench',
      quickLinks: [quick('Procurement workbench', 'Open sourcing and LPO queues', 'shopping_cart', 'workflow-procure', 'Procurement workbench'), quick('Reports', 'Spend and supplier analysis', 'bar_chart', 'reports', 'Reports')],
      context: [{ label: 'GRNs', value: String(grns.length) }],
    }
  }

  if (role === 'financial_manager') {
    const pending = orders.filter((row: any) => ['pending','pending_approval','submitted','approved'].includes(key(row.status)))
    const total = orders.reduce((sum: number, row: any) => sum + Number(row.total || row.total_amount || 0), 0)
    return {
      eyebrow: 'Financial approvals', title: 'LPO approval desk', description: 'Review purchase commitments before they proceed to management or supplier fulfilment.',
      metrics: [metric('Approval queue', pending.length, 'LPOs requiring financial review', 'approval', 'amber', 'workflow-procure', 'LPO approvals', activity(pending, 'workflow-procure', 'LPO approvals', 'LPO')), metric('LPO value', money(total), 'Visible purchase commitments', 'payments', 'blue', 'workflow-procure', 'LPO approvals'), metric('Goods receipts', grns.length, 'Receipts available for review', 'local_shipping', 'green', 'reports', 'Reports'), metric('Suppliers', suppliers.length, 'Supplier exposure context', 'business', 'purple', 'reports', 'Reports')],
      activities: activity(orders, 'workflow-procure', 'LPO approvals', 'LPO'), queueTitle: 'Financial approval queue', queueHint: 'Purchase orders awaiting review or recently processed.', queueRoute: 'workflow-procure', queueLabel: 'LPO approvals',
      quickLinks: [quick('LPO approvals', 'Review pending purchase commitments', 'approval', 'workflow-procure', 'LPO approvals'), quick('Invoices & payments', 'Review AP documents', 'payments', 'workflow-pay', 'Invoices & payments'), quick('Budgets & close', 'Control commitments and periods', 'account_balance', 'finance-governance', 'Budgets & period close'), quick('Reports', 'Review procurement commitments', 'bar_chart', 'reports', 'Reports')],
      context: [{ label: 'Open requisitions', value: String(requisitions.length) }],
    }
  }

  if (role === 'accounts_payable_clerk') {
    const received = grns.filter((row: any) => ['posted', 'verified', 'completed'].includes(key(row.status)))
    const exceptions = grns.filter((row: any) => Number(row.rejected_quantity || 0) > 0)
    return {
      eyebrow: 'Accounts payable', title: 'Invoice matching desk', description: 'Match supplier invoices to approved LPOs and verified receipts before payment processing.',
      metrics: [metric('Verified GRNs', received.length, 'Receipts available for matching', 'receipt_long', 'green', 'workflow-pay', 'Invoices & payments'), metric('Purchase orders', orders.length, 'LPO evidence in scope', 'shopping_cart', 'blue', 'workflow-pay', 'Invoices & payments'), metric('Receipt exceptions', exceptions.length, 'Rejected or disputed receipt lines', 'warning', 'red', 'reports', 'Reports'), metric('Suppliers', suppliers.length, 'Supplier accounts in scope', 'business', 'purple', 'reports', 'Reports')],
      activities: [...activity(grns, 'workflow-pay', 'Invoices & payments', 'GRN'), ...activity(orders, 'workflow-pay', 'Invoices & payments', 'LPO')], queueTitle: 'Three-way match evidence', queueHint: 'Recent receipts and purchase orders available for invoice matching.', queueRoute: 'workflow-pay', queueLabel: 'Invoices & payments',
      quickLinks: [quick('Invoices & payments', 'Match, review and pay suppliers', 'payments', 'workflow-pay', 'Invoices & payments'), quick('AP reports', 'Review receipts and invoice controls', 'bar_chart', 'reports', 'Reports')],
      context: [{ label: 'Visible suppliers', value: String(suppliers.length) }],
    }
  }

  if (role === 'general_manager') {
    const pending = orders.filter((row: any) => !['completed','rejected','cancelled','closed'].includes(key(row.status)))
    const total = orders.reduce((sum: number, row: any) => sum + Number(row.total || row.total_amount || 0), 0)
    return {
      eyebrow: 'Management approvals', title: 'Executive control desk', description: 'See purchasing commitments, final approval workload and operational throughput.',
      metrics: [metric('Open LPOs', pending.length, 'Orders still in progress', 'approval', 'amber', 'workflow-procure', 'Final approvals', activity(pending, 'workflow-procure', 'Final approvals', 'LPO')), metric('Commitment value', money(total), 'Visible LPO book value', 'payments', 'blue', 'reports', 'Reports'), metric('Goods receipts', grns.length, 'Recorded receiving documents', 'local_shipping', 'green', 'reports', 'Reports'), metric('Stock records', balances.length, 'Inventory positions visible', 'inventory_2', 'purple', 'reports', 'Reports')],
      activities: activity(orders, 'workflow-procure', 'Final approvals', 'LPO'), queueTitle: 'Management decisions', queueHint: 'Purchase orders moving through or beyond final management approval.', queueRoute: 'workflow-procure', queueLabel: 'Final approvals',
      quickLinks: [quick('Final approvals', 'Review management LPO queue', 'verified_user', 'workflow-procure', 'Final approvals'), quick('Reports', 'Management summary and exceptions', 'bar_chart', 'reports', 'Reports')],
      context: [{ label: 'Suppliers', value: String(suppliers.length) }],
    }
  }

  if (role === 'receiving_clerk') {
    const openOrders = orders.filter((row: any) => !['completed','cancelled','closed'].includes(key(row.status)))
    const pendingInspections = inspections.filter((row: any) => !['completed','accepted','posted'].includes(key(row.status)))
    return {
      eyebrow: 'Receiving', title: 'Receiving desk', description: 'Match deliveries to approved LPOs, record GRNs and route goods through inspection.',
      metrics: [metric('Open LPOs', openOrders.length, 'Orders potentially awaiting delivery', 'shopping_cart', 'blue', 'workflow-procure', 'Receiving & GRN', activity(openOrders, 'workflow-procure', 'Receiving & GRN', 'LPO')), metric('GRNs', grns.length, 'Goods receipt documents', 'local_shipping', 'green', 'workflow-procure', 'Receiving & GRN', activity(grns, 'workflow-procure', 'Receiving & GRN', 'GRN')), metric('Inspections', pendingInspections.length, 'Inspection records still open', 'fact_check', 'amber', 'workflow-procure', 'Receiving & GRN'), metric('Suppliers', suppliers.length, 'Supplier accounts', 'business', 'purple', 'reports', 'Reports')],
      activities: [...activity(grns, 'workflow-procure', 'Receiving & GRN', 'GRN'), ...activity(orders, 'workflow-procure', 'Receiving & GRN', 'LPO')], queueTitle: 'Receiving activity', queueHint: 'Recent purchase orders and goods receipts handled by the receiving process.', queueRoute: 'workflow-procure', queueLabel: 'Receiving & GRN',
      quickLinks: [quick('Receiving & GRN', 'Record and review deliveries', 'local_shipping', 'workflow-procure', 'Receiving & GRN'), quick('Reports', 'Receiving and exception reports', 'bar_chart', 'reports', 'Reports')],
      context: [{ label: 'Inspection records', value: String(inspections.length) }],
    }
  }

  if (role === 'system_administrator' || role === 'admin' || role === 'administrator') {
    const transactions = storeRequests.length + requisitions.length + orders.length + grns.length
    return {
      eyebrow: 'System administration', title: 'Operations overview', description: 'Monitor operational data, people, master data and system governance from one place.',
      metrics: [metric('Employees', employees.length, 'Staff records', 'groups', 'blue', 'employees', 'Employees'), metric('Suppliers', suppliers.length, 'Supplier master records', 'local_shipping', 'green', 'suppliers', 'Suppliers'), metric('Articles', items.length, 'Catalogue records', 'inventory_2', 'purple', 'items', 'Articles'), metric('Transactions', transactions, 'Workflow records in memory', 'bar_chart', 'amber', 'reports', 'Reports')],
      activities: [...activity(orders, 'workflow-procure', 'Procurement workbench', 'LPO'), ...activity(grns, 'workflow-procure', 'Procurement workbench', 'GRN'), ...activity(storeRequests, 'workflow-stores', 'Stores workflow', 'Request')], queueTitle: 'Operational activity', queueHint: 'Latest records across stores and procurement.', queueRoute: 'audit-log', queueLabel: 'Audit trail',
      quickLinks: [quick('User access', 'Roles, accounts and permissions', 'manage_accounts', 'access-management', 'User access'), quick('Integrations', 'Outlet assignments and system links', 'hub', 'integration-control', 'Integrations'), quick('Audit trail', 'Review system activity', 'history', 'audit-log', 'Audit trail'), quick('Settings', 'Property configuration', 'settings', 'hotel-profile', 'Settings')],
      context: [{ label: 'Departments', value: String(departments.length) }],
    }
  }

  return {
    eyebrow: 'Hotel operations', title: 'Operations dashboard', description: 'Your assigned operational records and quick access to the tools available to you.',
    metrics: [metric('Requests', storeRequests.length, 'Department requests', 'assignment', 'blue', 'workflow-stores', 'Stores workflow'), metric('Requisitions', requisitions.length, 'Purchase requisitions', 'description', 'purple', 'workflow-procure', 'Procurement workbench'), metric('LPOs', orders.length, 'Purchase orders', 'shopping_cart', 'amber', 'workflow-procure', 'Procurement workbench'), metric('GRNs', grns.length, 'Goods receipts', 'local_shipping', 'green', 'reports', 'Reports')],
    activities: [...activity(storeRequests, 'workflow-stores', 'Stores workflow', 'Request'), ...activity(orders, 'workflow-procure', 'Procurement workbench', 'LPO')], queueTitle: 'Recent activity', queueHint: 'Latest operational records available to your account.', queueRoute: 'reports', queueLabel: 'Reports',
    quickLinks: [quick('Reports', 'Open operational reports', 'bar_chart', 'reports', 'Reports')], context: [],
  }
}

function toneForStatus(status: string): Tone {
  const value = key(status)
  if (/reject|cancel|fail|exception/.test(value)) return 'red'
  if (/approve|complete|issue|receive|post|active/.test(value)) return 'green'
  if (/pending|await|draft|partial/.test(value)) return 'amber'
  if (/progress|submit|open/.test(value)) return 'purple'
  return 'blue'
}

function iconForStatus(status: string) {
  const tone = toneForStatus(status)
  if (tone === 'red') return 'error'
  if (tone === 'green') return 'task_alt'
  if (tone === 'amber') return 'schedule'
  return 'description'
}

function friendlyStatus(status: string) {
  const value = key(status).replace(/_/g, ' ')
  return value ? value.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Open'
}
