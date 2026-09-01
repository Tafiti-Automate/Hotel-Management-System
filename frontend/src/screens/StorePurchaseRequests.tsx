import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { createBackendRecord, errorMessage, readBackendPayload, runBackendAction } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

const id = (value: unknown) => String(value || '')
const num = (value: unknown) => Number(value || 0)

interface LineDraft {
  key: string
  item: string
  quantity: string
  note: string
}

const newLine = (): LineDraft => ({ key: crypto.randomUUID(), item: '', quantity: '1', note: '' })

function statusPresentation(status: string) {
  const value = status.toLowerCase()
  if (value === 'approved') return { label: 'Ready for Procurement', color: 'var(--good)', background: 'var(--good-soft)' }
  if (['partially_ordered', 'ordered', 'partially_received'].includes(value)) return { label: 'In Procurement', color: 'var(--accent)', background: 'var(--accent-soft)' }
  if (value === 'fulfilled') return { label: 'Fulfilled', color: 'var(--good)', background: 'var(--good-soft)' }
  if (value === 'cancelled') return { label: 'Cancelled', color: 'var(--text-muted)', background: 'var(--surface-3)' }
  if (value === 'rejected') return { label: 'Rejected', color: 'var(--bad)', background: 'var(--bad-soft)' }
  return { label: status.replace(/_/g, ' ') || 'Draft', color: 'var(--text-muted)', background: 'var(--surface-3)' }
}

