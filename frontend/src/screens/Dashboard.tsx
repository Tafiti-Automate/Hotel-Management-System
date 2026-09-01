import type { CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const roleKey = (role: string) => role.trim().toLowerCase()
const statusKey = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
const pendingApprovalStage = (row: any) => {
  const steps = Array.isArray(row?.approval_steps) ? row.approval_steps : []
  const pending = steps.find((step: any) => statusKey(step?.status) === 'pending')
  return String(pending?.stage_name || '').toLowerCase()
}
const ref = (row: any) => String(row?.lpo_number || row?.grn_number || row?.requisition_no || row?.requisition_number || row?.po_number || row?.number || row?.id || 'Record')

interface TaskCard {
  label: string
  count: number
  hint: string
  icon: string
  route: string
  routeLabel: string
  tone?: 'accent' | 'warning' | 'good' | 'danger'
}

interface ActivityRow { id: string; title: string; detail: string; status: string; date: string; route: string; routeLabel: string }

interface PrimaryAction {
  title: string
  hint: string
  label: string
  route: string
  icon: string
}

interface DashboardView {
  subtitle: string
  tasks: TaskCard[]
  activities: ActivityRow[]
  queueTitle: string
  queueHint: string
  queueRoute: string
  queueRouteLabel: string
  context: Array<{ label: string; value: string }>
  primaryAction?: PrimaryAction
}

export default function Dashboard() {
  const app = useApp()
  const role = roleKey(app.user.role)
  const view = dashboardFor(role, app.data)
  const synced = app.apiStatus === 'live'
  const statusLabel = app.apiStatus === 'loading' ? 'Syncing' : synced ? 'Live' : app.apiStatus === 'offline' ? 'Offline' : 'Connecting'
  const department = app.user.departmentName || '—'
  const branch = app.currentBranch || app.user.branchName || '—'

  return <div className="role-dashboard">
    <header className="role-dashboard-header">
      <div className="role-dashboard-heading">
        <div className="role-dashboard-kicker">
          <span>{app.user.role}</span>
          <span className={`live-state ${synced ? 'is-live' : app.apiStatus === 'offline' ? 'is-offline' : ''}`}><i />{statusLabel}</span>
        </div>
        <h1>{dashboardTitleFor(role)}</h1>
        <p>{view.subtitle}</p>
      </div>
      <div className="role-dashboard-tools">
        <span className="dashboard-date">{formatDashboardDate()}</span>
        <button type="button" onClick={app.refreshData} className="erp-secondary"><Icon name="refresh" size={17} />Refresh</button>
      </div>
    </header>

    {view.primaryAction && <section className="dashboard-primary-action">
      <span className="dashboard-primary-icon"><Icon name={view.primaryAction.icon} size={20} color="#fff" /></span>
      <div className="dashboard-primary-copy"><strong>{view.primaryAction.title}</strong><span>{view.primaryAction.hint}</span></div>
      <button type="button" onClick={() => app.navTo(view.primaryAction!.route, view.primaryAction!.label)} className="erp-primary">{view.primaryAction.label}<Icon name="arrow_forward" size={17} /></button>
    </section>}

    <section className="dashboard-section">
      <div className="dashboard-section-heading"><div><h2>Overview</h2><span>Current workload</span></div></div>
      <div className="task-card-grid">
        {view.tasks.map((task) => <Task key={task.label} task={task} onClick={() => app.navTo(task.route, task.routeLabel)} />)}
      </div>
    </section>

    <div className="dashboard-work-grid">
      <section className="dashboard-panel dashboard-queue-panel">
        <div className="dashboard-panel-header"><div><h3>{view.queueTitle}</h3><span>{view.queueHint}</span></div><button type="button" onClick={() => app.navTo(view.queueRoute, view.queueRouteLabel)} className="dashboard-link-button">Open workspace <Icon name="arrow_forward" size={15} /></button></div>
        <div className="dashboard-activity-list">
          {view.activities.slice(0, 8).map((row) => <button key={`${row.id}-${row.title}`} type="button" onClick={() => app.navTo(row.route, row.routeLabel)} className="dashboard-activity-row">
            <div className="dashboard-activity-copy"><strong>{row.title}</strong><span>{row.detail}</span></div>
            <span style={statusBadge(row.status)}>{friendlyStatus(row.status)}</span>
            <span className="dashboard-activity-date">{row.date || ''}</span>
            <Icon name="chevron_right" size={17} color="var(--text-faint)" />
          </button>)}
          {!view.activities.length && <EmptyState />}
        </div>
      </section>

      <aside className="dashboard-panel dashboard-context-panel">
        <div className="dashboard-panel-header"><div><h3>Work context</h3><span>Current account scope</span></div></div>
        <div className="dashboard-context-list">
          <ContextRow label="Role" value={app.user.role || '—'} />
          {app.user.departmentName && <ContextRow label="Department" value={department} />}
          {(app.currentBranch || app.user.branchName) && <ContextRow label="Property" value={branch} />}
          <ContextRow label="Data" value={statusLabel} tone={synced ? 'good' : app.apiStatus === 'offline' ? 'bad' : undefined} />
          {view.context.map((item) => <ContextRow key={item.label} label={item.label} value={item.value} />)}
        </div>
        <button type="button" onClick={() => app.navTo(view.queueRoute, view.queueRouteLabel)} className="dashboard-context-action">Open {view.queueRouteLabel}<Icon name="arrow_forward" size={16} /></button>
      </aside>
    </div>
  </div>
}

function Task({ task, onClick }: { task: TaskCard; onClick: () => void }) {
  const tone = task.tone || 'accent'
  return <button type="button" onClick={onClick} className={`dashboard-task-card tone-${tone}`}>
    <span className="dashboard-task-icon"><Icon name={task.icon} size={18} /></span>
    <strong className="dashboard-task-count">{task.count}</strong>
    <span className="dashboard-task-label">{task.label}</span>
    <span className="dashboard-task-hint">{task.hint}</span>
    <Icon name="arrow_forward" size={15} color="var(--text-faint)" />
  </button>
}

function ContextRow({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return <div className="dashboard-context-row"><span>{label}</span><strong className={tone ? `tone-${tone}` : ''}>{value}</strong></div>
}

function dashboardFor(role: string, data: any): DashboardView {
  const requests = data.storeRequisitions || []
  const procurement = data.requisitions || []
  const orders = data.orders || []
  const grns = data.grns || []
  const suppliers = data.suppliers || []
  const supplierItems = data.supplierItems || []
  const items = data.items || []
  const uoms = data.uoms || []
  const itemUnits = data.itemUnits || []
  const task = (label: string, rows: any[], hint: string, icon: string, route: string, routeLabel: string, tone?: TaskCard['tone']): TaskCard => ({ label, count: rows.length, hint, icon, route, routeLabel, tone })
  const activity = (rows: any[], title: (row:any)=>string, detail: (row:any)=>string, route: string, routeLabel: string): ActivityRow[] => rows.map((row) => ({ id: ref(row), title: title(row), detail: detail(row), status: String(row.status || row.statusCode || 'Open'), date: String(row.date || row.required_date || ''), route, routeLabel }))

  if (role === 'system administrator') {
    const operational = [...requests, ...procurement, ...orders, ...grns]
    const recent = [
      ...activity(orders, r => `LPO ${ref(r)}`, r => `${r.supplier || 'Supplier'} · ${money(r.total || 0)}`, 'workflow-procure', 'Procurement workflow'),
      ...activity(grns, r => `GRN ${ref(r)}`, r => `${r.supplier || 'Supplier'} · ${r.receivedBy || r.received_by || 'Goods receipt'}`, 'workflow-procure', 'Procurement workflow'),
    ]
    return base({
      subtitle: 'System oversight, access control and operational visibility.',
      tasks: [
        task('Properties', data.branches || [], 'Configured hotel properties', 'business', 'hotel-profile', 'Hotel profile'),
        task('Departments', data.departments || [], 'Operational departments', 'account_tree', 'departments', 'Departments'),
        task('Stores', data.locations || [], 'Configured store locations', 'warehouse', 'locations', 'Stores'),
        task('Transactions', operational, 'Current workflow records', 'monitoring', 'reports', 'Reports'),
      ],
      activities: recent,
      queueTitle: 'Recent operational activity',
      queueHint: 'Latest purchasing and receiving records',
      queueRoute: 'audit-log',
      queueRouteLabel: 'Audit trail',
      context: [
        { label: 'Employees', value: String((data.employees || []).length) },
        { label: 'Suppliers', value: String(suppliers.length) },
      ],
      primaryAction: { title: 'User access', hint: 'Manage accounts, roles and access status.', label: 'Manage access', route: 'access-management', icon: 'manage_accounts' },
    })
  }

  if (role === 'requester') {
    const drafts = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='draft')
    const pending = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='pending_department_approval')
    const progressing = requests.filter((r:any)=>['submitted','awaiting_procurement','approved','partially_approved','partially_issued'].includes(statusKey(r.statusCode || r.status)))
    const completed = requests.filter((r:any)=>['issued','completed'].includes(statusKey(r.statusCode || r.status)))
    return base({
      subtitle: 'Create and track department requisitions.',
      tasks: [task('Drafts', drafts, 'Continue before submitting', 'edit_note', 'workflow-stores', 'My requisitions'), task('Pending HOD', pending, 'Waiting for department approval', 'approval', 'workflow-stores', 'My requisitions', 'warning'), task('In progress', progressing, 'With Stores or Procurement', 'hourglass_top', 'workflow-stores', 'My requisitions'), task('Completed', completed, 'Completed requisitions', 'task_alt', 'workflow-stores', 'My requisitions', 'good')],
      activities: activity(requests, r=>`Requisition ${ref(r)}`, r=>`${r.itemSummary || r.purpose || 'Department request'}`, 'workflow-stores', 'My requisitions'),
      queueTitle: 'My requisitions', queueHint: 'Your latest department requests', queueRoute: 'workflow-stores', queueRouteLabel: 'My requisitions',
      context: [], primaryAction: { title: 'Create requisition', hint: 'Add the required articles and quantities.', label: 'New requisition', route: 'workflow-stores', icon: 'add' },
    })
  }

  if (role === 'department head') {
    const pending = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='pending_department_approval')
    const approved = requests.filter((r:any)=>Boolean(r.departmentApprovedAt) || ['submitted','awaiting_procurement','approved','partially_approved','partially_issued','issued','completed'].includes(statusKey(r.statusCode || r.status)))
    const rejected = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='rejected')
    return base({ subtitle: 'Department requisitions awaiting review and approval.', tasks: [task('Awaiting approval', pending, 'Requires your decision', 'approval', 'workflow-stores', 'Department approvals', pending.length ? 'warning' : 'good'), task('Approved', approved, 'Released to Store Keeper', 'check_circle', 'workflow-stores', 'Department approvals', 'good'), task('Rejected', rejected, 'Stopped or returned requests', 'cancel', 'workflow-stores', 'Department approvals', rejected.length ? 'danger' : 'accent')], activities: activity(pending, r=>`Requisition ${ref(r)}`, r=>`${r.requester || 'Requester'} · ${r.itemSummary || r.purpose || ''}`, 'workflow-stores', 'Department approvals'), queueTitle: 'Awaiting your decision', queueHint: 'Open a requisition to review items before deciding', queueRoute: 'workflow-stores', queueRouteLabel: 'Department approvals', context: [] }) }

  if (role === 'store keeper') {
    const newRows = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='submitted')
    const procurementRows = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='awaiting_procurement')
    const processedRows = requests.filter((r:any)=>Boolean(r.departmentApprovedAt || r.department_approved_at) && !['submitted','awaiting_procurement'].includes(statusKey(r.statusCode || r.status)))
    return base({ subtitle: 'HOD-approved requisitions and store handoffs.', tasks: [task('Pending requests', newRows, 'Choose destination store and quantities', 'assignment', 'workflow-stores', 'Store Keeper queue', newRows.length ? 'warning' : 'good'), task('Forwarded to Procurement', procurementRows, 'Waiting for Procurement action', 'shopping_cart_checkout', 'workflow-stores', 'Store Keeper queue'), task('Processed history', processedRows, 'Previously handled requisitions', 'history', 'workflow-stores', 'Store Keeper queue')], activities: activity([...newRows,...procurementRows], r=>`Requisition ${ref(r)}`, r=>`${r.department || 'Department'} · ${r.itemSummary || ''}`, 'workflow-stores', 'Store Keeper queue'), queueTitle: 'Store Keeper queue', queueHint: 'HOD-approved requisitions that need your action', queueRoute: 'workflow-stores', queueRouteLabel: 'Store Keeper queue', context: [{label:'Assigned stores',value:String((data.locations||[]).length)}] }) }

  if (role === 'cost controller') {
    const activeSuppliers = suppliers.filter((r:any)=>statusKey(r.status)==='active')
    const activePrices = supplierItems.filter((r:any)=>statusKey(r.status)==='active')
    const missingConversions = items.filter((item:any)=>!itemUnits.some((unit:any)=>String(unit.itemId || unit.item)===String(item.id)))
    return base({ subtitle: 'Suppliers, catalogue, units and quotation data.', tasks: [task('Suppliers', activeSuppliers, 'Approved supplier records', 'local_shipping', 'suppliers', 'Suppliers'), task('Supplier quotations', activePrices, 'Current item prices', 'request_quote', 'supplierItems', 'Supplier quotations'), task('Catalogue setup', items, 'Major Groups → Item Groups → Items', 'account_tree', 'categories', 'Inventory Catalogue Setup'), task('Units & conversions', itemUnits, `${missingConversions.length} article(s) without conversion`, 'calculate', 'uoms', 'Units & conversions', missingConversions.length ? 'warning' : 'good')], activities: activity(supplierItems, r=>`${r.article || 'Article'} · ${r.supplier || 'Supplier'}`, r=>`${money(r.price || 0)} per ${r.unit || 'unit'} · Quote ${r.quotationReference || 'not recorded'}`, 'supplierItems', 'Supplier quotations'), queueTitle: 'Supplier quotation catalogue', queueHint: 'Supplier + article + quotation + price', queueRoute: 'supplierItems', queueRouteLabel: 'Supplier quotations', context: [{label:'Units configured',value:String(uoms.length)},{label:'Active suppliers',value:String(activeSuppliers.length)}], primaryAction: { title: 'Inventory catalogue setup', hint: 'Create Major Groups, Item Groups and Items in sequence.', label: 'Open catalogue setup', route: 'categories', icon: 'account_tree' } }) }

  if (role === 'procurement manager') {
    const supplierSelection = procurement.filter((r:any)=>{ const state=statusKey(r.statusCode || r.status); if(!['approved','partially_ordered'].includes(state)) return false; const lines=(data.requisitionItems||[]).filter((line:any)=>String(line.requisition)===String(r.id)); return !lines.length || lines.some((line:any)=>!line.procurement_supplier_price || Number(line.procurement_quantity||0)<=0 || Number(line.procurement_unit_cost||0)<=0) })
    const drafts = orders.filter((r:any)=>statusKey(r.status)==='draft')
    const approved = orders.filter((r:any)=>statusKey(r.status)==='approved')
    const deliveries = orders.filter((r:any)=>['issued','partially_received'].includes(statusKey(r.status)))
    return base({ subtitle: 'Supplier allocation, LPO preparation and supplier issue.', tasks: [task('Supplier allocation', supplierSelection, 'Choose supplier per item', 'compare_arrows', 'workflow-procure', 'Procurement queue', supplierSelection.length ? 'warning' : 'good'), task('LPO preparation', drafts, 'Complete and send to Finance', 'description', 'workflow-procure', 'Procurement queue'), task('Approved · Print & Send', approved, 'Original print and supplier email', 'print', 'workflow-procure', 'Procurement queue', approved.length ? 'warning' : 'good'), task('Supplier delivery pending', deliveries, 'Issued or partially received', 'local_shipping', 'workflow-procure', 'Procurement queue')], activities: activity([...approved,...drafts,...supplierSelection], r=>statusKey(r.status)==='approved'?`LPO ${ref(r)}`:`${ref(r)}`, r=>r.supplier ? `${r.supplier} · ${money(r.total || 0)}` : `${r.dept || r.department || 'Store Requisition'} · ${r.reason || ''}`, 'workflow-procure', 'Procurement queue'), queueTitle: 'Procurement action queue', queueHint: 'Supplier decisions and LPO actions that need Procurement', queueRoute: 'workflow-procure', queueRouteLabel: 'Procurement queue', context: [{label:'Registered suppliers',value:String(suppliers.length)},{label:'Open supplier deliveries',value:String(deliveries.length)}] }) }

  if (role === 'financial manager') {
    const pending = orders.filter((r:any)=>statusKey(r.status)==='pending_approval' && /finance/.test(pendingApprovalStage(r)))
    const approved = orders.filter((r:any)=>['approved','issued','partially_received','received'].includes(statusKey(r.status)))
    const rejected = orders.filter((r:any)=>statusKey(r.status)==='rejected')
    return base({ subtitle: 'LPOs awaiting financial review.', tasks: [task('Awaiting review', pending, 'Requires Finance decision', 'account_balance_wallet', 'workflow-procure', 'LPO approvals', pending.length ? 'warning' : 'good'), task('Approved / progressed', approved, 'Finance-approved LPOs', 'check_circle', 'workflow-procure', 'LPO approvals', 'good'), task('Rejected', rejected, 'Stopped LPOs', 'cancel', 'workflow-procure', 'LPO approvals', rejected.length ? 'danger' : 'accent')], activities: activity(pending, r=>`LPO ${ref(r)}`, r=>`${r.supplier || 'Supplier'} · ${money(r.total || 0)}`, 'workflow-procure', 'LPO approvals'), queueTitle: 'Financial approval queue', queueHint: 'LPOs requiring financial decision', queueRoute: 'workflow-procure', queueRouteLabel: 'LPO approvals', context: [] }) }

  if (role === 'general manager') {
    const pending = orders.filter((r:any)=>statusKey(r.status)==='pending_approval' && /(general manager|management)/.test(pendingApprovalStage(r)))
    const approved = orders.filter((r:any)=>['approved','issued','partially_received','received'].includes(statusKey(r.status)))
    const rejected = orders.filter((r:any)=>statusKey(r.status)==='rejected')
    return base({ subtitle: 'Finance-reviewed LPOs awaiting final approval.', tasks: [task('Final approval', pending, 'Requires your decision', 'verified_user', 'workflow-procure', 'Final LPO approvals', pending.length ? 'warning' : 'good'), task('Approved', approved, 'Authorized LPOs', 'check_circle', 'workflow-procure', 'Final LPO approvals', 'good'), task('Rejected', rejected, 'Workflow stopped', 'cancel', 'workflow-procure', 'Final LPO approvals', rejected.length ? 'danger' : 'accent')], activities: activity(pending, r=>`LPO ${ref(r)}`, r=>`${r.supplier || 'Supplier'} · ${money(r.total || 0)}`, 'workflow-procure', 'Final LPO approvals'), queueTitle: 'Final LPO approvals', queueHint: 'Finance-reviewed LPOs awaiting executive authorization', queueRoute: 'workflow-procure', queueRouteLabel: 'Final LPO approvals', context: [] }) }

  if (role === 'receiving clerk') {
    const ready = orders.filter((r:any)=>statusKey(r.status)==='issued')
    const partial = orders.filter((r:any)=>statusKey(r.status)==='partially_received')
    const completed = orders.filter((r:any)=>statusKey(r.status)==='received')
    return base({ subtitle: 'Issued LPOs and goods receipts.', tasks: [task('Ready for receiving', ready, 'Issued LPOs', 'move_to_inbox', 'workflow-procure', 'Receiving & GRN', ready.length ? 'warning' : 'good'), task('Partial deliveries', partial, 'Outstanding quantities remain', 'pending_actions', 'workflow-procure', 'Receiving & GRN', partial.length ? 'warning' : 'accent'), task('GRNs recorded', grns, 'Receipt documents', 'receipt_long', 'workflow-procure', 'Receiving & GRN'), task('Fully received', completed, 'Completed supplier deliveries', 'task_alt', 'workflow-procure', 'Receiving & GRN', 'good')], activities: activity([...ready,...partial], r=>`LPO ${ref(r)}`, r=>`${r.supplier || 'Supplier'} · ${r.count || 0} item(s)`, 'workflow-procure', 'Receiving & GRN'), queueTitle: 'Ready for receiving', queueHint: 'Issued and partially received LPOs', queueRoute: 'workflow-procure', queueRouteLabel: 'Receiving & GRN', context: [] }) }

  return base({ subtitle: 'Operational records and workflow status.', tasks: [task('Department requests', requests, 'Visible requisitions', 'assignment', 'workflow-stores', 'Department workflow'), task('Procurement requests', procurement, 'Visible procurement records', 'shopping_cart_checkout', 'workflow-procure', 'Procurement workflow'), task('LPOs', orders, 'Visible purchase orders', 'description', 'workflow-procure', 'Procurement workflow'), task('GRNs', grns, 'Visible goods receipts', 'receipt_long', 'workflow-procure', 'Procurement workflow')], activities: [], queueTitle: 'Operations', queueHint: 'Use the workflow queues to continue work', queueRoute: 'workflow-procure', queueRouteLabel: 'Procurement workflow', context: [] })
}

function base(config: DashboardView): DashboardView { return config }
function dashboardTitleFor(role: string) {
  const titles: Record<string, string> = {
    requester: 'My requisitions',
    'department head': 'Department approvals',
    'store keeper': 'Stores overview',
    'cost controller': 'Commercial data',
    'procurement manager': 'Procurement overview',
    'procurement officer': 'Procurement overview',
    'financial manager': 'Financial approvals',
    'general manager': 'Executive approvals',
    'receiving clerk': 'Receiving overview',
    'system administrator': 'Operations overview',
  }
  return titles[role] || 'Operations overview'
}
function formatDashboardDate() {
  return new Intl.DateTimeFormat('en-UG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())
}
function friendlyStatus(value: string) { return String(value || 'Open').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }
function statusBadge(value: string): CSSProperties { const key=statusKey(value); const danger=/rejected|cancelled/.test(key); const good=/approved|received|issued|completed|active/.test(key); const warn=/pending|partial|awaiting|draft/.test(key); return { justifySelf:'start', padding:'4px 8px', borderRadius:999, color:danger?'var(--bad)':good?'var(--good)':warn?'var(--warn)':'var(--accent)', background:danger?'var(--bad-soft)':good?'var(--good-soft)':warn?'var(--warn-soft)':'var(--accent-soft)', fontSize:12, fontWeight:650, whiteSpace:'nowrap' } }
function EmptyState() { return <div className="dashboard-empty"><span><Icon name="task_alt" size={20} color="var(--good)" /></span><strong>Queue clear</strong><small>No pending records.</small></div> }
