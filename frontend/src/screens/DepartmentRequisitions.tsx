import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import {
  createBackendRecord,
  deleteBackendPath,
  errorMessage,
  readBackendRecords,
  runBackendAction,
  updateBackendRecord,
} from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

type WorkspaceData = {
  requests: Row[]
  lines: Row[]
  stores: Row[]
  categories: Row[]
  items: Row[]
  units: Row[]
}

type RequestFilter = 'all' | 'active' | 'completed' | 'rejected'

type LineDraft = {
  id: string
  majorGroup: string
  itemGroup: string
  item: string
  quantity: string
  remarks: string
}

const emptyData: WorkspaceData = {
  requests: [], lines: [], stores: [], categories: [], items: [], units: [],
}

const emptyLine: LineDraft = {
  id: '', majorGroup: '', itemGroup: '', item: '', quantity: '', remarks: '',
}

const editableStatuses = new Set(['draft', 'rejected'])
const completedStatuses = new Set(['issued', 'completed', 'cancelled'])

const id = (value: unknown) => String(value || '')
const num = (value: unknown) => Number(value || 0)
const key = (value: unknown) => id(value).trim().toLowerCase()

export default function DepartmentRequisitions() {
  const app = useApp()
  const [data, setData] = useState<WorkspaceData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState<RequestFilter>('all')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [requestDraft, setRequestDraft] = useState<Row>({})
  const [lineDraft, setLineDraft] = useState<LineDraft>(emptyLine)
  const [legacyQuantities, setLegacyQuantities] = useState<Record<string, string>>({})
  const [legacyReasons, setLegacyReasons] = useState<Record<string, string>>({})
  const [legacyComment, setLegacyComment] = useState('')
  const [legacyRejectReason, setLegacyRejectReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [requests, lines, stores, categories, items, units] = await Promise.all([
        readBackendRecords('store-requisitions'),
        readBackendRecords('store-requisition-items'),
        readBackendRecords('store-requisitions/store-options'),
        readBackendRecords('categories'),
        readBackendRecords('items'),
        readBackendRecords('units'),
      ])
      setData({ requests, lines, stores, categories, items, units })
      setSelectedId((current) => current && requests.some((row) => id(row.id) === current) ? current : '')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const perform = useCallback(async (
    operation: () => Promise<unknown>,
    success: string,
    options: { keepSelected?: boolean; selectedId?: string } = {},
  ) => {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      const result = await operation()
      await load()
      await app.refreshData()
      if (options.selectedId) setSelectedId(options.selectedId)
      else if (!options.keepSelected) setSelectedId('')
      app.showToast(success)
      return result
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Action could not be completed', detail)
      return false
    } finally {
      setBusy(false)
    }
  }, [app, busy, load])

  const selected = useMemo(
    () => data.requests.find((row) => id(row.id) === selectedId) || null,
    [data.requests, selectedId],
  )
  const selectedLines = useMemo(
    () => data.lines.filter((line) => id(line.requisition) === selectedId),
    [data.lines, selectedId],
  )
  const ownSelected = Boolean(selected && id(selected.requested_by) === app.user.employeeId)
  const editable = Boolean(selected && ownSelected && editableStatuses.has(key(selected.status)))
  const legacyPending = Boolean(
    selected && key(selected.status) === 'pending_department_approval' && !ownSelected,
  )

  useEffect(() => {
    if (!selected) {
      setRequestDraft({})
      setLineDraft(emptyLine)
      setLegacyQuantities({})
      setLegacyReasons({})
      setLegacyComment('')
      setLegacyRejectReason('')
      return
    }
    setRequestDraft({
      purpose: selected.purpose || '',
      required_date: selected.required_date || '',
      store: selected.store || '',
    })
    setLineDraft(emptyLine)
    if (key(selected.status) === 'pending_department_approval' && !ownSelected) {
      const quantities: Record<string, string> = {}
      selectedLines.forEach((line) => {
        quantities[id(line.id)] = id(line.hod_approved_quantity || line.base_quantity_requested || line.quantity_requested)
      })
      setLegacyQuantities(quantities)
      setLegacyReasons({})
    }
  }, [ownSelected, selected, selectedLines])

  const lineIdsByRequest = useMemo(() => {
    const map = new Map<string, Row[]>()
    data.lines.forEach((line) => {
      const requestId = id(line.requisition)
      map.set(requestId, [...(map.get(requestId) || []), line])
    })
    return map
  }, [data.lines])

  const visibleRequests = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return [...data.requests]
      .filter((row) => {
        const state = key(row.status)
        if (filter === 'active' && (completedStatuses.has(state) || state === 'rejected')) return false
        if (filter === 'completed' && !completedStatuses.has(state)) return false
        if (filter === 'rejected' && state !== 'rejected') return false
        if (status && state !== status) return false
        const date = id(row.created_at).slice(0, 10)
        if (dateFrom && date < dateFrom) return false
        if (dateTo && date > dateTo) return false
        if (!normalizedQuery) return true
        const lines = lineIdsByRequest.get(id(row.id)) || []
        const haystack = [
          row.requisition_no, row.purpose, row.store_name, row.store_address,
          ...lines.flatMap((line) => [line.item_name, line.category_name, line.remarks]),
        ].map(id).join(' ').toLowerCase()
        return haystack.includes(normalizedQuery)
      })
      .sort((a, b) => id(b.created_at).localeCompare(id(a.created_at)))
  }, [data.requests, dateFrom, dateTo, filter, lineIdsByRequest, query, status])

  const counts = useMemo(() => {
    const own = data.requests.filter((row) => id(row.requested_by) === app.user.employeeId)
    return {
      drafts: own.filter((row) => key(row.status) === 'draft').length,
      stores: own.filter((row) => ['submitted', 'approved', 'partially_approved', 'partially_issued'].includes(key(row.status))).length,
      procurement: own.filter((row) => key(row.status) === 'awaiting_procurement').length,
      completed: own.filter((row) => completedStatuses.has(key(row.status))).length,
    }
  }, [app.user.employeeId, data.requests])

  const statuses = useMemo(
    () => Array.from(new Set(data.requests.map((row) => key(row.status)).filter(Boolean))).sort(),
    [data.requests],
  )

  const createRequest = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const created = await createBackendRecord('store-requisitions', { purpose: '' })
      await load()
      await app.refreshData()
      setSelectedId(id(created.id || created.apiId))
      app.showToast('Department requisition created')
    } catch (reason) {
      const detail = errorMessage(reason)
      setError(detail)
      app.showWorkflowAlert('Could not create requisition', detail)
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = async () => {
    if (!selected || !editable) return
    const requestId = id(selected.id)
    await perform(
      () => updateBackendRecord('store-requisitions', requestId, {
        purpose: id(requestDraft.purpose).trim(),
        required_date: requestDraft.required_date || null,
        store: requestDraft.store || null,
      }),
      'Draft saved',
      { selectedId: requestId },
    )
  }

  const submitDraft = async () => {
    if (!selected || !editable) return
    const requestId = id(selected.id)
    const hasStore = Boolean(requestDraft.store || selected.store)
    if (!hasStore) {
      app.showWorkflowAlert('Issuing store required', 'Select the issuing store before submitting the requisition.', 'warning')
      return
    }
    if (!selectedLines.length) {
      app.showWorkflowAlert('Items required', 'Add at least one Article before submitting the requisition.', 'warning')
      return
    }
    const saved = await perform(
      async () => {
        await updateBackendRecord('store-requisitions', requestId, {
          purpose: id(requestDraft.purpose).trim(),
          required_date: requestDraft.required_date || null,
          store: requestDraft.store || null,
        })
        return runBackendAction('store-requisitions', requestId, 'submit', {})
      },
      'Requisition submitted directly to Stores',
      { selectedId: requestId },
    )
    if (saved) setLineDraft(emptyLine)
  }

  const deleteDraft = async () => {
    if (!selected || !editable) return
    if (!window.confirm(`Delete ${id(selected.requisition_no)} and its draft items?`)) return
    await perform(
      () => deleteBackendPath('store-requisitions', id(selected.id)),
      'Draft requisition deleted',
    )
  }

  const cancelRequest = async () => {
    if (!selected || !ownSelected) return
    if (!window.confirm(`Cancel ${id(selected.requisition_no)}?`)) return
    await perform(
      () => runBackendAction('store-requisitions', id(selected.id), 'cancel', {}),
      'Requisition cancelled',
      { selectedId: id(selected.id) },
    )
  }

  const saveLine = async () => {
    if (!selected || !editable || !lineDraft.item || num(lineDraft.quantity) <= 0) return
    const item = data.items.find((row) => id(row.id) === lineDraft.item)
    const body = {
      requisition: id(selected.id),
      item: lineDraft.item,
      unit: item?.base_unit || null,
      quantity_requested: num(lineDraft.quantity),
      quantity_approved: 0,
      quantity_issued: 0,
      remarks: lineDraft.remarks.trim(),
    }
    const requestId = id(selected.id)
    const ok = await perform(
      () => lineDraft.id
        ? updateBackendRecord('store-requisition-items', lineDraft.id, body)
        : createBackendRecord('store-requisition-items', body),
      lineDraft.id ? 'Requisition item updated' : 'Requisition item added',
      { selectedId: requestId },
    )
    if (ok) setLineDraft(emptyLine)
  }

  const editLine = (line: Row) => {
    const item = data.items.find((row) => id(row.id) === id(line.item))
    const group = data.categories.find((row) => id(row.id) === id(item?.category))
    setLineDraft({
      id: id(line.id),
      majorGroup: id(group?.parent || group?.id),
      itemGroup: id(group?.parent ? group.id : ''),
      item: id(line.item),
      quantity: id(line.quantity_requested),
      remarks: id(line.remarks),
    })
  }

  const deleteLine = async (line: Row) => {
    if (!selected || !editable) return
    if (!window.confirm(`Remove ${id(line.item_name || 'this Article')} from the requisition?`)) return
    const requestId = id(selected.id)
    await perform(
      () => deleteBackendPath('store-requisition-items', id(line.id)),
      'Requisition item removed',
      { selectedId: requestId },
    )
  }

  const approveLegacy = async () => {
    if (!selected || !legacyPending) return
    const items = selectedLines.map((line) => {
      const quantity = num(legacyQuantities[id(line.id)])
      return {
        id: id(line.id),
        approved_quantity: quantity,
        rejected: quantity === 0,
        rejection_reason: quantity === 0 ? id(legacyReasons[id(line.id)]).trim() : '',
      }
    })
    const invalid = selectedLines.find((line) => {
      const quantity = num(legacyQuantities[id(line.id)])
      const max = num(line.base_quantity_requested || line.quantity_requested)
      return quantity < 0 || quantity > max || (quantity === 0 && !id(legacyReasons[id(line.id)]).trim())
    })
    if (invalid) {
      app.showWorkflowAlert(
        'Check approved quantities',
        'Approved quantities must be between zero and the original request. A rejected line also requires a reason.',
        'warning',
      )
      return
    }
    await perform(
      () => runBackendAction('store-requisitions', id(selected.id), 'department-approve', {
        comments: legacyComment,
        items,
      }),
      'Legacy requisition approved and sent to Stores',
      { selectedId: id(selected.id) },
    )
  }

  const rejectLegacy = async () => {
    if (!selected || !legacyPending || !legacyRejectReason.trim()) return
    await perform(
      () => runBackendAction('store-requisitions', id(selected.id), 'reject', { reason: legacyRejectReason.trim() }),
      'Legacy requisition rejected',
      { selectedId: id(selected.id) },
    )
  }

  const selectableItems = [...data.items].filter((row) => row.is_active !== false).sort((a, b) => id(a.name).localeCompare(id(b.name)))

  return (
    <div className="hod-requisitions-page">
      <header className="hod-page-header">
        <div>
          <div className="hod-page-eyebrow">Department workflow</div>
          <h1>Department Requisitions</h1>
          <p>Create the department request here, then follow it through Stores and Procurement.</p>
        </div>
        <div className="hod-page-actions">
          <button type="button" className="erp-secondary" onClick={() => void load()} disabled={loading || busy}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
          <button type="button" className="erp-primary" onClick={() => void createRequest()} disabled={busy}>
            <Icon name="add" size={17} color="#fff" /> New requisition
          </button>
        </div>
      </header>

      <section className="hod-flow-strip" aria-label="Department requisition workflow">
        <FlowStep icon="edit_note" label="Department Head" detail="Create & submit" active />
        <FlowArrow />
        <FlowStep icon="warehouse" label="Store Keeper" detail="Review & reduce if needed" />
        <FlowArrow />
        <FlowStep icon="shopping_cart_checkout" label="Procurement" detail="Supplier & LPO" />
        <FlowArrow />
        <FlowStep icon="local_shipping" label="Receiving" detail="GRN & completion" />
      </section>

      <section className="hod-kpi-grid" aria-label="Requisition summary">
        <Kpi icon="edit_note" label="Drafts" value={counts.drafts} />
        <Kpi icon="warehouse" label="At Stores" value={counts.stores} />
        <Kpi icon="shopping_cart_checkout" label="Procurement" value={counts.procurement} />
        <Kpi icon="task_alt" label="Completed" value={counts.completed} />
      </section>

      {error && <div className="hod-error" role="alert"><Icon name="error" size={18} /><span>{error}</span></div>}

      <div className={`hod-workspace${selected ? ' has-selection' : ''}`}>
        <section className="hod-list-panel">
          <div className="hod-list-heading">
            <div>
              <strong>Requisition register</strong>
              <span>{visibleRequests.length} visible record{visibleRequests.length === 1 ? '' : 's'}</span>
            </div>
            <div className="hod-segmented" role="group" aria-label="Requisition view">
              {([
                ['all', 'All'], ['active', 'Active'], ['completed', 'Completed'], ['rejected', 'Rejected'],
              ] as Array<[RequestFilter, string]>).map(([value, label]) => (
                <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>
              ))}
            </div>
          </div>

          <button type="button" className="hod-mobile-filter-toggle" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}>
            <Icon name="tune" size={16} /> {filtersOpen ? 'Hide filters' : 'Filters'}
            {(status || dateFrom || dateTo) && <span>Active</span>}
          </button>
          <div className={`hod-filters${filtersOpen ? ' mobile-open' : ''}`}>
            <label className="hod-search-field"><span>Search</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Requisition, purpose or Article…" /></label>
            <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All</option>{statuses.map((value) => <option key={value} value={value}>{friendlyStatus(value)}</option>)}</select></label>
            <label><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
            {(query || status || dateFrom || dateTo) && <button type="button" className="hod-clear-filter" onClick={() => { setQuery(''); setStatus(''); setDateFrom(''); setDateTo('') }}><Icon name="filter_alt_off" size={15} /> Clear</button>}
          </div>

          <div className="hod-request-list" aria-busy={loading}>
            {loading && <ListSkeleton />}
            {!loading && visibleRequests.map((row) => {
              const rowLines = lineIdsByRequest.get(id(row.id)) || []
              const selectedRow = selectedId === id(row.id)
              const legacy = key(row.status) === 'pending_department_approval' && id(row.requested_by) !== app.user.employeeId
              return (
                <button
                  type="button"
                  key={id(row.id)}
                  className={`hod-request-row${selectedRow ? ' selected' : ''}`}
                  onClick={() => setSelectedId(id(row.id))}
                >
                  <span className="hod-request-ref">{id(row.requisition_no)}</span>
                  <span className="hod-request-main">
                    <strong>{id(row.purpose) || `${rowLines.length} Article${rowLines.length === 1 ? '' : 's'}`}</strong>
                    <small>{rowLines.length} item{rowLines.length === 1 ? '' : 's'} · {id(row.store_name) || 'Store not selected'}{legacy ? ' · Legacy approval' : ''}</small>
                  </span>
                  <span className="hod-request-date">{formatDate(row.created_at)}</span>
                  <StatusBadge status={id(row.status)} />
                  <Icon name="chevron_right" size={16} />
                </button>
              )
            })}
            {!loading && !visibleRequests.length && (
              <div className="hod-empty-state">
                <span><Icon name="inbox" size={24} /></span>
                <strong>No requisitions found</strong>
                <p>{data.requests.length ? 'Change or clear the filters to see more records.' : 'Create the first department requisition when your department needs an Article.'}</p>
                {!data.requests.length && <button type="button" className="erp-primary" onClick={() => void createRequest()}><Icon name="add" size={16} color="#fff" /> New requisition</button>}
              </div>
            )}
          </div>
        </section>

        <aside className={`hod-detail-panel${selected ? ' open' : ''}`}>
          {selected ? (
            <>
              <div className="hod-detail-mobile-bar">
                <button type="button" onClick={() => setSelectedId('')}><Icon name="arrow_back" size={18} /> Requisitions</button>
              </div>
              <header className="hod-detail-header">
                <div>
                  <span>{legacyPending ? 'Legacy approval record' : editable ? 'Draft requisition' : 'Requisition record'}</span>
                  <h2>{id(selected.requisition_no)}</h2>
                  <p>{formatDateTime(selected.created_at)} · {selectedLines.length} item{selectedLines.length === 1 ? '' : 's'}</p>
                </div>
                <StatusBadge status={id(selected.status)} />
              </header>

              <div className="hod-detail-scroll">
                {legacyPending ? (
                  <LegacyApproval
                    request={selected}
                    lines={selectedLines}
                    data={data}
                    quantities={legacyQuantities}
                    reasons={legacyReasons}
                    comment={legacyComment}
                    rejectReason={legacyRejectReason}
                    busy={busy}
                    setQuantities={setLegacyQuantities}
                    setReasons={setLegacyReasons}
                    setComment={setLegacyComment}
                    setRejectReason={setLegacyRejectReason}
                    approve={() => void approveLegacy()}
                    reject={() => void rejectLegacy()}
                  />
                ) : editable ? (
                  <DraftEditor
                    requestDraft={requestDraft}
                    setRequestDraft={setRequestDraft}
                    lines={selectedLines}
                    data={data}
                    lineDraft={lineDraft}
                    setLineDraft={setLineDraft}
                    selectableItems={selectableItems}
                    busy={busy}
                    saveDraft={() => void saveDraft()}
                    submitDraft={() => void submitDraft()}
                    deleteDraft={() => void deleteDraft()}
                    saveLine={() => void saveLine()}
                    editLine={editLine}
                    deleteLine={(line) => void deleteLine(line)}
                  />
                ) : (
                  <RequestDetails request={selected} lines={selectedLines} data={data} />
                )}
              </div>

              {!editable && !legacyPending && ownSelected && ['submitted', 'pending_department_approval'].includes(key(selected.status)) && (
                <footer className="hod-detail-footer">
                  <span><Icon name="info" size={15} /> Submitted requests are locked to protect the audit trail.</span>
                  <button type="button" className="erp-secondary danger-text" disabled={busy} onClick={() => void cancelRequest()}>Cancel requisition</button>
                </footer>
              )}
            </>
          ) : (
            <div className="hod-detail-empty">
              <span><Icon name="description" size={26} /></span>
              <strong>Select a requisition</strong>
              <p>Choose a record to view its Articles, progress and available actions.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function DraftEditor({
  requestDraft, setRequestDraft, lines, data, lineDraft, setLineDraft,
  selectableItems, busy, saveDraft, submitDraft, deleteDraft,
  saveLine, editLine, deleteLine,
}: {
  requestDraft: Row
  setRequestDraft: (value: Row) => void
  lines: Row[]
  data: WorkspaceData
  lineDraft: LineDraft
  setLineDraft: (value: LineDraft) => void
  selectableItems: Row[]
  busy: boolean
  saveDraft: () => void
  submitDraft: () => void
  deleteDraft: () => void
  saveLine: () => void
  editLine: (line: Row) => void
  deleteLine: (line: Row) => void
}) {
  const selectedItem = data.items.find((row) => id(row.id) === lineDraft.item)
  const unit = data.units.find((row) => id(row.id) === id(selectedItem?.base_unit))
  const category = data.categories.find((row) => id(row.id) === id(selectedItem?.category))
  const parentCategory = data.categories.find((row) => id(row.id) === id(category?.parent))
  const selectedMeta = selectedItem ? [
    id(parentCategory?.name), id(category?.name), id(unit?.abbreviation || unit?.name), id(selectedItem.sku),
  ].filter(Boolean) : []
  const canSubmit = Boolean(requestDraft.store && lines.length)
  return (
    <div className="hod-editor">
      <section className="hod-editor-section">
        <div className="hod-section-heading"><div><strong>Request details</strong><span>Department and requester come from your account.</span></div></div>
        <div className="hod-form-grid">
          <label className="span-2"><span>Purpose / reason</span><textarea rows={3} value={id(requestDraft.purpose)} onChange={(event) => setRequestDraft({ ...requestDraft, purpose: event.target.value })} placeholder="What does the department need these Articles for?" /></label>
          <label><span>Required date</span><input type="date" value={id(requestDraft.required_date)} onChange={(event) => setRequestDraft({ ...requestDraft, required_date: event.target.value })} /></label>
          <label><span>Issuing store</span><select value={id(requestDraft.store)} onChange={(event) => setRequestDraft({ ...requestDraft, store: event.target.value })}><option value="">Choose issuing store</option>{data.stores.map((store) => <option key={id(store.id)} value={id(store.id)}>{id(store.name)}{store.address ? ` · ${store.address}` : ''}</option>)}</select></label>
        </div>
      </section>

      <section className="hod-editor-section">
        <div className="hod-section-heading"><div><strong>Articles</strong><span>The original requested quantity is preserved after submission.</span></div><span className="hod-count-chip">{lines.length} item{lines.length === 1 ? '' : 's'}</span></div>
        <div className="hod-line-list">
          {lines.map((line) => <div key={id(line.id)} className="hod-line-row">
            <div className="hod-line-copy"><strong>{id(line.item_name) || itemName(data, line.item)}</strong><span>{id(line.category_name) || 'Article'} · {unitName(data, line.unit)}</span>{line.remarks && <small>{id(line.remarks)}</small>}</div>
            <div className="hod-line-quantity"><span>Requested</span><strong>{formatQty(line.quantity_requested)} {unitAbbr(data, line.unit)}</strong></div>
            <div className="hod-line-actions"><button type="button" onClick={() => editLine(line)} aria-label="Edit item"><Icon name="edit" size={15} /></button><button type="button" onClick={() => deleteLine(line)} aria-label="Remove item"><Icon name="delete" size={15} /></button></div>
          </div>)}
          {!lines.length && <div className="hod-line-empty"><Icon name="playlist_add" size={22} /><span>No Articles have been added yet.</span></div>}
        </div>

        <div className="hod-add-line-card">
          <div className="hod-add-line-title"><strong>{lineDraft.id ? 'Edit Article' : 'Add Article'}</strong>{lineDraft.id && <button type="button" onClick={() => setLineDraft(emptyLine)}>Cancel edit</button>}</div>
          <div className="hod-add-line-grid">
            <div className="hod-article-picker-field span-2">
              <span className="hod-field-label">Article / item</span>
              <ArticlePicker items={selectableItems} categories={data.categories} value={lineDraft.item} onChange={(item) => setLineDraft({ ...lineDraft, item })} />
              {selectedItem && <div className="hod-article-meta"><Icon name="auto_awesome" size={14} /><span>{selectedMeta.join(' · ')}</span></div>}
            </div>
            <label><span>Quantity</span><input min="0.01" step="0.01" type="number" value={lineDraft.quantity} onChange={(event) => setLineDraft({ ...lineDraft, quantity: event.target.value })} placeholder="0" /></label>
            <label className="span-2"><span>Line note (optional)</span><input value={lineDraft.remarks} onChange={(event) => setLineDraft({ ...lineDraft, remarks: event.target.value })} placeholder="Usage or specification note" /></label>
            <button type="button" className="erp-primary hod-add-line-button" disabled={busy || !lineDraft.item || num(lineDraft.quantity) <= 0} onClick={saveLine}><Icon name={lineDraft.id ? 'save' : 'add'} size={16} color="#fff" /> {lineDraft.id ? 'Update Article' : 'Add Article'}</button>
          </div>
        </div>
      </section>

      <div className="hod-editor-submit">
        <button type="button" className="erp-secondary danger-text hod-delete-draft" disabled={busy} onClick={deleteDraft}><Icon name="delete" size={15} /> Delete draft</button>
        <div className={`hod-submit-readiness${canSubmit ? ' ready' : ''}`}><Icon name={canSubmit ? 'check_circle' : 'info'} size={16} /><span>{canSubmit ? 'Ready to send directly to the Store Keeper.' : 'Choose an issuing store and add at least one Article.'}</span></div>
        <button type="button" className="erp-secondary hod-save-draft" disabled={busy} onClick={saveDraft}><Icon name="save" size={15} /> Save draft</button>
        <button type="button" className="erp-primary hod-submit-stores" disabled={busy || !canSubmit} onClick={submitDraft}><Icon name="send" size={16} color="#fff" /> Submit to Stores</button>
      </div>
    </div>
  )
}

function ArticlePicker({ items, categories, value, onChange }: { items: Row[]; categories: Row[]; value: string; onChange: (value: string) => void }) {
  const selectedItem = items.find((row) => id(row.id) === value)
  const [query, setQuery] = useState(() => selectedItem ? articlePickerLabel(selectedItem) : '')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setQuery(selectedItem ? articlePickerLabel(selectedItem) : '')
  }, [selectedItem])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const source = needle && selectedItem && query === articlePickerLabel(selectedItem) ? items : items.filter((item) => {
      const category = categories.find((row) => id(row.id) === id(item.category))
      const parent = categories.find((row) => id(row.id) === id(category?.parent))
      return [item.name, item.sku, category?.name, parent?.name].map(id).join(' ').toLowerCase().includes(needle)
    })
    return source.slice(0, 30)
  }, [categories, items, query, selectedItem])

  return <div className="hod-article-picker">
    <Icon name="search" size={17} />
    <input value={query} placeholder="Search Article name or code" autoComplete="off" aria-label="Search Article" aria-expanded={open}
      onFocus={() => setOpen(true)}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      onChange={(event) => { setQuery(event.target.value); if (value) onChange(''); setOpen(true) }}
    />
    {value && <button type="button" className="hod-article-clear" aria-label="Clear selected Article" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(''); setQuery(''); setOpen(true) }}><Icon name="close" size={15} /></button>}
    {open && <div className="hod-article-options" role="listbox">
      {matches.map((item) => {
        const category = categories.find((row) => id(row.id) === id(item.category))
        const parent = categories.find((row) => id(row.id) === id(category?.parent))
        return <button type="button" key={id(item.id)} role="option" aria-selected={id(item.id) === value}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { onChange(id(item.id)); setQuery(articlePickerLabel(item)); setOpen(false) }}
        >
          <span><strong>{id(item.name)}</strong><small>{[id(parent?.name), id(category?.name)].filter(Boolean).join(' · ') || 'Article'}</small></span>
          <em>{id(item.sku) || 'No code'}</em>
        </button>
      })}
      {!matches.length && <div className="hod-article-no-results"><Icon name="search_off" size={18} /><span>No matching Article</span></div>}
    </div>}
  </div>
}

