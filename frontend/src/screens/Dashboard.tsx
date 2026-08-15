import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const panel: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-sm)' }
const roleKey = (role: string) => role.trim().toLowerCase()
const monthKey = (date: unknown) => String(date || '').slice(0, 7)
const today = new Date().toISOString().slice(0, 10)

export default function Dashboard() {
  const app = useApp()
  const role = roleKey(app.user.role)
  const data = app.data
  const isHR = role === 'hr administrator'
  const title = dashboardTitle(role)

  const config = buildDashboard(role, data)
  const syncTone = app.apiStatus === 'live' ? 'var(--good)' : app.apiStatus === 'loading' ? 'var(--warn)' : 'var(--bad)'

  return <div className="dashboard-screen">
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
      <div>
        <h1 style={{ margin: 0, color: 'var(--text)', fontSize: 25, fontWeight: 700, letterSpacing: '-.03em' }}>{title}</h1>
        <p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>{config.subtitle} · {app.currentBranch || app.user.branchName || 'Current branch'}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: syncTone }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{app.apiStatus === 'live' ? 'Live authorised data' : app.apiStatus === 'loading' ? 'Refreshing' : 'Connection unavailable'}</span>
        <button aria-label="Refresh dashboard" onClick={app.refreshData} style={iconButton}><Icon name="refresh" size={18} /></button>
      </div>
    </div>

    <div className="enterprise-kpi-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(config.kpis.length, 6)},minmax(150px,1fr))`, gap: 10 }}>
      {config.kpis.map(kpi => <Kpi key={kpi.label} {...kpi} />)}
    </div>

    <div className="dashboard-ops-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) minmax(280px,.75fr)', gap: 14, marginTop: 14 }}>
      <ChartCard title={config.trend.title} subtitle={config.trend.subtitle}>
        <LineChart series={config.trend.series} />
      </ChartCard>
      <ChartCard title={config.status.title} subtitle={config.status.subtitle}>
        <DonutChart data={config.status.data} />
      </ChartCard>
    </div>

    <div className="dashboard-ops-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 14, marginTop: 14 }}>
      <ChartCard title={config.bars.title} subtitle={config.bars.subtitle}>
        <BarChart data={config.bars.data} valueFormatter={config.bars.money ? money : undefined} />
      </ChartCard>
      <section style={panel}>
        <PanelHeader title={config.queue.title} subtitle={config.queue.subtitle} action={config.queue.action} onAction={() => app.navTo(config.queue.route, config.queue.action)} />
        {config.queue.rows.slice(0, 7).map((row, index) => <button key={String(row.id || index)} onClick={() => config.queue.route === 'requisitions' && row.id ? app.openDetail('requisitions', String(row.id), 'dashboard') : app.navTo(config.queue.route, config.queue.action)} className="hover-surface2" style={queueRow}>
          <span><span style={primaryText}>{String(row.primary || 'Record')}</span><span style={secondaryText}>{String(row.secondary || '')}</span></span>
          <span style={{ color: 'var(--text)', fontSize: 11.5, fontWeight: 600 }}>{row.value || ''}</span>
          <Status value={String(row.status || 'Pending')} />
          <Icon name="chevron_right" size={18} color="var(--text-faint)" />
        </button>)}
        {!config.queue.rows.length && <Empty text="Nothing currently requires action." />}
      </section>
    </div>

    <div style={{ marginTop: 12, color: 'var(--text-faint)', fontSize: 10.5 }}>
      Dashboard scope: {isHR ? 'employee and department records permitted to this account' : 'records returned by the signed-in role and branch permissions'}.
    </div>
  </div>
}

type Point = { label: string; value: number }
type Series = { name: string; points: Point[] }
type KpiProps = { label: string; value: string | number; icon: string; tone?: 'neutral' | 'warning' | 'danger' | 'success' }

