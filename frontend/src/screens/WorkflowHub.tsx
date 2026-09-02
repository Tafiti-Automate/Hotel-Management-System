import type { CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'
import { money } from '../lib/theme'

type WorkflowKind = 'procure' | 'stores' | 'consume' | 'pay' | 'configure'

interface Step {
  label: string
  route: string
  icon: string
  description: string
  count?: number
}

const card: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-sm)',
}

function statusText(value: unknown) {
  return String(value || 'Draft').replace(/_/g, ' ')
}

function QueueRow({
  id,
  title,
  meta,
  status,
  amount,
  onClick,
}: {
  id: string
  title: string
  meta: string
  status: string
  amount?: number
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="workflow-queue-row">
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 650, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 12, color: 'var(--text-faint)', fontFamily: 'monospace' }}>{id.slice(0, 14)}</span>
      </span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
      {amount != null && <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text)' }}>{money(amount)}</span>}
      <span style={{ textTransform: 'capitalize', fontSize: 12, fontWeight: 650, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '4px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>{status}</span>
    </button>
  )
}

export default function WorkflowHub({ kind }: { kind: WorkflowKind }) {
  const app = useApp()
  const data = app.data

  const definitions: Record<WorkflowKind, { eyebrow: string; title: string; summary: string; icon: string; steps: Step[] }> = {
    procure: {
      eyebrow: 'Procurement',
      title: 'Procure to stock',
      summary: 'Approved demand, sourcing, purchase orders, receiving and stock posting.',
      icon: 'shopping_cart_checkout',
      steps: [
        { label: 'Request', route: 'requisitions', icon: 'request_quote', description: 'Capture demand and estimated value', count: data.requisitions.length },
        { label: 'Approve', route: 'approvals', icon: 'approval', description: 'Sequential value-based decisions', count: data.requisitions.filter((x) => Boolean(x.approvalActionable)).length },
        { label: 'Source', route: 'requisitions', icon: 'compare_arrows', description: 'Compare supplier quotations' },
        { label: 'LPO', route: 'orders', icon: 'receipt_long', description: 'Issue controlled purchase order', count: data.orders.length },
        { label: 'Inspect', route: 'inspections', icon: 'fact_check', description: 'Accept or reject delivered quantity', count: data.inspections.length },
        { label: 'Receive', route: 'grns', icon: 'move_to_inbox', description: 'Post accepted GRN to stock', count: data.grns.length },
      ],
    },
    stores: {
      eyebrow: 'Stores',
      title: 'Inventory movement',
      summary: 'Balances, batches, transfers, issues, returns and stock counts.',
      icon: 'warehouse',
      steps: [
        { label: 'Balances', route: 'balances', icon: 'equalizer', description: 'Live stock by article and store', count: data.balances.length },
        { label: 'Batches', route: 'batches', icon: 'layers', description: 'FIFO / FEFO and expiry control', count: data.batches.length },
        { label: 'Transfers', route: 'ledgers', icon: 'sync_alt', description: 'Dispatch and destination receipt' },
        { label: 'Issues', route: 'stockIssues', icon: 'outbox', description: 'Controlled stock release', count: data.stockIssues.length },
        { label: 'Returns', route: 'storeReturns', icon: 'assignment_return', description: 'Unused stock back to store', count: data.storeReturns.length },
        { label: 'Count', route: 'balances', icon: 'inventory', description: 'Blind count and variance approval' },
      ],
    },
    consume: {
      eyebrow: 'Department supply',
      title: 'Stock to consumption',
      summary: 'Department requests, reservations, issues, receipt confirmation and cost allocation.',
      icon: 'room_service',
      steps: [
        { label: 'Request', route: 'storeRequisitions', icon: 'assignment', description: 'Department requests articles', count: data.storeRequisitions.length },
        { label: 'Review', route: 'storeRequisitions', icon: 'rule', description: 'Storekeeper checks availability' },
        { label: 'Reserve', route: 'balances', icon: 'lock_clock', description: 'Protect approved quantity' },
        { label: 'Pick & issue', route: 'stockIssues', icon: 'shopping_basket', description: 'Batch-led issue voucher', count: data.stockIssues.length },
        { label: 'Receive', route: 'stockIssues', icon: 'how_to_reg', description: 'Department acknowledges receipt' },
        { label: 'Allocate cost', route: 'reports', icon: 'account_balance', description: 'Post consumption to cost centre' },
      ],
    },
    pay: {
      eyebrow: 'Finance',
      title: 'Procure to pay',
      summary: 'Supplier invoices, three-way matching, approvals and settlement.',
      icon: 'payments',
      steps: [
        { label: 'Accepted GRN', route: 'grns', icon: 'verified', description: 'Confirm liability quantity', count: data.grns.length },
        { label: 'Invoice', route: 'workflow-pay', icon: 'request_page', description: 'Register supplier invoice' },
        { label: '3-way match', route: 'workflow-pay', icon: 'difference', description: 'LPO ↔ GRN ↔ invoice' },
        { label: 'Approve', route: 'workflow-pay', icon: 'approval', description: 'Release within tolerance' },
        { label: 'Pay', route: 'workflow-pay', icon: 'paid', description: 'Post supplier settlement' },
        { label: 'Analyse', route: 'reports', icon: 'insights', description: 'Valuation and contribution' },
      ],
    },
    configure: {
      eyebrow: 'Configuration',
      title: 'Master data',
      summary: 'Organization, article, supplier and approval settings shared across operations.',
      icon: 'tune',
      steps: [
        { label: 'Organization', route: 'hotel-profile', icon: 'domain', description: 'Hotels, branches and departments' },
        { label: 'Articles', route: 'items', icon: 'inventory_2', description: 'SKU, barcode and control rules', count: data.items.length },
        { label: 'Item Groups', route: 'categories', icon: 'account_tree', description: 'Major groups and their item groups', count: data.categories.length },
        { label: 'Units & conversions', route: 'uoms', icon: 'straighten', description: 'Shared units with article-specific equivalents', count: data.itemUnits.length },
        { label: 'Suppliers', route: 'suppliers', icon: 'local_shipping', description: 'Pricing, terms and performance', count: data.suppliers.length },
        { label: 'Approval matrix', route: 'workflow-configure', icon: 'account_tree', description: 'Branch, value and stage rules' },
      ],
    },
  }

  const flow = definitions[kind]
  const queue = kind === 'consume'
    ? data.storeRequisitions.slice(0, 6)
    : kind === 'stores'
      ? data.stockIssues.slice(0, 6)
      : data.requisitions.slice(0, 6)

  const openQueueRow = (row: Record<string, any>) => {
    if (kind === 'procure' && row.id) app.openDetail('requisitions', row.id, 'workflow-procure')
    else app.navTo(kind === 'consume' ? 'storeRequisitions' : kind === 'stores' ? 'stockIssues' : 'requisitions', flow.title)
  }

  return (
    <div className="enterprise-workspace workflow-hub">
      <section className="workflow-hub-header" style={{ ...card }}>
        <div className="workflow-hub-header-inner">
          <div className="workflow-hub-icon">
            <Icon name={flow.icon} color="#fff" size={26} />
          </div>
          <div>
            <div className="workflow-hub-kicker">{flow.eyebrow}</div>
            <h1>{flow.title}</h1>
            <p>{flow.summary}</p>
          </div>
        </div>
      </section>

      <section className="workflow-steps" style={{ gridTemplateColumns: `repeat(${flow.steps.length},minmax(130px,1fr))` }}>
        {flow.steps.map((step, index) => (
          <button key={`${kind}-${step.label}`} onClick={() => app.navTo(step.route, step.label)} className="workflow-step" style={{ ...card, marginLeft: index ? -1 : 0 }}>
            {index < flow.steps.length - 1 && <span className="workflow-step-arrow"><Icon name="chevron_right" size={16} color="var(--text-faint)" /></span>}
            <div className="workflow-step-top">
              <span className="workflow-step-icon"><Icon name={step.icon} size={19} color="var(--accent)" /></span>
              {step.count != null && <span className="workflow-step-count">{step.count}</span>}
            </div>
            <div className="workflow-step-label">{index + 1}. {step.label}</div>
            <div className="workflow-step-description">{step.description}</div>
          </button>
        ))}
      </section>

      <div className="workflow-grid">
        <section className="workflow-queue-panel" style={{ ...card }}>
          <div className="workflow-panel-header">
            <div>
              <h3>Work queue</h3>
              <span>Recent records in this workflow</span>
            </div>
            <button onClick={() => app.refreshData()} className="workflow-refresh" title="Refresh"><Icon name="refresh" size={17} color="var(--text-muted)" /></button>
          </div>
          {queue.length ? queue.map((row) => (
            <QueueRow
              key={row.id}
              id={row.id}
              title={row.reason || row.purpose || row.item || 'Operational document'}
              meta={row.dept || row.department || row.store || row.requester || 'Current property'}
              status={statusText(row.status)}
              amount={row.total != null ? Number(row.total) : undefined}
              onClick={() => openQueueRow(row)}
            />
          )) : (
            <div className="workflow-empty">No records in this queue.</div>
          )}
        </section>

        <aside className="workflow-control-panel" style={{ ...card }}>
          <div className="workflow-control-heading">Controls</div>
          {[
            ['verified_user', 'Approval sequence', 'No stage can be bypassed'],
            ['inventory', 'Stock integrity', 'No negative stock posting'],
            ['history', 'Audit evidence', 'Actions and decisions are timestamped'],
            ['difference', 'Exception visibility', 'Tolerance breaches remain visible'],
          ].map(([icon, title, desc]) => (
            <div key={title} className="workflow-control-row">
              <span className="workflow-control-icon"><Icon name={icon} size={17} color="var(--good)" /></span>
              <span><strong>{title}</strong><small>{desc}</small></span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}
