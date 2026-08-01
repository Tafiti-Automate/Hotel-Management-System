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
  borderRadius: 16,
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
    <button onClick={onClick} className="hover-surface2" style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', padding: '12px 16px', background: 'transparent', cursor: 'pointer', display: 'grid', gridTemplateColumns: 'minmax(130px,1.5fr) minmax(120px,1fr) auto auto', gap: 12, alignItems: 'center', textAlign: 'left', font: 'inherit' }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 10.5, color: 'var(--text-faint)', fontFamily: 'monospace' }}>{id.slice(0, 14)}</span>
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
      {amount != null && <span style={{ fontSize: 12, fontWeight: 750, color: 'var(--text)' }}>{money(amount)}</span>}
      <span style={{ textTransform: 'capitalize', fontSize: 10.5, fontWeight: 800, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '4px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>{status}</span>
    </button>
  )
}

export default function WorkflowHub({ kind }: { kind: WorkflowKind }) {
  const app = useApp()
  const data = app.data

  const definitions: Record<WorkflowKind, { eyebrow: string; title: string; summary: string; icon: string; steps: Step[] }> = {
    procure: {
      eyebrow: 'PROCURE TO STOCK',
      title: 'Procurement control centre',
      summary: 'Take demand from an approved request through sourcing, LPO, inspection and accepted stock.',
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
      eyebrow: 'INVENTORY CONTROL',
      title: 'Stores movement centre',
      summary: 'Receive, reserve, transfer, issue, return, adjust and count with a permanent stock trail.',
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
      eyebrow: 'STOCK TO CONSUMPTION',
      title: 'Department supply centre',
      summary: 'Turn department demand into reserved, issued and acknowledged consumption by cost centre.',
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
      eyebrow: 'PROCURE TO PAY',
      title: 'Finance matching centre',
      summary: 'Match supplier invoices to LPOs and accepted receipts before approval and payment.',
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
      eyebrow: 'CONTROLLED MASTER DATA',
      title: 'ERP configuration',
      summary: 'Maintain shared organization, article, supplier and approval definitions used by every workflow.',
      icon: 'tune',
      steps: [
        { label: 'Organization', route: 'hotel-profile', icon: 'domain', description: 'Hotels, branches and departments' },
        { label: 'Articles', route: 'items', icon: 'inventory_2', description: 'SKU, barcode and control rules', count: data.items.length },
        { label: 'Categories', route: 'categories', icon: 'category', description: 'Category and subcategory tree', count: data.categories.length },
        { label: 'Units', route: 'uoms', icon: 'straighten', description: 'Shared unit names and abbreviations', count: data.uoms.length },
        { label: 'Conversions', route: 'itemUnits', icon: 'calculate', description: 'Article-specific carton and pallet ratios', count: data.itemUnits.length },
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
    <div style={{ maxWidth: 1440, margin: '0 auto' }}>
      <section style={{ ...card, padding: 22, background: 'linear-gradient(135deg,var(--surface),var(--accent-soft))', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', background: 'var(--accent-soft)', right: -50, top: -90 }} />
        <div style={{ position: 'relative', display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ width: 50, height: 50, borderRadius: 14, background: 'var(--accent)', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow)' }}>
            <Icon name={flow.icon} color="#fff" size={26} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 850, letterSpacing: '.12em', color: 'var(--accent)' }}>{flow.eyebrow}</div>
            <h1 style={{ fontSize: 24, margin: '4px 0', letterSpacing: '-.025em', color: 'var(--text)' }}>{flow.title}</h1>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', maxWidth: 720 }}>{flow.summary}</p>
          </div>
        </div>
      </section>

      <section className="workflow-steps" style={{ display: 'grid', gridTemplateColumns: `repeat(${flow.steps.length},minmax(130px,1fr))`, gap: 0, margin: '18px 0' }}>
        {flow.steps.map((step, index) => (
          <button key={`${kind}-${step.label}`} onClick={() => app.navTo(step.route, step.label)} className="hover-card workflow-step" style={{ ...card, minHeight: 142, borderRadius: index === 0 ? '16px 0 0 16px' : index === flow.steps.length - 1 ? '0 16px 16px 0' : 0, marginLeft: index ? -1 : 0, padding: 16, cursor: 'pointer', textAlign: 'left', font: 'inherit', transition: 'transform .15s ease, box-shadow .15s ease', position: 'relative' }}>
            {index < flow.steps.length - 1 && <span style={{ position: 'absolute', zIndex: 2, right: -11, top: 28, width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)' }}><Icon name="chevron_right" size={16} color="var(--text-faint)" /></span>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)' }}><Icon name={step.icon} size={19} color="var(--accent)" /></span>
              {step.count != null && <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>{step.count}</span>}
            </div>
            <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{index + 1}. {step.label}</div>
            <div style={{ marginTop: 4, fontSize: 10.5, lineHeight: 1.45, color: 'var(--text-faint)' }}>{step.description}</div>
          </button>
        ))}
      </section>

      <div className="workflow-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) minmax(270px,.7fr)', gap: 18 }}>
        <section style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '15px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 850, color: 'var(--text)' }}>My work queue</div>
              <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--text-faint)' }}>Documents requiring attention in this workflow</div>
            </div>
            <button onClick={() => app.refreshData()} style={{ width: 32, height: 32, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}><Icon name="refresh" size={17} color="var(--text-muted)" /></button>
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
            <div style={{ borderTop: '1px solid var(--border)', padding: 32, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No documents are waiting in this queue.</div>
          )}
        </section>

        <aside style={{ ...card, padding: 17 }}>
          <div style={{ fontSize: 13, fontWeight: 850, color: 'var(--text)' }}>Control checks</div>
          {[
            ['verified_user', 'Approval sequence', 'No stage can be bypassed'],
            ['inventory', 'Stock integrity', 'No negative stock posting'],
            ['history', 'Audit evidence', 'Actions and decisions are timestamped'],
            ['difference', 'Exception visibility', 'Tolerance breaches remain visible'],
          ].map(([icon, title, desc]) => (
            <div key={title} style={{ display: 'flex', gap: 10, paddingTop: 14 }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, flex: 'none', display: 'grid', placeItems: 'center', background: 'var(--good-soft)' }}><Icon name={icon} size={17} color="var(--good)" /></span>
              <span><span style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: 'var(--text)' }}>{title}</span><span style={{ display: 'block', marginTop: 2, fontSize: 10.5, color: 'var(--text-faint)' }}>{desc}</span></span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}