type DashboardConfig = {
  subtitle: string
  kpis: KpiProps[]
  trend: { title: string; subtitle: string; series: Series[] }
  status: { title: string; subtitle: string; data: Point[] }
  bars: { title: string; subtitle: string; data: Point[]; money?: boolean }
  queue: { title: string; subtitle: string; action: string; route: string; rows: any[] }
}

function buildDashboard(role: string, data: any): DashboardConfig {
  const reqs = data.requisitions || []
  const orders = data.orders || []
  const balances = data.balances || []
  const items = data.items || []
  const storeReqs = data.storeRequisitions || []
  const issues = data.stockIssues || []
  const employees = data.employees || []
  const departments = data.departments || []
  const low = items.filter((r: any) => ['Low', 'Critical'].includes(String(r.status)))

  if (['requester', 'staff', 'unassigned', 'department employee', 'employee'].includes(role)) {
    const mine = storeReqs
    const drafts = mine.filter((r: any) => normalStatus(r.status) === 'draft')
    const pending = mine.filter((r: any) => ['pending_department_approval','submitted','approved','partially_approved','awaiting_procurement','partially_issued'].includes(normalStatus(r.status)))
    const issued = mine.filter((r: any) => ['issued','completed'].includes(normalStatus(r.status)))
    return {
      subtitle: 'Your store requests and fulfilment progress',
      kpis: [
        { label: 'Total requests', value: mine.length, icon: 'assignment' },
        { label: 'Drafts', value: drafts.length, icon: 'edit_note', tone: drafts.length ? 'warning' : 'neutral' },
        { label: 'In progress', value: pending.length, icon: 'hourglass_top', tone: pending.length ? 'warning' : 'neutral' },
        { label: 'Issued', value: issued.length, icon: 'task_alt', tone: issued.length ? 'success' : 'neutral' },
      ],
      trend: { title: 'My request trend', subtitle: 'Store requests created during the last six months', series: [{ name: 'Requests', points: monthly(mine, 'created_at') }] },
      status: { title: 'My requests by status', subtitle: 'Current fulfilment stage', data: byStatus(mine) },
      bars: { title: 'Requests by purpose', subtitle: 'Most common request purposes', data: groupCount(mine, 'purpose') },
      queue: { title: 'Recent store requests', subtitle: 'Your latest requests and current status', action: 'View all requests', route: 'workflow-stores', rows: mine.map((r: any) => queueStoreReq(r)) },
    }
  }

  if (role === 'cost controller') {
    const suppliers = data.suppliers || []
    const supplierItems = data.supplierItems || []
    return {
      subtitle: 'Supplier, article and quotation master data',
      kpis: [
        { label: 'Registered suppliers', value: suppliers.length, icon: 'local_shipping' },
        { label: 'Registered articles', value: items.length, icon: 'inventory_2' },
        { label: 'Supplier prices', value: supplierItems.length, icon: 'request_quote' },
        { label: 'Units configured', value: (data.uoms || []).length, icon: 'straighten' },
      ],
      trend: { title: 'Supplier registrations', subtitle: 'Supplier master records added during the last six months', series: [{ name: 'Suppliers', points: monthly(suppliers, 'created_at') }] },
      status: { title: 'Supplier status', subtitle: 'Active and inactive supplier records', data: byStatus(suppliers) },
      bars: { title: 'Article catalogue', subtitle: 'Registered article master data', data: [] },
      queue: { title: 'Supplier catalogue', subtitle: 'Maintain supplier quotations and item prices', action: 'Open supplier catalogue', route: 'supplierItems', rows: supplierItems.map((r: any) => ({ id: r.id, primary: r.item || r.name || 'Article', secondary: r.supplier || 'Supplier', value: r.unitPrice ? money(r.unitPrice) : '', status: r.status || 'Active' })) },
    }
  }

  if (role === 'receiving clerk') {
    const readyOrders = orders.filter((r: any) => /issued|partially_received/i.test(String(r.status)))
    const grns = data.grns || []
    return {
      subtitle: 'Issued LPOs ready for receiving and GRN entry',
      kpis: [
        { label: 'Ready LPOs', value: readyOrders.length, icon: 'move_to_inbox', tone: readyOrders.length ? 'warning' : 'neutral' },
        { label: 'GRNs recorded', value: grns.length, icon: 'receipt_long' },
        { label: 'Partial deliveries', value: readyOrders.filter((r: any) => /partially_received/i.test(String(r.status))).length, icon: 'pending_actions' },
        { label: 'Completed receipts', value: orders.filter((r: any) => /received/i.test(String(r.status))).length, icon: 'task_alt', tone: 'success' },
      ],
      trend: { title: 'Goods receipts', subtitle: 'GRNs recorded during the last six months', series: [{ name: 'GRNs', points: monthly(grns, 'receivedDate') }] },
      status: { title: 'Receiving status', subtitle: 'Issued and partially received LPOs', data: byStatus(readyOrders) },
      bars: { title: 'Receiving queue', subtitle: 'LPOs awaiting physical delivery confirmation', data: [] },
      queue: { title: 'Ready for receiving', subtitle: 'Open issued LPOs', action: 'Open receiving', route: 'workflow-procure', rows: readyOrders.map((r: any) => ({ id: r.id, primary: r.id, secondary: r.supplier || 'Supplier', value: '', status: r.status })) },
    }
  }

  if (role === 'store keeper') {
    const submitted = storeReqs.filter((r: any) => ['submitted','pending_department_approval'].includes(normalStatus(r.status)))
    const procurement = storeReqs.filter((r: any) => ['awaiting_procurement','procurement_in_progress'].includes(normalStatus(r.status)))
    const completed = storeReqs.filter((r: any) => ['issued','completed','fulfilled'].includes(normalStatus(r.status)))
    return {
      subtitle: 'Department requests, destination stores and procurement hand-off',
      kpis: [
        { label: 'Department requests', value: submitted.length, icon: 'assignment', tone: submitted.length ? 'warning' : 'neutral' },
        { label: 'Sent to Procurement', value: procurement.length, icon: 'shopping_cart_checkout' },
        { label: 'Completed requests', value: completed.length, icon: 'task_alt', tone: completed.length ? 'success' : 'neutral' },
        { label: 'My visible stores', value: (data.locations || []).length, icon: 'warehouse' },
      ],
      trend: { title: 'Store requisitions', subtitle: 'Requests handled during the last six months', series: [{ name: 'Requests', points: monthly(storeReqs, 'created_at') }] },
      status: { title: 'Requests by status', subtitle: 'Current store-to-procurement progress', data: byStatus(storeReqs) },
      bars: { title: 'Requests by store', subtitle: 'Demand routed to each assigned store', data: groupCount(storeReqs, 'store') },
      queue: { title: 'Department request queue', subtitle: 'Requests requiring Store Keeper action', action: 'Open store requests', route: 'workflow-stores', rows: submitted.map((r:any)=>queueStoreReq(r)) },
    }
  }


  if (role === 'procurement manager') {
    const pending = reqs.filter((r: any) => !/completed|rejected/i.test(String(r.status)))
    return {
      subtitle: 'Purchase pipeline, LPOs and supplier activity',
      kpis: [
        { label: 'Open requisitions', value: pending.length, icon: 'request_quote', tone: pending.length ? 'warning' : 'neutral' },
        { label: 'Requisition value', value: money(sum(reqs, 'total')), icon: 'payments' },
        { label: 'Open LPOs', value: orders.filter((r: any) => !/received|closed|cancelled/i.test(String(r.status))).length, icon: 'description' },
        { label: 'Suppliers available', value: (data.suppliers || []).length, icon: 'local_shipping' },
      ],
      trend: { title: 'Monthly procurement value', subtitle: 'Estimated requisition value over time', series: [{ name: 'UGX value', points: monthly(reqs, 'date', 'total') }] },
      status: { title: 'Purchase requests by stage', subtitle: 'Current approval and procurement state', data: byStatus(reqs) },
      bars: { title: 'Requisition value by department', subtitle: 'Visible purchasing demand in UGX', data: groupSum(reqs, 'dept', 'total'), money: true },
      queue: { title: 'Procurement action queue', subtitle: 'Open requisitions requiring follow-up', action: 'Purchase requisitions', route: 'requisitions', rows: pending.map((r: any) => queueReq(r)) },
    }
  }

  if (role === 'financial manager') {
    const approved = reqs.filter((r: any) => /approved|completed|ordered/i.test(String(r.status)))
    return {
      subtitle: 'Approved procurement commitments and expense exposure',
      kpis: [
        { label: 'Approved procurement', value: money(sum(approved, 'total')), icon: 'account_balance_wallet' },
        { label: 'Approved requests', value: approved.length, icon: 'verified', tone: 'success' },
        { label: 'LPO commitments', value: money(sum(orders, 'total')), icon: 'receipt_long' },
        { label: 'Awaiting completion', value: orders.filter((r: any) => !/received|closed/i.test(String(r.status))).length, icon: 'pending_actions', tone: 'warning' },
      ],
      trend: { title: 'Monthly approved procurement', subtitle: 'Only approved financial commitments', series: [{ name: 'Approved UGX', points: monthly(approved, 'date', 'total') }] },
      status: { title: 'LPO status', subtitle: 'Purchase orders available to Finance', data: byStatus(orders) },
      bars: { title: 'Procurement value by department', subtitle: 'Approved requisitions only', data: groupSum(approved, 'dept', 'total'), money: true },
      queue: { title: 'Financial review queue', subtitle: 'Open purchase orders and commitments', action: 'Finance control centre', route: 'workflow-pay', rows: orders.filter((r: any) => !/received|closed/i.test(String(r.status))).map((r: any) => ({ id: r.id, primary: r.id, secondary: r.supplier, value: money(r.total || 0), status: r.status })) },
    }
  }

  if (role === 'general manager') {
    const finalReview = orders.filter((r: any) => /finance_approved|pending_management|pending_general|pending_director|awaiting_management/i.test(String(r.status)))
    const approved = orders.filter((r: any) => /director_approved|management_approved|approved|issued|partially_received|received|closed/i.test(String(r.status)))
    const rejected = orders.filter((r: any) => /rejected/i.test(String(r.status)))
    return {
      subtitle: 'Final LPO approval only',
      kpis: [
        { label: 'Awaiting final approval', value: finalReview.length, icon: 'approval', tone: finalReview.length ? 'warning' : 'neutral' },
        { label: 'Approved LPOs', value: approved.length, icon: 'verified', tone: approved.length ? 'success' : 'neutral' },
        { label: 'Rejected LPOs', value: rejected.length, icon: 'cancel', tone: rejected.length ? 'danger' : 'neutral' },
        { label: 'Pending LPO value', value: money(sum(finalReview, 'total')), icon: 'receipt_long' },
      ],
      trend: { title: 'Final approval activity', subtitle: 'LPOs presented for management decision', series: [{ name: 'LPOs', points: monthly(orders, 'created_at') }] },
      status: { title: 'LPO approval status', subtitle: 'Only purchase orders available to Management', data: byStatus(orders) },
      bars: { title: 'Pending LPO value by supplier', subtitle: 'Commercial commitments awaiting final decision', data: groupSum(finalReview, 'supplier', 'total'), money: true },
      queue: { title: 'Final LPO approval queue', subtitle: 'Finance-approved LPOs requiring General Manager decision', action: 'Open final approvals', route: 'workflow-procure', rows: finalReview.map((r: any) => ({ id: r.id, primary: r.id, secondary: r.supplier || 'Supplier', value: money(r.total || 0), status: r.status })) },
    }
  }


  if (role === 'hr administrator') {
    const active = employees.filter((r: any) => /active/i.test(String(r.status)))
    return {
      subtitle: 'Workforce composition and staffing activity',
      kpis: [
        { label: 'Total employees', value: employees.length, icon: 'groups' },
        { label: 'Active employees', value: active.length, icon: 'person_check', tone: 'success' },
        { label: 'Inactive employees', value: employees.length - active.length, icon: 'person_off', tone: employees.length - active.length ? 'warning' : 'neutral' },
        { label: 'Departments', value: departments.length, icon: 'account_tree' },
      ],
      trend: { title: 'Hiring trend', subtitle: 'Employees by joining month', series: [{ name: 'New hires', points: monthly(employees, 'dateJoined') }] },
      status: { title: 'Active versus inactive', subtitle: 'Current employment status', data: byStatus(employees) },
      bars: { title: 'Employees by department', subtitle: 'Current staffing distribution', data: groupCount(employees, 'department') },
      queue: { title: 'Recent employee records', subtitle: 'Latest staff additions', action: 'Employees', route: 'employees', rows: [...employees].sort((a: any,b: any) => String(b.dateJoined).localeCompare(String(a.dateJoined))).map((r: any) => ({ id: r.id, primary: r.name, secondary: `${r.department || 'No department'} · ${r.designation || 'Employee'}`, value: r.dateJoined || '', status: r.status })) },
    }
  }

  // Safe fallback: uses only data already returned to this signed-in account.
  return {
    subtitle: 'Your authorised operational workload',
    kpis: [
      { label: 'Visible requests', value: reqs.length, icon: 'request_quote' },
      { label: 'Pending actions', value: reqs.filter((r: any) => r.approvalActionable).length, icon: 'approval', tone: 'warning' },
      { label: 'Visible issues', value: issues.length, icon: 'outbox' },
      { label: 'Visible receipts', value: (data.grns || []).length, icon: 'move_to_inbox' },
    ],
    trend: { title: 'Recent request trend', subtitle: 'Records available to your account', series: [{ name: 'Requests', points: monthly(reqs, 'date') }] },
    status: { title: 'Requests by status', subtitle: 'Authorised records only', data: byStatus(reqs) },
    bars: { title: 'Requests by department', subtitle: 'Visible request distribution', data: groupCount(reqs, 'dept') },
    queue: { title: 'Recent requests', subtitle: 'Latest authorised records', action: 'Purchase requisitions', route: 'requisitions', rows: reqs.map((r: any) => queueReq(r)) },
  }
}