export default function StorePurchaseRequests() {
  const app = useApp()
  const [payload, setPayload] = useState<Record<string, Row[]>>({ requests: [], lines: [], stores: [], balances: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [store, setStore] = useState('')
  const [reason, setReason] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([newLine()])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await readBackendPayload('requisitions/store-purchase-requests')
      setPayload({
        requests: result.requests || [],
        lines: result.lines || [],
        stores: result.stores || [],
        balances: result.balances || [],
      })
      const stores = result.stores || []
      setStore((current) => current || id(stores[0]?.id))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const items = useMemo(
    () => [...app.data.items]
      .filter((item) => id(item.status).toLowerCase() !== 'inactive')
      .sort((a, b) => `${id(a.categoryPath)} ${id(a.name)}`.localeCompare(`${id(b.categoryPath)} ${id(b.name)}`)),
    [app.data.items],
  )

  const stock = useMemo(() => {
    const map = new Map<string, number>()
    for (const balance of payload.balances || []) map.set(`${id(balance.store)}:${id(balance.item)}`, num(balance.on_hand))
    return map
  }, [payload.balances])

  const selectedStore = (payload.stores || []).find((entry) => id(entry.id) === store)
  const selectedItemIds = new Set(lines.map((line) => line.item).filter(Boolean))
  const openRequests = (payload.requests || []).filter((request) => !['fulfilled', 'cancelled', 'rejected', 'closed'].includes(id(request.status).toLowerCase()))

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))
  }

  const addLine = () => setLines((current) => [...current, newLine()])
  const removeLine = (key: string) => setLines((current) => current.length === 1 ? current : current.filter((line) => line.key !== key))

  const submit = async () => {
    if (busy) return
    if (!store) { app.showWorkflowAlert('Store required', 'Choose the store that needs replenishment.', 'warning'); return }
    if (!reason.trim()) { app.showWorkflowAlert('Reason required', 'Enter why the store needs this purchase.', 'warning'); return }
    const prepared = lines.filter((line) => line.item && Number(line.quantity) > 0)
    if (!prepared.length || prepared.length !== lines.length) {
      app.showWorkflowAlert('Complete the item lines', 'Choose an Article and enter a quantity greater than zero on every line.', 'warning')
      return
    }
    setBusy(true)
    setError('')
    try {
      const saved = await createBackendRecord('requisitions/store-purchase-requests', {
        store,
        reason: reason.trim(),
        expected_date: expectedDate || null,
        lines: prepared.map((line) => ({ item: line.item, quantity: Number(line.quantity), note: line.note.trim() })),
      })
      app.showToast(`Purchase request ${id(saved.requisition_number)} sent to Procurement`)
      setReason('')
      setExpectedDate('')
      setLines([newLine()])
      await load()
      app.refreshData()
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Purchase request could not be created', detail, 'warning')
    } finally {
      setBusy(false)
    }
  }

  const cancelRequest = async (request: Row) => {
    if (!window.confirm(`Cancel purchase request ${id(request.requisition_number)}?`)) return
    setBusy(true)
    try {
      await runBackendAction('requisitions', id(request.id), 'cancel-store-purchase-request', { comments: 'Cancelled by Store Keeper before Procurement processing.' })
      app.showToast('Purchase request cancelled')
      await load()
      app.refreshData()
    } catch (reason) {
      app.showWorkflowAlert('Could not cancel purchase request', errorMessage(reason), 'warning')
    } finally {
      setBusy(false)
    }
  }

  return <div className="store-purchase-screen" style={{ maxWidth: 1460, margin: '0 auto' }}>
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
      <div>
        <div style={eyebrow}>Store Keeper · Replenishment</div>
        <h1 style={{ margin: '3px 0 0', color: 'var(--text)', fontSize: 27, fontWeight: 700, letterSpacing: '-.03em' }}>Store Purchase Requests</h1>
        <p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>Request stock directly for an assigned store. Procurement selects the supplier; prices remain controlled by the Cost Controller.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading} style={secondary}><Icon name="refresh" size={17} />{loading ? 'Refreshing…' : 'Refresh'}</button>
    </header>

    <div className="store-purchase-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(180px,1fr))', gap: 10, marginBottom: 14 }}>
      <Metric label="Assigned stores" value={(payload.stores || []).length} icon="warehouse" />
      <Metric label="Open purchase requests" value={openRequests.length} icon="shopping_cart_checkout" />
      <Metric label="Available Articles" value={items.length} icon="inventory_2" />
    </div>

    {error && <div role="alert" style={{ ...card, padding: 12, color: 'var(--bad)', marginBottom: 14, fontSize: 12.5 }}>{error}</div>}

    <div className="store-purchase-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(330px,.75fr)', gap: 14, alignItems: 'start' }}>
      <section style={card}>
        <div style={sectionHeader}>
          <div><strong>Create purchase request</strong><span>Send a replenishment need directly to Procurement.</span></div>
          <span style={stepBadge}>STORE → PROCUREMENT</span>
        </div>
        <div style={{ padding: 16 }}>
          <div className="store-purchase-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <Field label="Destination store">
              <select value={store} onChange={(event) => setStore(event.target.value)} style={input} disabled={(payload.stores || []).length <= 1}>
                <option value="">Select assigned store</option>
                {(payload.stores || []).map((entry) => <option key={id(entry.id)} value={id(entry.id)}>{id(entry.name)}{entry.branch_name ? ` · ${id(entry.branch_name)}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Required date">
              <input type="date" value={expectedDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setExpectedDate(event.target.value)} style={input} />
            </Field>
          </div>
          <Field label="Reason for purchase">
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Replenish store stock before the next operating cycle" style={{ ...input, minHeight: 74, padding: '10px 11px', resize: 'vertical' }} />
          </Field>

          <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
              <div><strong style={{ color: 'var(--text)', fontSize: 13 }}>Articles requested</strong><div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>Enter quantities only. Supplier and price fields are intentionally not available.</div></div>
              <button type="button" onClick={addLine} style={secondary}><Icon name="add" size={16} />Add Article</button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {lines.map((line, index) => {
                const item = items.find((entry) => id(entry.id) === line.item)
                const onHand = stock.get(`${store}:${line.item}`) ?? 0
                return <div key={line.key} className="store-purchase-line" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.5fr) 120px minmax(170px,1fr) 38px', gap: 8, alignItems: 'end', padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
                  <Field label={`Article ${index + 1}`}>
                    <select value={line.item} onChange={(event) => updateLine(line.key, { item: event.target.value })} style={input}>
                      <option value="">Select Article</option>
                      {items.map((entry) => <option key={id(entry.id)} value={id(entry.id)} disabled={selectedItemIds.has(id(entry.id)) && line.item !== id(entry.id)}>{id(entry.categoryPath)} · {id(entry.name)} ({id(entry.sku)})</option>)}
                    </select>
                    {line.item && <small style={{ display: 'block', marginTop: 5, color: 'var(--text-faint)' }}>Current stock at {id(selectedStore?.name) || 'store'}: <strong style={{ color: 'var(--text-muted)' }}>{onHand.toLocaleString()} {id(item?.uom)}</strong></small>}
                  </Field>
                  <Field label={`Quantity${item?.uom ? ` (${id(item.uom)})` : ''}`}>
                    <input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} style={input} />
                  </Field>
                  <Field label="Line note (optional)">
                    <input value={line.note} onChange={(event) => updateLine(line.key, { note: event.target.value })} placeholder="Specification / note" style={input} />
                  </Field>
                  <button type="button" onClick={() => removeLine(line.key)} disabled={lines.length === 1} title="Remove line" style={{ ...iconButton, opacity: lines.length === 1 ? .45 : 1 }}><Icon name="delete" size={17} /></button>
                </div>
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220, color: 'var(--text-faint)', fontSize: 12, lineHeight: 1.5 }}><Icon name="lock" size={15} color="var(--text-faint)" style={{ verticalAlign: 'text-bottom', marginRight: 5 }} />No supplier or price can be entered from this screen.</div>
            <button type="button" onClick={() => void submit()} disabled={busy || loading} style={{ ...primary, opacity: busy ? .65 : 1 }}><Icon name="send" size={17} />{busy ? 'Sending…' : 'Send to Procurement'}</button>
          </div>
        </div>
      </section>

      <section style={card}>
        <div style={sectionHeader}><div><strong>Recent purchase requests</strong><span>Your store replenishment requests.</span></div><span style={countBadge}>{(payload.requests || []).length}</span></div>
        <div style={{ maxHeight: 610, overflowY: 'auto' }}>
          {(payload.requests || []).map((request) => {
            const status = statusPresentation(id(request.status))
            return <div key={id(request.id)} style={{ padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 750 }}>{id(request.requisition_number) || id(request.id)}</div>
                  <div style={{ marginTop: 3, color: 'var(--text-muted)', fontSize: 12 }}>{id(request.destination_store_name) || 'Assigned store'} · {num(request.item_count)} item{num(request.item_count) === 1 ? '' : 's'}</div>
                </div>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: status.background, color: status.color, fontSize: 10.5, fontWeight: 750, whiteSpace: 'nowrap' }}>{status.label}</span>
              </div>
              <div style={{ marginTop: 8, color: 'var(--text-faint)', fontSize: 11.5, lineHeight: 1.45 }}>{id(request.item_summary) || id(request.reason)}</div>
              <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{id(request.created_at).slice(0, 10)}</span>
                {Boolean(request.can_cancel) && <button type="button" onClick={() => void cancelRequest(request)} disabled={busy} style={linkButton}>Cancel request</button>}
              </div>
            </div>
          })}
          {!loading && !(payload.requests || []).length && <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12.5 }}><Icon name="shopping_cart_checkout" size={27} color="var(--text-faint)" /><div style={{ marginTop: 7, color: 'var(--text)', fontWeight: 700 }}>No purchase requests yet</div><div style={{ marginTop: 3 }}>Your store replenishment requests will appear here.</div></div>}
          {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>Loading purchase requests…</div>}
        </div>
      </section>
    </div>
  </div>
}

function Metric({ label, value, icon }: { label: string; value: number; icon: string }) {
  return <div style={{ ...card, padding: 15, display: 'flex', alignItems: 'center', gap: 11 }}><span style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'var(--accent-soft)' }}><Icon name={icon} size={19} color="var(--accent)" /></span><div><div style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{label}</div><div style={{ marginTop: 2, color: 'var(--text)', fontSize: 21, fontWeight: 750 }}>{value}</div></div></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', minWidth: 0 }}><span style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 700 }}>{label}</span>{children}</label>
}

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }
const eyebrow: CSSProperties = { color: 'var(--accent)', fontSize: 11.5, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase' }
const sectionHeader: CSSProperties = { minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13 }
const input: CSSProperties = { width: '100%', minHeight: 40, border: '1px solid var(--border)', borderRadius: 7, padding: '0 10px', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontSize: 12.5, outline: 'none' }
const primary: CSSProperties = { minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', border: '1px solid var(--accent)', borderRadius: 7, background: 'var(--accent)', color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 700 }
const secondary: CSSProperties = { minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 650 }
const iconButton: CSSProperties = { width: 36, height: 40, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
const linkButton: CSSProperties = { padding: 0, border: 0, background: 'transparent', color: 'var(--bad)', cursor: 'pointer', font: 'inherit', fontSize: 11.5, fontWeight: 650 }
const stepBadge: CSSProperties = { padding: '4px 8px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 10.5, fontWeight: 750, letterSpacing: '.03em' }
const countBadge: CSSProperties = { minWidth: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: 999, background: 'var(--surface-3)', color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 750 }