function articlePickerLabel(item: Row) {
  return id(item.sku) ? `${id(item.name)} · ${id(item.sku)}` : id(item.name)
}

function RequestDetails({ request, lines, data }: { request: Row; lines: Row[]; data: WorkspaceData }) {
  return (
    <div className="hod-record-detail">
      <section className="hod-detail-summary-grid">
        <Info label="Department" value={id(request.department_name) || 'Your department'} />
        <Info label="Issuing store" value={id(request.store_name) || '—'} />
        <Info label="Required date" value={formatDate(request.required_date)} />
        <Info label="Current stage" value={friendlyStatus(request.status)} />
      </section>
      {request.purpose && <section className="hod-purpose-card"><span>Purpose</span><p>{id(request.purpose)}</p></section>}
      <section className="hod-record-section">
        <div className="hod-section-heading"><div><strong>Articles & quantity trail</strong><span>Quantities can only stay the same or reduce as the requisition progresses.</span></div></div>
        <div className="hod-audit-lines">
          {lines.map((line) => <div key={id(line.id)} className="hod-audit-line">
            <div className="hod-line-copy"><strong>{id(line.item_name) || itemName(data, line.item)}</strong><span>{id(line.category_name) || 'Article'} · {unitName(data, line.unit)}</span></div>
            <QuantityTrail label="Requested" value={line.quantity_requested} />
            <QuantityTrail label="HOD" value={line.hod_approved_quantity ?? line.base_quantity_requested} />
            <QuantityTrail label="Stores" value={line.quantity_approved} />
            <QuantityTrail label="Issued" value={line.quantity_issued} />
          </div>)}
          {!lines.length && <div className="hod-line-empty">No Articles recorded.</div>}
        </div>
      </section>
      <Progress status={id(request.status)} />
    </div>
  )
}

