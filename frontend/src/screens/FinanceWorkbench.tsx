import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { HelpLabel } from '../components/HelpLabel'
import RecordDetailDrawer from '../components/RecordDetailDrawer'
import { WorkflowPath } from '../components/WorkflowPath'
import { createBackendRecord, errorMessage, readBackendRecords, runBackendAction } from '../lib/api'
import type { Row } from '../lib/data'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

type FinanceTab = 'invoices' | 'payments' | 'expenses' | 'banking' | 'methods'
const financePaths = {
  invoices: 'supplier-invoices', invoiceItems: 'supplier-invoice-items', payments: 'supplier-payments',
  expenses: 'expenses', expenseCategories: 'expense-categories',
  banks: 'bank-accounts', transactions: 'bank-transactions',
  methods: 'payment-methods', orders: 'purchase-orders', orderItems: 'purchase-order-items',
}
const empty = Object.fromEntries(Object.keys(financePaths).map((key) => [key, []])) as Record<string, Row[]>
const sid = (value: unknown) => String(value || '')
const number = (value: unknown) => Number(value || 0)

export default function FinanceWorkbench() {
  const app = useApp()
  const [tab, setTab] = useState<FinanceTab>('invoices')
  const [data, setData] = useState(empty)
  const [form, setForm] = useState<Row>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [paymentPathHint, setPaymentPathHint] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const entries = await Promise.all(Object.entries(financePaths).map(async ([key, path]) => [key, await readBackendRecords(path)]))
      setData(Object.fromEntries(entries))
    } catch (reason) { setError(errorMessage(reason)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { setForm({}); setError('') }, [tab])
  const scopedData = useMemo(() => {
    if (!app.currentBranch) return data
    const stores = new Set(app.data.locations.map((row) => sid(row.id)))
    const next = { ...data }
    next.orders = data.orders.filter((row) => !row.store || stores.has(sid(row.store)))
    const orderIds = new Set(next.orders.map((row) => sid(row.id)))
    next.invoices = data.invoices.filter((row) => orderIds.has(sid(row.purchase_order)))
    const invoiceIds = new Set(next.invoices.map((row) => sid(row.id)))
    next.invoiceItems = data.invoiceItems.filter((row) => invoiceIds.has(sid(row.invoice)))
    next.orderItems = data.orderItems.filter((row) => orderIds.has(sid(row.purchase_order)))
    next.payments = data.payments.filter((row) => invoiceIds.has(sid(row.invoice)))
    next.expenses = data.expenses.filter((row) => !row.store || stores.has(sid(row.store)))
    next.transactions = data.transactions.filter((row) => !row.store || stores.has(sid(row.store)))
    return next
  }, [app.currentBranch, app.data.locations, data])

  const execute = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true); setError('')
    try { await operation(); await load(); setForm({}); app.showToast(message) }
    catch (reason) { const detail = errorMessage(reason); setError(detail); app.showWorkflowAlert('Finance operation blocked', detail) }
    finally { setBusy(false) }
  }

  const suppliers = useMemo(() => new Map(app.data.suppliers.map((row) => [sid(row.id), sid(row.name)])), [app.data.suppliers])
  const stores = app.data.locations
  const orderLabel = (row: Row) => `${sid(row.lpo_number || row.po_number)} · ${suppliers.get(sid(row.supplier)) || 'Supplier'} · ${money(row.total_amount)}`
  const invoiceLabel = (row: Row) => `${sid(row.invoice_number)} · ${suppliers.get(sid(row.supplier)) || 'Supplier'} · ${money(row.balance_due)} due`
  const tabs: Array<[FinanceTab, string, string]> = [
    ['invoices', 'request_page', 'Invoices & matching'], ['payments', 'payments', 'Supplier payments'],
    ['expenses', 'receipt', 'Expenses'], ['banking', 'account_balance', 'Banking'], ['methods', 'credit_card', 'Payment methods'],
  ]
  const paymentPathActive = paymentPathHint || (tab === 'payments'
    ? (form.payment ? 'post' : 'payment')
    : tab === 'invoices' ? (form.invoice ? 'match' : 'invoice') : '')
  const openPaymentStep = (key: string) => {
    setPaymentPathHint(key)
    setTab(['payment', 'post'].includes(key) ? 'payments' : 'invoices')
    setForm({})
  }
  const invoiceStatus = (row: Row) => sid(row.status).trim().toLowerCase()
  const matchingQueue = scopedData.invoices.filter((row) => ['draft', 'unmatched', 'pending_match', 'matching'].includes(invoiceStatus(row)))
  const approvalQueue = scopedData.invoices.filter((row) => ['matched', 'pending_approval', 'awaiting_approval'].includes(invoiceStatus(row)))
  const outstandingPayable = scopedData.invoices.reduce((total, row) => total + number(row.balance_due), 0)
  const paymentQueue = scopedData.payments.filter((row) => !['posted', 'paid', 'completed'].includes(invoiceStatus(row)))

  return <div className="enterprise-workspace finance-workbench" style={{ maxWidth: 1440, margin: '0 auto' }}>
    <section className="workbench-hero" style={{ ...card, padding: 20, marginBottom: 15, display: 'flex', alignItems: 'center', gap: 13 }}>
      <span style={hero}><Icon name="account_balance" size={24} color="#fff" /></span>
      <div><div style={eyebrow}>Procure to pay</div><h1 style={{ margin: '3px 0', fontSize: 23 }}>Finance control centre</h1><div style={subtle}>Supplier invoices, matching, payment approval and settlement.</div></div>
      <button onClick={() => void load()} style={{ ...secondary, marginLeft: 'auto' }}><Icon name="refresh" size={17} />Refresh</button>
    </section>
    <WorkflowPath
      title="Supplier invoice to payment"
      summary="Invoices, matching, payments and expenses."
      activeKey={paymentPathActive}
      onSelect={openPaymentStep}
      steps={[
        { key: 'invoice', label: 'Register invoice', actor: 'Finance', description: 'Select a received LPO and enter the supplier invoice.', icon: 'request_page' },
        { key: 'match', label: 'Three-way match', actor: 'Finance', description: 'Compare LPO, accepted GRN and invoice values.', icon: 'difference' },
        { key: 'approve', label: 'Approve invoice', actor: 'Authorised approver', description: 'Release only a matched invoice for payment.', icon: 'approval' },
        { key: 'payment', label: 'Create payment', actor: 'Finance', description: 'Record method, amount, date and bank reference.', icon: 'payments' },
        { key: 'post', label: 'Post settlement', actor: 'Finance', description: 'Post the payment and reduce the invoice balance.', icon: 'task_alt' },
      ]}
    />
    <section className="finance-kpi-grid" aria-label="Finance operational metrics">
      <FinanceMetric icon="difference" label="Awaiting Matching" value={String(matchingQueue.length)} hint="Invoices requiring three-way match" tone={matchingQueue.length ? 'warning' : 'good'} />
      <FinanceMetric icon="approval" label="Ready for Approval" value={String(approvalQueue.length)} hint="Matched invoices awaiting decision" tone={approvalQueue.length ? 'warning' : 'good'} />
      <FinanceMetric icon="payments" label="Outstanding Payable" value={money(outstandingPayable)} hint="Current supplier invoice balance" />
      <FinanceMetric icon="schedule" label="Payments to Post" value={String(paymentQueue.length)} hint="Prepared settlements not yet posted" tone={paymentQueue.length ? 'warning' : 'good'} />
    </section>
    <div className="finance-workarea-label">Finance work areas</div>
    <div style={{ display: 'flex', gap: 5, marginBottom: 15, flexWrap: 'wrap' }}>{tabs.map(([key, icon, label]) => <button key={key} onClick={() => { setPaymentPathHint(''); setTab(key) }} style={{ ...tabButton, background: tab === key ? 'var(--accent-soft)' : 'var(--surface)', color: tab === key ? 'var(--accent)' : 'var(--text-muted)', borderColor: tab === key ? 'var(--accent)' : 'var(--border)' }}><Icon name={icon} size={17} />{label}</button>)}</div>
    {error && <div style={{ ...card, padding: 12, color: 'var(--bad)', marginBottom: 14, fontSize: 12 }}>{error}</div>}
    {loading ? <div style={{ ...card, padding: 50, textAlign: 'center', color: 'var(--text-faint)' }}>Loading finance records…</div> :
      <div className="workbench-grid finance-workbench-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) minmax(340px,.7fr)', gap: 16, alignItems: 'start' }}>
        <FinanceTable tab={tab} data={scopedData} suppliers={suppliers} />
        <aside className="finance-action-panel" style={{ ...card, padding: 18 }}>
          {tab === 'invoices' && <InvoicePanel {...{ data: scopedData, form, setForm, busy, execute, orderLabel, invoiceLabel }} />}
          {tab === 'payments' && <PaymentPanel {...{ data: scopedData, form, setForm, busy, execute, invoiceLabel }} />}
          {tab === 'expenses' && <ExpensePanel {...{ data: scopedData, form, setForm, busy, execute, stores }} />}
          {tab === 'banking' && <BankPanel {...{ data: scopedData, form, setForm, busy, execute, stores }} />}
          {tab === 'methods' && <MethodPanel {...{ form, setForm, busy, execute }} />}
        </aside>
      </div>}
  </div>
}