function Kpi({ label, value, icon, tone: toneName = 'neutral' }: KpiProps) {
  const colors = tone(toneName)
  return <div className="hover-card" style={{ ...panel, minHeight: 112, padding: 15 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 500 }}>{label}</span><span style={{ width: 29, height: 29, borderRadius: 6, display: 'grid', placeItems: 'center', background: colors.bg }}><Icon name={icon} size={17} color={colors.fg} /></span></div>
    <div style={{ color: 'var(--text)', fontSize: typeof value === 'string' && value.length > 11 ? 19 : 25, fontWeight: 700, letterSpacing: '-.025em', marginTop: 18 }}>{value}</div>
  </div>
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section style={{ ...panel, minHeight: 310 }}><PanelHeader title={title} subtitle={subtitle} action="" onAction={() => undefined} /><div style={{ padding: 18 }}>{children}</div></section>
}

function LineChart({ series }: { series: Series[] }) {
  const points = series.flatMap(s => s.points)
  if (!points.length || !points.some(p => p.value)) return <Empty text="No chart data is available for this period." />
  const max = Math.max(...points.map(p => p.value), 1)
  return <div>
    <div style={{ height: 190, display: 'flex', alignItems: 'stretch', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
      {(series[0]?.points || []).map((point) => <div key={point.label} title={`${point.label}: ${point.value.toLocaleString()}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', minWidth: 20 }}>
        <span style={{ color: 'var(--text-faint)', fontSize: 9, marginBottom: 4 }}>{point.value ? compact(point.value) : ''}</span>
        <div style={{ width: '65%', maxWidth: 34, minHeight: point.value ? 3 : 0, height: `${(point.value / max) * 145}px`, borderRadius: '5px 5px 1px 1px', background: 'var(--accent)', opacity: .82 }} />
        <span style={{ color: 'var(--text-faint)', fontSize: 9, marginTop: 7 }}>{point.label.slice(5)}</span>
      </div>)}
    </div>
    <Legend labels={series.map(s => s.name)} />
  </div>
}

function DonutChart({ data }: { data: Point[] }) {
  const total = data.reduce((s,p) => s+p.value,0)
  if (!total) return <Empty text="No status data is available." />
  let cursor = 0
  const stops = data.slice(0,7).map((p,i) => { const start=cursor; cursor += p.value/total*100; return `var(--chart-${(i%6)+1}, var(--accent)) ${start}% ${cursor}%` }).join(',')
  return <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', gap: 18, alignItems: 'center' }}>
    <div title={`Total: ${total}`} style={{ width: 145, height: 145, borderRadius: '50%', background: `conic-gradient(${stops})`, display: 'grid', placeItems: 'center' }}><div style={{ width: 82, height: 82, borderRadius: '50%', background: 'var(--surface)', display: 'grid', placeItems: 'center', color: 'var(--text)', fontSize: 22, fontWeight: 700 }}>{total}</div></div>
    <div>{data.slice(0,7).map((p,i)=><div key={p.label} title={`${p.label}: ${p.value}`} style={{ display:'grid',gridTemplateColumns:'10px minmax(0,1fr) auto',gap:8,alignItems:'center',padding:'5px 0',fontSize:11.5 }}><span style={{width:8,height:8,borderRadius:2,background:`var(--chart-${(i%6)+1}, var(--accent))`}}/><span style={{color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{clean(p.label)}</span><strong style={{color:'var(--text)'}}>{p.value}</strong></div>)}</div>
  </div>
}

function BarChart({ data, valueFormatter }: { data: Point[]; valueFormatter?: (n:number)=>string }) {
  const rows = data.slice(0,8), max = Math.max(...rows.map(p=>p.value),1)
  if (!rows.length || !rows.some(p=>p.value)) return <Empty text="No category data is available." />
  return <div>{rows.map(p=><div key={p.label} title={`${p.label}: ${valueFormatter ? valueFormatter(p.value) : p.value}`} style={{marginBottom:12}}><div style={{display:'flex',justifyContent:'space-between',gap:10,fontSize:11.5,marginBottom:5}}><span style={{color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{clean(p.label)}</span><strong style={{color:'var(--text)'}}>{valueFormatter ? valueFormatter(p.value) : p.value.toLocaleString()}</strong></div><div style={{height:8,borderRadius:8,background:'var(--surface-2)',overflow:'hidden'}}><div style={{height:'100%',width:`${Math.max(2,p.value/max*100)}%`,background:'var(--accent)',borderRadius:8}}/></div></div>)}</div>
}

function PanelHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action: string; onAction: () => void }) {
  return <div style={{ minHeight: 61, display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--border)' }}><div><div style={{ color: 'var(--text)', fontSize: 13.5, fontWeight: 650 }}>{title}</div><div style={{ color: 'var(--text-faint)', fontSize: 10.5, marginTop: 2 }}>{subtitle}</div></div>{action && <button onClick={onAction} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: 'var(--accent)', font: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>{action}</button>}</div>
}
function Status({ value }: { value: string }) { const bad=/critical|rejected|inactive/i.test(value), good=/approved|completed|active|applied|received/i.test(value); return <span style={{justifySelf:'end',color:bad?'var(--bad)':good?'var(--good)':'var(--warn)',background:bad?'var(--bad-soft)':good?'var(--good-soft)':'var(--warn-soft)',borderRadius:12,padding:'3px 8px',fontSize:10,fontWeight:600,textTransform:'capitalize'}}>{clean(value)}</span> }
function Empty({ text }: { text: string }) { return <div style={{padding:30,color:'var(--text-faint)',textAlign:'center',fontSize:12.5}}>{text}</div> }
function Legend({ labels }: { labels: string[] }) { return <div style={{display:'flex',gap:14,marginTop:12,flexWrap:'wrap'}}>{labels.map((l,i)=><span key={l} style={{fontSize:10.5,color:'var(--text-muted)'}}><i style={{display:'inline-block',width:8,height:8,borderRadius:2,background:`var(--chart-${i+1}, var(--accent))`,marginRight:5}}/>{l}</span>)}</div> }
function dashboardTitle(role:string){ const names:Record<string,string>={'cost controller':'Cost Controller dashboard','store keeper':'Store Keeper dashboard','receiving clerk':'Receiving Clerk dashboard','financial manager':'Financial Manager dashboard','procurement manager':'Procurement Manager dashboard','general manager':'General Manager dashboard'}; return names[role] || `${role ? role.replace(/\b\w/g,c=>c.toUpperCase()) : 'Operations'} dashboard` }
function tone(value:string){ if(value==='danger')return{fg:'var(--bad)',bg:'var(--bad-soft)'};if(value==='warning')return{fg:'var(--warn)',bg:'var(--warn-soft)'};if(value==='success')return{fg:'var(--good)',bg:'var(--good-soft)'};return{fg:'var(--accent)',bg:'var(--accent-soft)'} }
function clean(v:unknown){return String(v||'Unknown').replace(/_/g,' ')}
function compact(v:number){return Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(v)}
function sum(rows:any[], key:string){return rows.reduce((s,r)=>s+Number(r[key]||0),0)}
function byStatus(rows:any[]):Point[]{return groupCount(rows,'status')}
function groupCount(rows:any[], key:string):Point[]{const m=new Map<string,number>();rows.forEach(r=>{const k=clean(r[key]);m.set(k,(m.get(k)||0)+1)});return [...m].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value)}
function groupSum(rows:any[], key:string, valueKey:string):Point[]{const m=new Map<string,number>();rows.forEach(r=>{const k=clean(r[key]);m.set(k,(m.get(k)||0)+Number(r[valueKey]||0))});return [...m].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value)}
function monthly(rows:any[], dateKey:string, valueKey?:string):Point[]{const months:string[]=[];const now=new Date();for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)}return months.map(label=>({label,value:rows.filter(r=>monthKey(r[dateKey])===label).reduce((s,r)=>s+(valueKey?Number(r[valueKey]||0):1),0)}))}
function normalStatus(value:unknown){return String(value||'').trim().toLowerCase().replace(/\s+/g,'_')}
function queueReq(r:any){return{id:r.id,primary:r.id,secondary:`${r.dept||r.department||'Department'} · ${r.requester||'Requester'}`,value:money(r.total||0),status:r.status}}
function queueStoreReq(r:any){return{id:r.id,primary:r.requisition_no||r.reference||r.id,secondary:r.purpose||'Store request',value:'',status:r.status}}

const iconButton: CSSProperties = { width: 31, height: 31, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
const queueRow: CSSProperties = { width:'100%',display:'grid',gridTemplateColumns:'minmax(0,1.6fr) auto auto 18px',alignItems:'center',gap:13,padding:'11px 16px',border:0,borderBottom:'1px solid var(--border)',background:'transparent',textAlign:'left',cursor:'pointer',font:'inherit' }
const primaryText: CSSProperties = { display:'block',color:'var(--text)',fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }
const secondaryText: CSSProperties = { display:'block',color:'var(--text-faint)',fontSize:10.5,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }
