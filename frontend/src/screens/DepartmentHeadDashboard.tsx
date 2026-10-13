import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'

const id = (value: unknown) => String(value || '')
const key = (value: unknown) => id(value).trim().toLowerCase()

export default function DepartmentHeadDashboard() {
  const app = useApp()
  const requests = app.data.storeRequisitions || []
  const own = requests.filter((row) => id(row.requestedBy || row.requested_by) === app.user.employeeId)
  const drafts = own.filter((row) => key(row.statusCode || row.status) === 'draft')
  const atStores = own.filter((row) => ['submitted', 'approved', 'partially_approved', 'partially_issued'].includes(key(row.statusCode || row.status)))
  const procurement = own.filter((row) => key(row.statusCode || row.status) === 'awaiting_procurement')
  const completed = own.filter((row) => ['issued', 'completed'].includes(key(row.statusCode || row.status)))
  const rejected = own.filter((row) => key(row.statusCode || row.status) === 'rejected')
  const recent = [...own]
    .sort((a, b) => id(b.createdAt || b.created_at).localeCompare(id(a.createdAt || a.created_at)))
    .slice(0, 7)

  return (
    <div className="hod-dashboard">
      <section className="hod-dashboard-hero">
        <div>
          <span>Department Head workspace</span>
          <h1>{app.user.departmentName || 'Department'} Requisitions</h1>
          <p>Create department requisitions yourself, submit them directly to Stores, and follow the same record through Procurement and completion.</p>
        </div>
        <button type="button" className="erp-primary" onClick={() => app.navTo('workflow-stores', 'Department requisitions')}>
          <Icon name="add" size={17} color="#fff" /> New requisition
        </button>
      </section>

      <section className="hod-dashboard-flow" aria-label="Department requisition workflow">
        <Flow icon="edit_note" title="1. Department Head" text="Create & submit" active />
        <Icon name="arrow_forward" size={16} />
        <Flow icon="warehouse" title="2. Store Keeper" text="Review quantities" />
        <Icon name="arrow_forward" size={16} />
        <Flow icon="shopping_cart_checkout" title="3. Procurement" text="Supplier & LPO" />
        <Icon name="arrow_forward" size={16} />
        <Flow icon="task_alt" title="4. Complete" text="Receipt & close" />
      </section>

      <section className="hod-dashboard-kpis">
        <Metric label="Drafts" value={drafts.length} icon="edit_note" onClick={() => app.navTo('workflow-stores', 'Department requisitions')} />
        <Metric label="At Stores" value={atStores.length} icon="warehouse" onClick={() => app.navTo('workflow-stores', 'Department requisitions')} />
        <Metric label="At Procurement" value={procurement.length} icon="shopping_cart_checkout" onClick={() => app.navTo('workflow-stores', 'Department requisitions')} />
        <Metric label="Completed" value={completed.length} icon="task_alt" onClick={() => app.navTo('workflow-stores', 'Department requisitions')} />
      </section>

      <div className="hod-dashboard-layout">
        <section className="hod-dashboard-panel">
          <header>
            <div><strong>Recent requisitions</strong><span>Your latest Department requests</span></div>
            <button type="button" onClick={() => app.navTo('workflow-stores', 'Department requisitions')}>Open register <Icon name="arrow_forward" size={14} /></button>
          </header>
          <div className="hod-dashboard-list">
            {recent.map((row) => (
              <button type="button" key={id(row.id)} onClick={() => app.navTo('workflow-stores', 'Department requisitions')}>
                <span className="hod-dashboard-ref">{id(row.requisitionNo || row.requisition_no || row.number || row.id)}</span>
                <span className="hod-dashboard-record-copy"><strong>{id(row.purpose) || 'Department requisition'}</strong><small>{id(row.storeName || row.store_name) || 'Store pending'}</small></span>
                <Status value={id(row.statusCode || row.status)} />
                <span className="hod-dashboard-date">{formatDate(row.createdAt || row.created_at)}</span>
                <Icon name="chevron_right" size={16} />
              </button>
            ))}
            {!recent.length && <div className="hod-dashboard-empty"><Icon name="inbox" size={24} /><strong>No requisitions yet</strong><span>Create your first Department requisition when an Article is needed.</span></div>}
          </div>
        </section>

        <aside className="hod-dashboard-side">
          <section>
            <header><Icon name="monitoring" size={17} /><strong>Current workload</strong></header>
            <div className="hod-workload-row"><span>Active requests</span><b>{atStores.length + procurement.length}</b></div>
            <div className="hod-workload-row"><span>Rejected / correction</span><b>{rejected.length}</b></div>
            <div className="hod-workload-row"><span>Completed</span><b>{completed.length}</b></div>
          </section>
          <section>
            <header><Icon name="rule" size={17} /><strong>Quantity control</strong></header>
            <p>The original Department quantity is preserved. Every downstream stage can keep or reduce it, but cannot increase it.</p>
          </section>
          <section>
            <header><Icon name="business" size={17} /><strong>Work context</strong></header>
            <div className="hod-context-row"><span>Department</span><b>{app.user.departmentName || '—'}</b></div>
            <div className="hod-context-row"><span>Property</span><b>{app.currentBranch || app.user.branchName || '—'}</b></div>
            <div className="hod-context-row"><span>Role</span><b>Department Head</b></div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Flow({ icon, title, text, active = false }: { icon: string; title: string; text: string; active?: boolean }) {
  return <div className={`hod-dashboard-flow-step${active ? ' active' : ''}`}><span><Icon name={icon} size={17} /></span><div><strong>{title}</strong><small>{text}</small></div></div>
}

function Metric({ label, value, icon, onClick }: { label: string; value: number; icon: string; onClick: () => void }) {
  return <button type="button" className="hod-dashboard-metric" onClick={onClick}><span><Icon name={icon} size={18} /></span><div><strong>{value}</strong><small>{label}</small></div><Icon name="arrow_forward" size={14} /></button>
}

function Status({ value }: { value: string }) {
  const state = key(value)
  const tone = ['completed', 'issued', 'approved'].includes(state) ? 'good'
    : ['rejected', 'cancelled'].includes(state) ? 'bad'
      : ['submitted', 'awaiting_procurement', 'partially_approved', 'partially_issued'].includes(state) ? 'warn'
        : 'neutral'
  return <span className={`hod-status ${tone}`}>{friendlyStatus(state)}</span>
}

function friendlyStatus(value: string) {
  const map: Record<string, string> = {
    draft: 'Draft', submitted: 'At Stores', awaiting_procurement: 'At Procurement',
    approved: 'Stores approved', partially_approved: 'Partially approved', partially_issued: 'Partially issued',
    issued: 'Issued', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled',
  }
  return map[value] || value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Unknown'
}

function formatDate(value: unknown) {
  if (!value) return '—'
  const date = new Date(id(value))
  if (Number.isNaN(date.getTime())) return id(value)
  return new Intl.DateTimeFormat('en-UG', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}