function LegacyApproval({
  request, lines, data, quantities, reasons, comment, rejectReason, busy,
  setQuantities, setReasons, setComment, setRejectReason, approve, reject,
}: {
  request: Row
  lines: Row[]
  data: WorkspaceData
  quantities: Record<string, string>
  reasons: Record<string, string>
  comment: string
  rejectReason: string
  busy: boolean
  setQuantities: (value: Record<string, string>) => void
  setReasons: (value: Record<string, string>) => void
  setComment: (value: string) => void
  setRejectReason: (value: string) => void
  approve: () => void
  reject: () => void
}) {
  return (
    <div className="hod-legacy-approval">
      <div className="hod-legacy-note"><Icon name="history" size={18} /><div><strong>Legacy requester record</strong><span>This request was created before the Requester role was retired. Complete this decision once; new requisitions are created by the Department Head directly.</span></div></div>
      <section className="hod-purpose-card"><span>Purpose</span><p>{id(request.purpose) || 'No purpose recorded.'}</p></section>
      <section className="hod-record-section">
        <div className="hod-section-heading"><div><strong>Review Articles</strong><span>You may keep or reduce the original quantity. You cannot increase it.</span></div></div>
        <div className="hod-legacy-lines">
          {lines.map((line) => {
            const lineId = id(line.id)
            const max = num(line.base_quantity_requested || line.quantity_requested)
            const current = num(quantities[lineId])
            return <div className="hod-legacy-line" key={lineId}>
              <div className="hod-line-copy"><strong>{id(line.item_name) || itemName(data, line.item)}</strong><span>Requested: {formatQty(max)} {unitAbbr(data, line.unit)}</span></div>
              <label><span>Approved quantity</span><input type="number" min="0" max={max} step="0.01" value={quantities[lineId] ?? ''} onChange={(event) => setQuantities({ ...quantities, [lineId]: event.target.value })} /></label>
              {current === 0 && <label className="span-2"><span>Line rejection reason</span><input value={reasons[lineId] || ''} onChange={(event) => setReasons({ ...reasons, [lineId]: event.target.value })} placeholder="Required when approving zero" /></label>}
            </div>
          })}
        </div>
      </section>
      <label className="hod-block-field"><span>Approval comment (optional)</span><textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
      <div className="hod-legacy-actions"><button type="button" className="erp-primary" disabled={busy || !lines.length} onClick={approve}><Icon name="check" size={16} color="#fff" /> Approve & send to Stores</button></div>
      <div className="hod-legacy-reject"><label><span>Reject entire requisition</span><textarea rows={2} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Reason required" /></label><button type="button" className="erp-secondary danger-text" disabled={busy || !rejectReason.trim()} onClick={reject}>Reject requisition</button></div>
    </div>
  )
}