function InvoicePanel({ data, form, setForm, busy, execute, orderLabel, invoiceLabel }: any) {
  const app = useApp()
  const receivedOrders = data.orders.filter((row: Row) => ['received', 'partially_received'].includes(sid(row.status)))
  const order = data.orders.find((row: Row) => sid(row.id) === sid(form.order))
  const invoice = data.invoices.find((row: Row) => sid(row.id) === sid(form.invoice))
  const invoiceOrderLines = data.orderItems.filter((row: Row) => sid(row.purchase_order) === sid(invoice?.purchase_order))
  const selectedOrderLine = invoiceOrderLines.find((row: Row) => sid(row.id) === sid(form.orderLine))
  const invoiceLines = data.invoiceItems.filter((row: Row) => sid(row.invoice) === sid(form.invoice))
  const itemNames = new Map(app.data.items.map((row) => [sid(row.id), sid(row.name)]))
  const unitNames = new Map(app.data.uoms.map((row) => [sid(row.id), sid(row.name)]))
  return <Panel title="Supplier invoice and three-way match" note="Review supplier invoices and matching status.">
    <Field label="Received LPO"><Select value={form.order} change={(v) => setForm({ order: v })} rows={receivedOrders} label={orderLabel} /></Field>
    <Field label="Invoice number"><Input value={form.number} change={(v) => setForm({ ...form, number: v })} /></Field>
    <Two><Field label="Invoice date"><Input type="date" value={form.invoiceDate} change={(v) => setForm({ ...form, invoiceDate: v })} /></Field><Field label="Due date"><Input type="date" value={form.dueDate} change={(v) => setForm({ ...form, dueDate: v })} /></Field></Two>
    <Two><Field label="Subtotal"><Input type="number" value={form.subtotal} change={(v) => setForm({ ...form, subtotal: v })} /></Field><Field label="Tax"><Input type="number" value={form.tax} change={(v) => setForm({ ...form, tax: v })} /></Field></Two>
    <Action disabled={busy || !order || !form.number || !form.dueDate} click={() => execute(() => createBackendRecord('supplier-invoices', { supplier: order.supplier, purchase_order: order.id, invoice_number: form.number, invoice_date: form.invoiceDate || new Date().toISOString().slice(0, 10), due_date: form.dueDate, subtotal: number(form.subtotal), tax_amount: number(form.tax) }), 'Supplier invoice created')}>Register invoice</Action>
    <Rule />
    <Field label="Invoice"><Select value={form.invoice} change={(v) => setForm({ invoice: v })} rows={data.invoices} label={invoiceLabel} /></Field>
    {invoice && <>
      <Field label="LPO Article"><Select value={form.orderLine} change={(v) => { const found = invoiceOrderLines.find((row: Row) => sid(row.id) === v); setForm({ ...form, invoice: form.invoice, orderLine: v, invoiceQuantity: '', invoiceUnitPrice: found?.unit_cost || '' }) }} rows={invoiceOrderLines} label={(row: Row) => `${itemNames.get(sid(row.item)) || 'Article'} · accepted allocation`} /></Field>
      <Two><Field label={`Invoice quantity (${unitNames.get(sid(selectedOrderLine?.unit)) || 'LPO unit'})`}><Input type="number" value={form.invoiceQuantity} change={(v) => setForm({ ...form, invoiceQuantity: v })} /></Field><Field label="Invoice unit price"><Input type="number" value={form.invoiceUnitPrice} change={(v) => setForm({ ...form, invoiceUnitPrice: v })} /></Field></Two>
      <Action disabled={busy || !form.orderLine || number(form.invoiceQuantity) <= 0 || number(form.invoiceUnitPrice) <= 0 || !['draft', 'exception'].includes(sid(invoice.status))} click={() => execute(() => createBackendRecord('supplier-invoice-items', { invoice: form.invoice, purchase_order_item: form.orderLine, unit: selectedOrderLine?.unit || null, quantity: number(form.invoiceQuantity), unit_price: number(form.invoiceUnitPrice), tax_amount: 0 }), 'Invoice line allocated to the LPO and accepted receipts')}>Add invoice line</Action>
      <div style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        {invoiceLines.map((line: Row) => <div key={sid(line.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 9, padding: '9px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12 }}><span>{itemNames.get(sid(line.item)) || 'Article'} · {sid(line.quantity)} × {money(line.unit_price)}</span><strong style={{ color: 'var(--text)' }}>{money(line.line_subtotal)}</strong></div>)}
        {!invoiceLines.length && <div style={{ padding: 10, color: 'var(--warn)', background: 'var(--warn-soft)', fontSize: 12 }}>Add invoice lines before matching. Legacy header-only invoices remain supported.</div>}
      </div>
    </>}
    <Action disabled={busy || !form.invoice || (number(invoice?.line_count) > 0 && !invoiceLines.length)} click={() => execute(() => runBackendAction('supplier-invoices', sid(form.invoice), 'match'), 'Line-level three-way match completed')}>Perform line-level three-way match</Action>
    <Action tone="good" disabled={busy || !form.invoice || sid(invoice?.status) !== 'matched'} click={() => execute(() => runBackendAction('supplier-invoices', sid(form.invoice), 'approve-for-payment'), 'Invoice approved for payment')}>Approve matched invoice for payment</Action>
  </Panel>
}

function PaymentPanel({ data, form, setForm, busy, execute, invoiceLabel }: any) {
  const payable = data.invoices.filter((row: Row) => ['approved', 'partially_paid'].includes(sid(row.status)))
  return <Panel title="Supplier settlement" note="Record supplier payments.">
    <Field label="Approved invoice"><Select value={form.invoice} change={(v) => setForm({ invoice: v })} rows={payable} label={invoiceLabel} /></Field>
    <Two><Field label="Amount"><Input type="number" value={form.amount} change={(v) => setForm({ ...form, amount: v })} /></Field><Field label="Payment date"><Input type="date" value={form.date} change={(v) => setForm({ ...form, date: v })} /></Field></Two>
    <Field label="Payment method"><Select value={form.method} change={(v) => setForm({ ...form, method: v })} rows={data.methods.filter((r: Row) => r.is_active)} /></Field>
    <Field label="Bank account"><Select value={form.bank} change={(v) => setForm({ ...form, bank: v })} rows={data.banks.filter((r: Row) => r.is_active)} label={(row: Row) => `${sid(row.bank_name)} · ${sid(row.account_number)}`} optional /></Field>
    <Field label="Reference"><Input value={form.reference} change={(v) => setForm({ ...form, reference: v })} /></Field>
    <Action disabled={busy || !form.invoice || !form.method || !form.reference} click={() => execute(() => createBackendRecord('supplier-payments', { invoice: form.invoice, amount: number(form.amount), payment_date: form.date || new Date().toISOString().slice(0, 10), payment_method: form.method, bank_account: form.bank || null, reference: form.reference, note: '' }), 'Draft payment created')}>Create payment</Action>
    <Field label="Draft payment"><Select value={form.payment} change={(v) => setForm({ payment: v })} rows={data.payments.filter((r: Row) => sid(r.status) === 'draft')} label={(row: Row) => `${sid(row.reference)} · ${money(row.amount)}`} /></Field>
    <Action tone="good" disabled={busy || !form.payment} click={() => execute(() => runBackendAction('supplier-payments', sid(form.payment), 'post'), 'Supplier payment posted')}>Post payment</Action>
  </Panel>
}

function ExpensePanel({ data, form, setForm, busy, execute, stores }: any) {
  return <Panel title="Operating expenses" note="Record operating expenses.">
    <Field label="Expense category"><Select value={form.category} change={(v) => setForm({ ...form, category: v })} rows={data.expenseCategories} /></Field>
    <Field label="Store / property"><Select value={form.store} change={(v) => setForm({ ...form, store: v })} rows={stores} optional /></Field>
    <Two><Field label="Amount"><Input type="number" value={form.amount} change={(v) => setForm({ ...form, amount: v })} /></Field><Field label="Payment method"><Select value={form.method} change={(v) => setForm({ ...form, method: v })} rows={data.methods} optional /></Field></Two>
    <Field label="Reference"><Input value={form.reference} change={(v) => setForm({ ...form, reference: v })} /></Field>
    <Field label="Description"><Input value={form.description} change={(v) => setForm({ ...form, description: v })} /></Field>
    <Action disabled={busy || !form.amount} click={() => execute(() => createBackendRecord('expenses', { store: form.store || null, category: form.category || null, amount: number(form.amount), reference: form.reference || '', description: form.description || '', payment_method: form.method || null }), 'Expense recorded')}>Record expense</Action>
  </Panel>
}

function BankPanel({ data, form, setForm, busy, execute, stores }: any) {
  return <Panel title="Banking" note="Manage bank accounts and transactions.">
    <Field label="Account name"><Input value={form.name} change={(v) => setForm({ ...form, name: v })} /></Field>
    <Field label="Bank name"><Input value={form.bankName} change={(v) => setForm({ ...form, bankName: v })} /></Field>
    <Field label="Account number"><Input value={form.accountNumber} change={(v) => setForm({ ...form, accountNumber: v })} /></Field>
    <Action disabled={busy || !form.name || !form.accountNumber} click={() => execute(() => createBackendRecord('bank-accounts', { name: form.name, bank_name: form.bankName, account_number: form.accountNumber, opening_balance: number(form.opening), is_active: true, note: '' }), 'Bank account created')}>Add bank account</Action>
    <Rule />
    <Field label="Bank account"><Select value={form.bank} change={(v) => setForm({ bank: v })} rows={data.banks} label={(row: Row) => `${sid(row.bank_name)} · ${sid(row.account_number)}`} /></Field>
    <Two><Field label="Type"><select value={sid(form.type)} onChange={(e) => setForm({ ...form, type: e.target.value })} style={control}><option value="">Select…</option><option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option><option value="transfer">Transfer</option></select></Field><Field label="Amount"><Input type="number" value={form.amount} change={(v) => setForm({ ...form, amount: v })} /></Field></Two>
    <Field label="Store"><Select value={form.store} change={(v) => setForm({ ...form, store: v })} rows={stores} optional /></Field>
    <Field label="Reference"><Input value={form.reference} change={(v) => setForm({ ...form, reference: v })} /></Field>
    <Action disabled={busy || !form.bank || !form.type || !form.amount} click={() => execute(() => createBackendRecord('bank-transactions', { bank_account: form.bank, store: form.store || null, transaction_type: form.type, amount: number(form.amount), reference: form.reference || '', note: '' }), 'Bank transaction recorded')}>Record transaction</Action>
  </Panel>
}

function MethodPanel({ form, setForm, busy, execute }: any) {
  return <Panel title="Payment methods" note="Manage payment methods.">
    <Field label="Method name"><Input value={form.name} change={(v) => setForm({ ...form, name: v })} /></Field>
    <Field label="Description"><Input value={form.description} change={(v) => setForm({ ...form, description: v })} /></Field>
    <Action disabled={busy || !form.name} click={() => execute(() => createBackendRecord('payment-methods', { name: form.name, description: form.description || '', is_active: true, is_default: false }), 'Payment method created')}>Add payment method</Action>
  </Panel>
}

function FinanceTable({ tab, data, suppliers }: { tab: FinanceTab; data: Record<string, Row[]>; suppliers: Map<string, string> }) {
  const [selectedRow, setSelectedRow] = useState<Row | null>(null)
  const rows = tab === 'invoices' ? data.invoices : tab === 'payments' ? data.payments : tab === 'expenses' ? data.expenses : tab === 'banking' ? data.transactions : data.methods
  const cells = (row: Row) => tab === 'invoices'
    ? [sid(row.invoice_number), suppliers.get(sid(row.supplier)) || sid(row.supplier), money(row.total_amount), sid(row.status)]
    : tab === 'payments' ? [sid(row.reference), money(row.amount), sid(row.payment_date), sid(row.status)]
    : tab === 'expenses' ? [sid(row.reference) || 'Expense', money(row.amount), sid(row.date), sid(row.description)]
    : tab === 'banking' ? [sid(row.reference), money(row.amount), sid(row.transaction_type), sid(row.date)]
    : [sid(row.name), sid(row.description), row.is_default ? 'Default' : 'Available', row.is_active ? 'Active' : 'Inactive']
  const titles: Record<FinanceTab, string> = { invoices: 'Supplier invoices', payments: 'Supplier payments', expenses: 'Operating expenses', banking: 'Bank transactions', methods: 'Payment methods' }
  const headers: Record<FinanceTab, string[]> = {
    invoices: ['Invoice', 'Supplier', 'Amount', 'Status'],
    payments: ['Reference', 'Amount', 'Payment date', 'Status'],
    expenses: ['Reference', 'Amount', 'Date', 'Description'],
    banking: ['Reference', 'Amount', 'Type', 'Date'],
    methods: ['Method', 'Description', 'Default', 'Status'],
  }
  return <>
    <section className="finance-table-card" style={{ ...card, overflow: 'hidden' }}>
      <div className="finance-table-title"><div><strong>{titles[tab]}</strong><span>{rows.length} record{rows.length === 1 ? '' : 's'}</span></div></div>
      <div className="finance-table-head">{headers[tab].map((header) => <span key={header}>{header}</span>)}<span aria-hidden="true" /></div>
      {rows.map((row) => <button type="button" onClick={() => setSelectedRow(row)} className="procurement-record-row finance-table-row" key={sid(row.id)} style={{ ...tableRow, width: '100%', alignItems: 'center', border: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>{cells(row).map((cell, index) => <span key={index} style={{ color: index ? 'var(--text-muted)' : 'var(--text)', fontWeight: index ? 500 : 700 }}>{cell || '—'}</span>)}<Icon name="chevron_right" size={18} color="var(--text-faint)" /></button>)}
      {!rows.length && <div className="finance-empty-state"><Icon name="inbox" size={25} color="var(--text-faint)" /><strong>No {titles[tab].toLowerCase()}</strong><span>Records will appear here when they are created.</span></div>}
    </section>
    {selectedRow && <RecordDetailDrawer title={titles[tab]} subtitle={financeRecordTitle(tab, selectedRow)} record={selectedRow} onClose={() => setSelectedRow(null)} />}
  </>
}

function financeRecordTitle(tab: FinanceTab, row: Row): string {
  if (tab === 'invoices') return sid(row.invoice_number) || sid(row.id)
  if (tab === 'payments' || tab === 'expenses' || tab === 'banking') return sid(row.reference) || sid(row.id)
  return sid(row.name) || sid(row.id)
}

function FinanceMetric({ icon, label, value, hint, tone = 'neutral' }: { icon: string; label: string; value: string; hint: string; tone?: 'neutral' | 'good' | 'warning' }) {
  return <article className={`finance-kpi-card tone-${tone}`}><span className="finance-kpi-icon"><Icon name={icon} size={18} /></span><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></article>
}

function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) { return <><div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div><div style={{ ...subtle, margin: '4px 0 15px', lineHeight: 1.5 }}>{note}</div>{children}</> }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: 'block', marginBottom: 10 }}><HelpLabel label={label} style={labelStyle} />{children}</label> }
function Two({ children }: { children: ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{children}</div> }
function Input({ value, change, type = 'text' }: { value: unknown; change: (value: string) => void; type?: string }) { return <input type={type} value={sid(value)} onChange={(e) => change(e.target.value)} style={control} /> }
function Select({ value, change, rows, label = (row: Row) => sid(row.name), optional = false }: { value: unknown; change: (value: string) => void; rows: Row[]; label?: (row: Row) => string; optional?: boolean }) { return <select value={sid(value)} onChange={(e) => change(e.target.value)} style={control}><option value="">{optional ? 'None' : 'Select…'}</option>{rows.map((row) => <option key={sid(row.id)} value={sid(row.id)}>{label(row)}</option>)}</select> }
function Action({ children, click, disabled, tone = 'accent' }: any) { return <button onClick={click} disabled={disabled} style={{ ...action, opacity: disabled ? .45 : 1, background: tone === 'good' ? 'var(--good)' : 'var(--accent)' }}>{children}</button> }
function Rule() { return <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} /> }

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-sm)' }
const hero: CSSProperties = { width: 46, height: 46, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent)' }
const eyebrow: CSSProperties = { color: 'var(--accent)', fontSize: 12, fontWeight: 600, letterSpacing: '.02em' }
const subtle: CSSProperties = { color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }
const tabButton: CSSProperties = { height: 38, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', border: '1px solid', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 650 }
const labelStyle: CSSProperties = { display: 'block', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, marginBottom: 5 }
const control: CSSProperties = { width: '100%', height: 38, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12 }
const action: CSSProperties = { width: '100%', minHeight: 38, border: 0, borderRadius: 6, color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, marginTop: 5 }
const secondary: CSSProperties = { height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: 12, cursor: 'pointer' }
const tableRow: CSSProperties = { display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 1fr 20px', gap: 10, padding: '12px 17px', borderBottom: '1px solid var(--border)', fontSize: 12 }
