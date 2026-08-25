import type { CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-sm)' }
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
  responsibility: string
  boundary: string
  context: Array<{ label: string; value: string }>
  primaryAction?: PrimaryAction
}

export default function Dashboard() {
  const app = useApp()
  const role = roleKey(app.user.role)
  const view = dashboardFor(role, app.data)
  const greeting = greetingForHour(new Date().getHours())

  return <div className="role-dashboard" style={{ maxWidth: 1360, margin: '0 auto' }}>
    <header className="role-dashboard-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', marginBottom: 20 }}>
      <div>
        <div style={{ color: 'var(--accent)', fontSize: 11.5, fontWeight: 750 }}>{app.user.role}</div>
        <h1 style={{ margin: '3px 0 5px', color: 'var(--text)', fontSize: 29, fontWeight: 750, letterSpacing: '-.035em' }}>{greeting}, {firstName(app.user.name)}</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13.5 }}>{view.subtitle}</p>
      </div>
      <button type="button" onClick={app.refreshData} style={secondaryButton}><Icon name="refresh" size={17} />Refresh</button>
    </header>

    {view.primaryAction && <section style={{ ...card, padding: 18, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, background: 'linear-gradient(135deg,var(--surface),var(--accent-soft))' }}>
      <span style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 9, background: 'var(--accent)', color: '#fff' }}><Icon name={view.primaryAction.icon} size={21} color="#fff" /></span>
      <div style={{ flex: 1 }}><div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 750 }}>{view.primaryAction.title}</div><div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 12 }}>{view.primaryAction.hint}</div></div>
      <button type="button" onClick={() => app.navTo(view.primaryAction!.route, view.primaryAction!.label)} style={primaryButton}>{view.primaryAction.label}<Icon name="arrow_forward" size={17} /></button>
    </section>}

    <section style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 9 }}><div><h2 style={{ margin: 0, color: 'var(--text)', fontSize: 17 }}>Action queue</h2><div style={{ marginTop: 2, color: 'var(--text-faint)', fontSize: 11.5 }}>What needs your attention now</div></div></div>
      <div className="task-card-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, view.tasks.length))},minmax(190px,1fr))`, gap: 10 }}>
        {view.tasks.map((task) => <Task key={task.label} task={task} onClick={() => app.navTo(task.route, task.routeLabel)} />)}
      </div>
    </section>

    <div className="dashboard-work-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) minmax(280px,.65fr)', gap: 14 }}>
      <section style={{ ...card, overflow: 'hidden' }}>
        <div style={sectionHeader}><div><div style={sectionTitle}>{view.queueTitle}</div><div style={sectionSub}>{view.queueHint}</div></div><button type="button" onClick={() => app.navTo(view.queueRoute, view.queueRouteLabel)} style={linkButton}>Open workspace <Icon name="arrow_forward" size={15} /></button></div>
        {view.activities.slice(0, 8).map((row) => <button key={`${row.id}-${row.title}`} type="button" onClick={() => app.navTo(row.route, row.routeLabel)} className="hover-surface2" style={activityRow}>
          <div style={{ minWidth: 0 }}><div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</div><div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.detail}</div></div>
          <span style={statusBadge(row.status)}>{friendlyStatus(row.status)}</span>
          <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>{row.date || ''}</span>
          <Icon name="chevron_right" size={17} color="var(--text-faint)" />
        </button>)}
        {!view.activities.length && <EmptyState text="Nothing currently requires your attention." />}
      </section>

      <aside style={{ ...card, padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 750, color: 'var(--text)' }}>Your responsibility</div>
        <div style={{ marginTop: 5, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>{view.responsibility}</div>
        <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />
        <div style={{ color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.045em' }}>Information boundary</div>
        <div style={{ marginTop: 7, color: 'var(--text)', fontSize: 12.5, lineHeight: 1.55 }}>{view.boundary}</div>
        {view.context.length > 0 && <><div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} /><div style={{ display: 'grid', gap: 8 }}>{view.context.map((item) => <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{item.label}</span><strong style={{ color: 'var(--text)', fontSize: 11.5 }}>{item.value}</strong></div>)}</div></>}
      </aside>
    </div>
  </div>
}

function Task({ task, onClick }: { task: TaskCard; onClick: () => void }) {
  const palette = task.tone === 'danger' ? ['var(--bad)', 'var(--bad-soft)'] : task.tone === 'warning' ? ['var(--warn)', 'var(--warn-soft)'] : task.tone === 'good' ? ['var(--good)', 'var(--good-soft)'] : ['var(--accent)', 'var(--accent-soft)']
  return <button type="button" onClick={onClick} className="hover-card" style={{ ...card, minHeight: 116, padding: 15, textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><span style={{ width: 31, height: 31, display: 'grid', placeItems: 'center', borderRadius: 7, color: palette[0], background: palette[1] }}><Icon name={task.icon} size={18} /></span><strong style={{ color: 'var(--text)', fontSize: 24, letterSpacing: '-.025em' }}>{task.count}</strong></div>
    <div style={{ marginTop: 12, color: 'var(--text)', fontSize: 12.5, fontWeight: 700 }}>{task.label}</div>
    <div style={{ marginTop: 3, color: 'var(--text-faint)', fontSize: 10.5, lineHeight: 1.45 }}>{task.hint}</div>
  </button>
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

  if (role === 'requester') {
    const drafts = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='draft')
    const pending = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='pending_department_approval')
    const progressing = requests.filter((r:any)=>['submitted','awaiting_procurement','approved','partially_approved','partially_issued'].includes(statusKey(r.statusCode || r.status)))
    const completed = requests.filter((r:any)=>['issued','completed'].includes(statusKey(r.statusCode || r.status)))
    return base({
      subtitle: 'Request what your department needs and track each requisition to completion.',
      tasks: [task('Drafts', drafts, 'Continue before submitting', 'edit_note', 'workflow-stores', 'My requisitions'), task('Pending HOD', pending, 'Waiting for department approval', 'approval', 'workflow-stores', 'My requisitions', 'warning'), task('In progress', progressing, 'With Stores or Procurement', 'hourglass_top', 'workflow-stores', 'My requisitions'), task('Completed', completed, 'Fully issued requests', 'task_alt', 'workflow-stores', 'My requisitions', 'good')],
      activities: activity(requests, r=>`Requisition ${ref(r)}`, r=>`${r.itemSummary || r.purpose || 'Department request'}`, 'workflow-stores', 'My requisitions'),
      queueTitle: 'My requisitions', queueHint: 'Your latest department requests', queueRoute: 'workflow-stores', queueRouteLabel: 'My requisitions',
      responsibility: 'Create department requisitions using only article, quantity and a reason or note, then submit them for HOD approval.',
      boundary: 'Supplier names, quotations, prices and commercial totals are intentionally hidden from this role.',
      context: [], primaryAction: { title: 'Need an item?', hint: 'Start one requisition and add all required articles before submitting.', label: 'New requisition', route: 'workflow-stores', icon: 'add' },
    })
  }

  if (role === 'department head') {
    const pending = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='pending_department_approval')
    const approved = requests.filter((r:any)=>Boolean(r.departmentApprovedAt) || ['submitted','awaiting_procurement','approved','partially_approved','partially_issued','issued','completed'].includes(statusKey(r.statusCode || r.status)))
    const rejected = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='rejected')
    return base({ subtitle: 'Review department need and make a clear approval decision.', tasks: [task('Awaiting approval', pending, 'Requires your decision', 'approval', 'workflow-stores', 'Department approvals', pending.length ? 'warning' : 'good'), task('Approved', approved, 'Released to Store Keeper', 'check_circle', 'workflow-stores', 'Department approvals', 'good'), task('Rejected', rejected, 'Stopped or returned requests', 'cancel', 'workflow-stores', 'Department approvals', rejected.length ? 'danger' : 'accent')], activities: activity(pending, r=>`Requisition ${ref(r)}`, r=>`${r.requester || 'Requester'} · ${r.itemSummary || r.purpose || ''}`, 'workflow-stores', 'Department approvals'), queueTitle: 'Awaiting your decision', queueHint: 'Open a requisition to review items before deciding', queueRoute: 'workflow-stores', queueRouteLabel: 'Department approvals', responsibility: 'Confirm that the department request is legitimate. Approve it to the Store Keeper or reject it with a reason.', boundary: 'You review the department request only. Supplier and price decisions remain with Procurement.', context: [] }) }

  if (role === 'store keeper') {
    const newRows = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='submitted')
    const procurementRows = requests.filter((r:any)=>statusKey(r.statusCode || r.status)==='awaiting_procurement')
    const processedRows = requests.filter((r:any)=>Boolean(r.departmentApprovedAt || r.department_approved_at) && !['submitted','awaiting_procurement'].includes(statusKey(r.statusCode || r.status)))
    return base({ subtitle: 'Review HOD-approved requisitions and forward the required quantities to Procurement.', tasks: [task('Pending requests', newRows, 'Choose destination store and quantities', 'assignment', 'workflow-stores', 'Store Keeper queue', newRows.length ? 'warning' : 'good'), task('Forwarded to Procurement', procurementRows, 'Waiting for Procurement action', 'shopping_cart_checkout', 'workflow-stores', 'Store Keeper queue'), task('Processed history', processedRows, 'Previously handled requisitions', 'history', 'workflow-stores', 'Store Keeper queue')], activities: activity([...newRows,...procurementRows], r=>`Requisition ${ref(r)}`, r=>`${r.department || 'Department'} · ${r.itemSummary || ''}`, 'workflow-stores', 'Store Keeper queue'), queueTitle: 'Store Keeper queue', queueHint: 'HOD-approved requisitions that need your action', queueRoute: 'workflow-stores', queueRouteLabel: 'Store Keeper queue', responsibility: 'Choose the destination store, confirm or reduce each approved quantity, add a note where necessary, and forward the requisition to Procurement.', boundary: 'Your work on the requisition ends after it is forwarded to Procurement.', context: [{label:'Assigned stores',value:String((data.locations||[]).length)}] }) }

  if (role === 'cost controller') {
    const activeSuppliers = suppliers.filter((r:any)=>statusKey(r.status)==='active')
    const activePrices = supplierItems.filter((r:any)=>statusKey(r.status)==='active')
    const missingConversions = items.filter((item:any)=>!itemUnits.some((unit:any)=>String(unit.itemId || unit.item)===String(item.id)))
    return base({ subtitle: 'Maintain the approved supplier, article, UOM and quotation information Procurement relies on.', tasks: [task('Suppliers', activeSuppliers, 'Approved supplier records', 'local_shipping', 'suppliers', 'Suppliers'), task('Supplier quotations', activePrices, 'Current item prices', 'request_quote', 'supplierItems', 'Supplier quotations'), task('Articles', items, 'Article master records', 'inventory_2', 'items', 'Articles / items'), task('UOM conversions', itemUnits, `${missingConversions.length} article(s) without conversion`, 'calculate', 'itemUnits', 'UOM conversions', missingConversions.length ? 'warning' : 'good')], activities: activity(supplierItems, r=>`${r.article || 'Article'} · ${r.supplier || 'Supplier'}`, r=>`${money(r.price || 0)} per ${r.unit || 'unit'} · Quote ${r.quotationReference || 'not recorded'}`, 'supplierItems', 'Supplier quotations'), queueTitle: 'Supplier quotation catalogue', queueHint: 'Supplier + article + quotation + price', queueRoute: 'supplierItems', queueRouteLabel: 'Supplier quotations', responsibility: 'Register vetted suppliers and maintain the articles they supply, quotation references, quoted prices, units and conversions.', boundary: 'You maintain master and quotation data. You do not approve department requisitions or LPOs.', context: [{label:'Units configured',value:String(uoms.length)},{label:'Active suppliers',value:String(activeSuppliers.length)}], primaryAction: { title: 'Maintain commercial master data', hint: 'Register an approved supplier or update the supplier quotation catalogue.', label: 'Open suppliers', route: 'suppliers', icon: 'local_shipping' } }) }

  if (role === 'procurement manager') {
    const supplierSelection = procurement.filter((r:any)=>{ const state=statusKey(r.statusCode || r.status); if(!['approved','partially_ordered'].includes(state)) return false; const lines=(data.requisitionItems||[]).filter((line:any)=>String(line.requisition)===String(r.id)); return !lines.length || lines.some((line:any)=>!line.procurement_supplier_price || Number(line.procurement_quantity||0)<=0 || Number(line.procurement_unit_cost||0)<=0) })
    const drafts = orders.filter((r:any)=>statusKey(r.status)==='draft')
    const approved = orders.filter((r:any)=>statusKey(r.status)==='approved')
    const deliveries = orders.filter((r:any)=>['issued','partially_received'].includes(statusKey(r.status)))
    return base({ subtitle: 'Allocate vetted suppliers by item, confirm current prices and manage LPOs through supplier issue.', tasks: [task('Supplier allocation', supplierSelection, 'Choose supplier per item', 'compare_arrows', 'workflow-procure', 'Procurement queue', supplierSelection.length ? 'warning' : 'good'), task('LPO preparation', drafts, 'Complete and send to Finance', 'description', 'workflow-procure', 'Procurement queue'), task('Approved · Print & Send', approved, 'Original print and supplier email', 'print', 'workflow-procure', 'Procurement queue', approved.length ? 'warning' : 'good'), task('Supplier delivery pending', deliveries, 'Issued or partially received', 'local_shipping', 'workflow-procure', 'Procurement queue')], activities: activity([...approved,...drafts,...supplierSelection], r=>statusKey(r.status)==='approved'?`LPO ${ref(r)}`:`${ref(r)}`, r=>r.supplier ? `${r.supplier} · ${money(r.total || 0)}` : `${r.dept || r.department || 'Store Requisition'} · ${r.reason || ''}`, 'workflow-procure', 'Procurement queue'), queueTitle: 'Procurement action queue', queueHint: 'Supplier decisions and LPO actions that need Procurement', queueRoute: 'workflow-procure', queueRouteLabel: 'Procurement queue', responsibility: 'Select the suitable vetted supplier for each item, confirm the current price, reduce quantity where needed, prepare LPOs, then print and email finally approved LPOs.', boundary: 'Procurement can see supplier and price information. Finance and GM approvals remain independent.', context: [{label:'Registered suppliers',value:String(suppliers.length)},{label:'Open supplier deliveries',value:String(deliveries.length)}] }) }

  if (role === 'financial manager') {
    const pending = orders.filter((r:any)=>statusKey(r.status)==='pending_approval' && /finance/.test(pendingApprovalStage(r)))
    const approved = orders.filter((r:any)=>['approved','issued','partially_received','received'].includes(statusKey(r.status)))
    const rejected = orders.filter((r:any)=>statusKey(r.status)==='rejected')
    return base({ subtitle: 'Review LPO quantities and financial commitment before General Manager approval.', tasks: [task('Awaiting review', pending, 'Requires Finance decision', 'account_balance_wallet', 'workflow-procure', 'LPO approvals', pending.length ? 'warning' : 'good'), task('Approved / progressed', approved, 'Finance-approved LPOs', 'check_circle', 'workflow-procure', 'LPO approvals', 'good'), task('Rejected', rejected, 'Stopped LPOs', 'cancel', 'workflow-procure', 'LPO approvals', rejected.length ? 'danger' : 'accent')], activities: activity(pending, r=>`LPO ${ref(r)}`, r=>`${r.supplier || 'Supplier'} · ${money(r.total || 0)}`, 'workflow-procure', 'LPO approvals'), queueTitle: 'Financial approval queue', queueHint: 'LPOs requiring financial decision', queueRoute: 'workflow-procure', queueRouteLabel: 'LPO approvals', responsibility: 'Review supplier, quantity, price and total. Approve, reduce quantity with a reason, or reject the LPO.', boundary: 'You do not change Procurement’s original quantity or supplier decision; your approved quantity is stored separately.', context: [] }) }

  if (role === 'general manager') {
    const pending = orders.filter((r:any)=>statusKey(r.status)==='pending_approval' && /(general manager|management)/.test(pendingApprovalStage(r)))
    const approved = orders.filter((r:any)=>['approved','issued','partially_received','received'].includes(statusKey(r.status)))
    const rejected = orders.filter((r:any)=>statusKey(r.status)==='rejected')
    return base({ subtitle: 'Make the independent final decision on finance-reviewed LPOs.', tasks: [task('Final approval', pending, 'Requires your decision', 'verified_user', 'workflow-procure', 'Final LPO approvals', pending.length ? 'warning' : 'good'), task('Approved', approved, 'Authorized LPOs', 'check_circle', 'workflow-procure', 'Final LPO approvals', 'good'), task('Rejected', rejected, 'Workflow stopped', 'cancel', 'workflow-procure', 'Final LPO approvals', rejected.length ? 'danger' : 'accent')], activities: activity(pending, r=>`LPO ${ref(r)}`, r=>`${r.supplier || 'Supplier'} · ${money(r.total || 0)}`, 'workflow-procure', 'Final LPO approvals'), queueTitle: 'Final LPO approvals', queueHint: 'Finance-reviewed LPOs awaiting executive authorization', queueRoute: 'workflow-procure', queueRouteLabel: 'Final LPO approvals', responsibility: 'Approve the LPO for supplier issue or reject it with a reason. A rejection ends that LPO workflow.', boundary: 'This is an approval screen, not an editing screen. Procurement and Finance decisions remain visible but unchanged.', context: [] }) }

  if (role === 'receiving clerk') {
    const ready = orders.filter((r:any)=>statusKey(r.status)==='issued')
    const partial = orders.filter((r:any)=>statusKey(r.status)==='partially_received')
    const completed = orders.filter((r:any)=>statusKey(r.status)==='received')
    return base({ subtitle: 'Receive only against issued LPOs and record what physically arrived.', tasks: [task('Ready for receiving', ready, 'Issued LPOs', 'move_to_inbox', 'workflow-procure', 'Receiving & GRN', ready.length ? 'warning' : 'good'), task('Partial deliveries', partial, 'Outstanding quantities remain', 'pending_actions', 'workflow-procure', 'Receiving & GRN', partial.length ? 'warning' : 'accent'), task('GRNs recorded', grns, 'Receipt documents', 'receipt_long', 'workflow-procure', 'Receiving & GRN'), task('Fully received', completed, 'Completed supplier deliveries', 'task_alt', 'workflow-procure', 'Receiving & GRN', 'good')], activities: activity([...ready,...partial], r=>`LPO ${ref(r)}`, r=>`${r.supplier || 'Supplier'} · ${r.count || 0} item(s)`, 'workflow-procure', 'Receiving & GRN'), queueTitle: 'Ready for receiving', queueHint: 'Issued and partially received LPOs', queueRoute: 'workflow-procure', queueRouteLabel: 'Receiving & GRN', responsibility: 'Confirm the supplier delivery against the LPO, record the invoice/delivery note, actual received quantity, accepted/rejected quantity and generate/post the GRN.', boundary: 'The original LPO quantity is read-only. Receiving records a separate actual quantity and the system calculates outstanding balance.', context: [] }) }

  return base({ subtitle: 'Operational records available to your account.', tasks: [task('Department requests', requests, 'Visible requisitions', 'assignment', 'workflow-stores', 'Department workflow'), task('Procurement requests', procurement, 'Visible procurement records', 'shopping_cart_checkout', 'workflow-procure', 'Procurement workflow'), task('LPOs', orders, 'Visible purchase orders', 'description', 'workflow-procure', 'Procurement workflow'), task('GRNs', grns, 'Visible goods receipts', 'receipt_long', 'workflow-procure', 'Procurement workflow')], activities: [], queueTitle: 'Operations', queueHint: 'Use the workflow queues to continue work', queueRoute: 'workflow-procure', queueRouteLabel: 'Procurement workflow', responsibility: 'Administer only the operational areas assigned to this account.', boundary: 'Operational screens enforce role and backend permission controls.', context: [] })
}