function Progress({ status }: { status: string }) {
  const state = key(status)
  const steps = [
    ['submitted', 'Stores'],
    ['awaiting_procurement', 'Procurement'],
    ['completed', 'Completed'],
  ]
  const rank: Record<string, number> = {
    draft: 0, rejected: 0, pending_department_approval: 0,
    submitted: 1, approved: 1, partially_approved: 1, partially_issued: 1,
    awaiting_procurement: 2, issued: 3, completed: 3,
  }
  const current = rank[state] ?? 0
  return <section className="hod-progress-card"><div className="hod-section-heading"><div><strong>Workflow progress</strong><span>The page follows the same record from department request to completion.</span></div></div><div className="hod-progress-steps"><span className="done"><Icon name="edit_note" size={16} /><b>Department Head</b></span>{steps.map(([value, label], index) => <span key={value} className={current >= index + 1 ? 'done' : ''}><Icon name={current >= index + 1 ? 'check_circle' : 'radio_button_unchecked'} size={16} /><b>{label}</b></span>)}</div></section>
}

function Kpi({ icon, label, value }: { icon: string; label: string; value: number }) {
  return <div className="hod-kpi-card"><span><Icon name={icon} size={18} /></span><div><strong>{value}</strong><small>{label}</small></div></div>
}

function FlowStep({ icon, label, detail, active = false }: { icon: string; label: string; detail: string; active?: boolean }) {
  return <div className={`hod-flow-step${active ? ' active' : ''}`}><span><Icon name={icon} size={17} /></span><div><strong>{label}</strong><small>{detail}</small></div></div>
}
function FlowArrow() { return <Icon name="arrow_forward" size={16} /> }
function Info({ label, value }: { label: string; value: string }) { return <div className="hod-info-box"><span>{label}</span><strong>{value || '—'}</strong></div> }
function QuantityTrail({ label, value }: { label: string; value: unknown }) { return <div className="hod-quantity-trail"><span>{label}</span><strong>{formatQty(value)}</strong></div> }

function StatusBadge({ status }: { status: string }) {
  const state = key(status)
  const tone = ['completed', 'issued', 'approved'].includes(state) ? 'good'
    : ['rejected', 'cancelled'].includes(state) ? 'bad'
      : ['submitted', 'awaiting_procurement', 'pending_department_approval'].includes(state) ? 'warn'
        : 'neutral'
  return <span className={`hod-status ${tone}`}>{friendlyStatus(state)}</span>
}

function ListSkeleton() {
  return <div className="hod-list-skeleton" role="status"><span /><span /><span /><span /><small className="sr-only">Loading requisitions…</small></div>
}

