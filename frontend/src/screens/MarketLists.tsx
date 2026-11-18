import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import ConfirmTransaction from '../components/ConfirmTransaction'
import { createBackendRecord, errorMessage, readBackendPayload, runBackendAction } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

type MarketLine = { item: string; sku: string; article: string; quantity: string; unit_name: string }
type MarketRecord = {
  id: string; reference: string; business_date: string; department: string;
  status: string; purpose: string; lines: MarketLine[]
}
type MarketPayload = { business_date: string; results: MarketRecord[] }
type DraftLine = { item: string; quantity: string }

const isTracked = (row: Row) => {
  const active = (value: unknown) => value === true || value === 'true'
  return active(row.batchTracking ?? row.batch_tracking)
    || active(row.expiryTracking ?? row.expiry_tracking)
    || active(row.requiresDeliveryTemperature ?? row.requires_delivery_temperature)
}
const quantityValid = (value: string) =>
  /^\d+(?:\.\d{1,4})?$/.test(value.trim()) && Number(value) > 0

export default function MarketLists() {
  const app = useApp()
  const [data, setData] = useState<MarketPayload | null>(null)
  const [purpose, setPurpose] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([{ item: '', quantity: '' }])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const articles = useMemo(() =>
    (app.data.items as Row[]).filter(isTracked).sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    ), [app.data.items]
  )
  const articlesById = useMemo(() =>
    new Map(articles.map((item) => [String(item.id), item])), [articles]
  )
  const validDraft = purpose.trim().length > 0 && lines.length > 0
    && lines.every((line) => articlesById.has(line.item) && quantityValid(line.quantity))
    && new Set(lines.map((line) => line.item)).size === lines.length

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await readBackendPayload('requisitions/market-lists/')
      setData(payload as unknown as MarketPayload)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const save = async () => {
    if (!validDraft || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await createBackendRecord('requisitions/market-lists', {
        purpose: purpose.trim(),
        lines: lines.map((line) => ({ item: line.item, quantity: line.quantity })),
      }) as Row
      app.showToast('Daily Market List ' + String(result.reference || '') + ' saved as a draft')
      setPurpose('')
      setLines([{ item: '', quantity: '' }])
      await reload()
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Market List was not saved', message)
    } finally { setBusy(false) }
  }

  const submit = async (record: MarketRecord) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await runBackendAction('requisitions', record.id, 'submit-market-list')
      app.showToast('Market List ' + record.reference + ' submitted for independent approvals')
      await reload()
      await app.refreshData()
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Market List submission blocked', message)
    } finally { setBusy(false) }
  }

  const visible = (data?.results || []).filter((record) =>
    [record.reference, record.purpose, record.status, ...record.lines.map((line) => line.article)]
      .some((value) => value.toLowerCase().includes(search.trim().toLowerCase()))
  )

  return <div className="enterprise-workspace market-list-screen">
    <header className="market-list-header">
      <div>
        <span className="market-list-eyebrow">DEPARTMENT / FRESH FOOD PROCUREMENT</span>
        <h1>Daily Market Lists</h1>
        <p>Request fresh, traceable ingredients in base units. Purchasing controls supplier pricing and Finance controls monetary approval.</p>
      </div>
      <button type="button" onClick={() => void reload()} disabled={busy || loading} className="market-list-secondary">
        <Icon name="refresh" size={17} /> Refresh
      </button>
    </header>

    <div className="market-list-summary">
      <div><span>Business date</span><strong>{data?.business_date || '—'}</strong></div>
      <div><span>Market Lists</span><strong>{data?.results.length ?? 0}</strong></div>
      <div><span>Drafts awaiting submission</span><strong>{data?.results.filter((row) => row.status === 'draft').length ?? 0}</strong></div>
    </div>

    {error && <div className="market-list-error" role="alert"><Icon name="error" size={17} />{error}</div>}
    <div className="market-list-columns">
      <section className="market-list-panel">
        <header><div><h2>New daily Market List</h2><p>Fresh-food quantities only. No supplier prices are shown to the Department Head.</p></div><Icon name="add_shopping_cart" size={20} /></header>
        <div className="market-list-form">
          <label className="market-list-field">
            <span>Purpose / daily service *</span>
            <textarea value={purpose} rows={3} maxLength={2000} onChange={(event) => setPurpose(event.target.value)}
              placeholder="E.g. Breakfast buffet and restaurant fresh produce" />
          </label>
          <div className="market-list-lines-heading"><strong>Perishable Articles</strong><small>Enter quantity in the configured Article base unit · four decimal places maximum</small></div>
          {lines.map((line, index) => {
            const article = articlesById.get(line.item)
            return <div className="market-list-draft-line" key={index}>
              <label className="market-list-field">
                <span>Article {index + 1} *</span>
                <select value={line.item} onChange={(event) => setLines((current) =>
                  current.map((row, i) => i === index ? { ...row, item: event.target.value } : row)
                )}>
                  <option value="">Select a traceable Article…</option>
                  {articles.map((item) => <option key={String(item.id)} value={String(item.id)}>
                    {String(item.name)} · {String(item.sku || '')}
                  </option>)}
                </select>
              </label>
              <label className="market-list-field">
                <span>Base quantity * {article ? '(' + String(article.uom || article.unit || 'units') + ')' : ''}</span>
                <input type="number" inputMode="decimal" min="0.0001" step="0.0001"
                  value={line.quantity} onChange={(event) => setLines((current) =>
                    current.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row)
                  )} placeholder="0.0000" />
              </label>
              <button type="button" className="market-list-remove" aria-label={'Remove Article ' + (index + 1)}
                disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
                <Icon name="close" size={17} />
              </button>
            </div>
          })}
          {!articles.length && <p className="market-list-hint" role="alert">
            No batch, expiry or temperature-tracked Articles are available. Ask the System Administrator to configure Article traceability first.
          </p>}
          <div className="market-list-actions">
            <button type="button" disabled={busy || lines.length >= 50} className="market-list-secondary"
              onClick={() => setLines((current) => [...current, { item: '', quantity: '' }])}>
              <Icon name="add" size={16} /> Add Article
            </button>
            <ConfirmTransaction
              title="Save this daily Market List?"
              description="This creates a quantity-only purchase requisition as a draft. It does not approve spending, select a supplier or post stock."
              confirmLabel="Save Market List draft"
              disabled={busy || !validDraft}
              busy={busy}
              onConfirm={save}
            >Save draft</ConfirmTransaction>
          </div>
        </div>
      </section>

      <section className="market-list-panel">
        <header><div><h2>My Market List register</h2><p>Each draft enters the existing PR approval process only after a valid published supplier estimate is available.</p></div></header>
        <label className="market-list-field market-list-search">
          <span>Search register</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Reference, ingredient, purpose or status" />
        </label>
        {loading && <p className="market-list-hint" role="status">Loading current Market Lists…</p>}
        {!loading && !visible.length && <p className="market-list-hint">No Market Lists match your filter.</p>}
        <div className="market-list-register">
          {visible.map((record) => <article key={record.id} className="market-list-record">
            <div className="market-list-record-head">
              <div><strong>{record.reference}</strong><small>{record.business_date} · {record.department}</small></div>
              <span className={'market-list-status status-' + record.status}>{record.status.replaceAll('_', ' ')}</span>
            </div>
            <p>{record.purpose}</p>
            <div className="market-list-record-lines">
              {record.lines.map((line) => <div key={line.item}>
                <span>{line.article}</span><strong>{line.quantity} {line.unit_name}</strong>
              </div>)}
            </div>
            {record.status === 'draft' && <ConfirmTransaction
              title={'Submit Market List ' + record.reference + '?'}
              description="The system will validate current Cost Controller-published supplier prices and the existing budget and approval matrix. No supplier, PO or GRN is issued by submission."
              confirmLabel="Submit for approval"
              disabled={busy}
              busy={busy}
              onConfirm={() => submit(record)}
            >Submit for approval</ConfirmTransaction>}
          </article>)}
        </div>
      </section>
    </div>
  </div>
}