function base(config: DashboardView): DashboardView { return config }
function firstName(name: string) { return String(name || '').trim().split(/\s+/)[0] || 'there' }
function greetingForHour(hour: number) { return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening' }
function friendlyStatus(value: string) { return String(value || 'Open').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }
function statusBadge(value: string): CSSProperties { const key=statusKey(value); const danger=/rejected|cancelled/.test(key); const good=/approved|received|issued|completed|active/.test(key); const warn=/pending|partial|awaiting|draft/.test(key); return { justifySelf:'start', padding:'4px 8px', borderRadius:999, color:danger?'var(--bad)':good?'var(--good)':warn?'var(--warn)':'var(--accent)', background:danger?'var(--bad-soft)':good?'var(--good-soft)':warn?'var(--warn-soft)':'var(--accent-soft)', fontSize:10, fontWeight:700, whiteSpace:'nowrap' } }
function EmptyState({ text }: { text: string }) { return <div style={{ padding: 34, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12.5 }}><Icon name="task_alt" size={25} color="var(--good)" /><div style={{ marginTop: 8 }}>{text}</div></div> }

const sectionHeader: CSSProperties = { minHeight: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--border)' }
const sectionTitle: CSSProperties = { color: 'var(--text)', fontSize: 13.5, fontWeight: 750 }
const sectionSub: CSSProperties = { color: 'var(--text-faint)', fontSize: 10.5, marginTop: 2 }
const activityRow: CSSProperties = { width:'100%', display:'grid', gridTemplateColumns:'minmax(0,1fr) auto auto 18px', alignItems:'center', gap:12, padding:'12px 16px', border:0, borderBottom:'1px solid var(--border)', background:'transparent', textAlign:'left', cursor:'pointer', font:'inherit' }
const primaryButton: CSSProperties = { minHeight:38, padding:'0 14px', display:'inline-flex', alignItems:'center', gap:7, border:0, borderRadius:7, background:'var(--accent)', color:'#fff', font:'inherit', fontSize:12, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }
const secondaryButton: CSSProperties = { minHeight:36, padding:'0 12px', display:'inline-flex', alignItems:'center', gap:6, border:'1px solid var(--border)', borderRadius:7, background:'var(--surface)', color:'var(--text-muted)', font:'inherit', fontSize:12, fontWeight:650, cursor:'pointer' }
const linkButton: CSSProperties = { border:0, background:'transparent', color:'var(--accent)', display:'inline-flex', alignItems:'center', gap:4, font:'inherit', fontSize:11.5, fontWeight:700, cursor:'pointer' }