function friendlyStatus(value: unknown) {
  const state = key(value)
  const map: Record<string, string> = {
    draft: 'Draft', pending_department_approval: 'Legacy HOD approval', submitted: 'At Stores',
    approved: 'Stores approved', partially_approved: 'Partially approved', partially_issued: 'Partially issued',
    awaiting_procurement: 'At Procurement', issued: 'Issued', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled',
  }
  return map[state] || state.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Unknown'
}
function formatDate(value: unknown) {
  if (!value) return '—'
  const date = new Date(id(value))
  if (Number.isNaN(date.getTime())) return id(value)
  return new Intl.DateTimeFormat('en-UG', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}
function formatDateTime(value: unknown) {
  if (!value) return '—'
  const date = new Date(id(value))
  if (Number.isNaN(date.getTime())) return id(value)
  return new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
function formatQty(value: unknown) {
  const valueNumber = num(value)
  return Number.isInteger(valueNumber) ? String(valueNumber) : valueNumber.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
function itemName(data: WorkspaceData, value: unknown) { return id(data.items.find((row) => id(row.id) === id(value))?.name) || 'Article' }
function unitName(data: WorkspaceData, value: unknown) { const unit = data.units.find((row) => id(row.id) === id(value)); return id(unit?.name || unit?.abbreviation) || 'Base unit' }
function unitAbbr(data: WorkspaceData, value: unknown) { const unit = data.units.find((row) => id(row.id) === id(value)); return id(unit?.abbreviation || unit?.name) }
