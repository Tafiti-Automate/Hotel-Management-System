import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import RecordDetailDrawer from '../components/RecordDetailDrawer'
import { cfg, type ColumnDef, type EntityKey, type Row } from '../lib/data'
import { chipStyleFor, money } from '../lib/theme'
import { helpText } from '../lib/help'
import { downloadProcurementAttachment, errorMessage, fetchSupplierPriceHistory, importSupplierCatalogue, readBackendRecords, runBackendAction, uploadProcurementAttachment } from '../lib/api'

function valueFor(column: ColumnDef, row: Row) {
  const value = row[column.key]
  if (column.kind === 'money' || column.kind === 'money2') return money(value)
  if (column.kind === 'rating') return `★ ${value ?? '—'}`
  return String(value ?? '—')
}

function cellStyle(column: ColumnDef): CSSProperties {
  const numeric = ['num', 'money', 'money2'].includes(column.kind)
  return {
    padding: '13px 12px', minWidth: 0, display: 'flex', alignItems: 'center',
    justifyContent: column.align === 'right' ? 'flex-end' : undefined,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: column.kind === 'bold' || numeric ? 'var(--text)' : 'var(--text-muted)',
    fontSize: column.kind === 'mono' ? 12 : 13,
    fontWeight: column.kind === 'bold' || numeric ? 600 : 450,
    fontFamily: column.kind === 'mono' ? "'JetBrains Mono',monospace" : undefined,
  }
}

export default function ListView() {
  const app = useApp()
  const route = app.route
  const config = cfg[route]
  if (!config) return null

  const source = (route === 'approvals' ? 'requisitions' : route) as EntityKey
  const permissionModel: Partial<Record<EntityKey, string>> = {
    items: 'inventory.item', categories: 'inventory.category', uoms: 'inventory.unitofmeasure', itemUnits: 'inventory.itemunitprice',
    locations: 'inventory.storelocation', suppliers: 'vendors.supplier',
    supplierItems: 'inventory.supplieritemprice', departments: 'departments.department',
    employees: 'employees.employee', requisitions: 'procurement.purchaserequisition',
    reorderRules: 'inventory.reorderrule', storeRequisitions: 'inventory.storerequisition',
  }
  const permissionName = permissionModel[source]
  const hasPermissionMetadata = app.user.permissions.length > 0
  const role = String(app.user.role || '').trim().toLowerCase()
  const storeKeeperCannotCreateDepartmentRequest = role === 'store keeper' && source === 'storeRequisitions'
  const canAdd = !storeKeeperCannotCreateDepartmentRequest && (!permissionName || app.user.isSuperuser || app.user.permissions.includes(`${permissionName.split('.')[0]}.add_${permissionName.split('.')[1]}`) || (!hasPermissionMetadata && app.user.isStaff))
  const canChange = !permissionName || app.user.isSuperuser || app.user.permissions.includes(`${permissionName.split('.')[0]}.change_${permissionName.split('.')[1]}`) || (!hasPermissionMetadata && app.user.isStaff)
  const canDelete = !permissionName || app.user.isSuperuser || app.user.permissions.includes(`${permissionName.split('.')[0]}.delete_${permissionName.split('.')[1]}`) || (!hasPermissionMetadata && app.user.isStaff)
  const [sortKey, setSortKey] = useState('')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailRecord, setDetailRecord] = useState<Row | null>(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set())
  const [supplierFilter, setSupplierFilter] = useState('')
  const [articleFilter, setArticleFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [importing, setImporting] = useState(false)
  const [quotationAttachments, setQuotationAttachments] = useState<Row[]>([])
  const [uploadingQuotation, setUploadingQuotation] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const quotationInput = useRef<HTMLInputElement>(null)
  let rows = [...(app.data[source] || [])]
  if (route === 'approvals') {
    rows = rows.filter((row) => row.status === 'Pending' && Boolean(row.approvalActionable))
  }
  const term = app.searchTerm.toLowerCase()
  if (term) rows = rows.filter((row) => config.cols.some((column) => String(row[column.key] ?? '').toLowerCase().includes(term)))
  if (statusFilter) rows = rows.filter((row) => String(row.status || '') === statusFilter)
  if (route === 'supplierItems' && supplierFilter) rows = rows.filter((row) => row.supplier === supplierFilter)
  if (route === 'supplierItems' && articleFilter) rows = rows.filter((row) => row.article === articleFilter)
  if (route === 'supplierItems' && categoryFilter) rows = rows.filter((row) => row.category === categoryFilter)
  if (route === 'items' && app.itemCategoryFilter) {
    const categoryIds = new Set([app.itemCategoryFilter.id])
    let foundChild = true
    while (foundChild) {
      foundChild = false
      for (const category of app.data.categories || []) {
        if (categoryIds.has(String(category.parentId || '')) && !categoryIds.has(String(category.id))) {
          categoryIds.add(String(category.id))
          foundChild = true
        }
      }
    }
    rows = rows.filter((row) => categoryIds.has(String(row.categoryId || '')))
  }
  const rowDate = (row: Row) => String(row.date || row.created_at || row.issue_date || row.return_date || row.receipt_date || row.count_date || '').slice(0, 10)
  if (dateFrom) rows = rows.filter((row) => rowDate(row) && rowDate(row) >= dateFrom)
  if (dateTo) rows = rows.filter((row) => rowDate(row) && rowDate(row) <= dateTo)
  if (sortKey) rows.sort((a, b) => {
    const left = a[sortKey]
    const right = b[sortKey]
    const result = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })
    return sortDirection === 'asc' ? result : -result
  })
  if (route === 'categories' && !sortKey) {
    rows.sort((left, right) => String(left.path || left.name).localeCompare(String(right.path || right.name), undefined, { numeric: true }))
  }

  const visibleColumns = config.cols.filter((column) => !hiddenColumns.has(column.key))
  const columns = `36px ${visibleColumns.map((column) => column.w).join(' ')} 96px`
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const statuses = useMemo(() => Array.from(new Set((app.data[source] || []).map((row) => String(row.status || '')).filter(Boolean))).sort(), [app.data, source])
  const unfilteredRows = app.data[source] || []
  const branchLabel = app.currentBranch ? ` for ${app.currentBranch}` : ''
  const emptyMessage = route === 'approvals' && unfilteredRows.length
    ? `There are no requisitions awaiting approval${branchLabel}.`
    : statusFilter
      ? `No records match the selected status${branchLabel}.`
      : `No ${config.title.toLowerCase()} are available${branchLabel}.`
  useEffect(() => { setPage(1); setSelected(new Set()); setDetailRecord(null) }, [route, term, statusFilter, supplierFilter, articleFilter, categoryFilter, dateFrom, dateTo])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const exportRows = (records: Row[]) => {
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const csv = [visibleColumns.map((column) => quote(column.label)).join(','), ...records.map((row) => visibleColumns.map((column) => quote(row[column.key])).join(','))].join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = `${route}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDirection('asc') }
  }
  const openRow = (row: Row) => {
    if (route === 'requisitions' || route === 'approvals') app.openDetail('requisitions', row.id, route)
    else if (route === 'orders') app.openDetail('orders', row.id, 'orders')
    else {
      setDetailRecord(row)
      if (route === 'supplierItems') {
        setQuotationAttachments([])
        void Promise.all([
          fetchSupplierPriceHistory(row.id),
          readBackendRecords(`procurement-attachments?document_type=supplier_catalogue&document_id=${row.id}`),
        ]).then(([history, attachments]) => {
          const summary = history.length
            ? history.map((entry) => `${entry.effective_from}–${entry.effective_to}: ${entry.currency} ${entry.unit_price}${entry.changed_by_name ? ` by ${entry.changed_by_name}` : ''}`).join('\n')
            : 'No previous prices — this is the first recorded price.'
          setDetailRecord((current) => current?.id === row.id ? { ...current, priceHistory: summary, quotationFiles: attachments.map((file) => file.original_name).join(', ') || 'No quotation file attached' } : current)
          setQuotationAttachments(attachments)
        }).catch(() => undefined)
      }
    }
  }
  const catalogueValues = (key: string) => Array.from(new Set((app.data.supplierItems || []).map((row) => String(row[key] || '')).filter(Boolean))).sort()
  const importFile = async (file?: File) => {
    if (!file) return
    setImporting(true)
    try {
      const result = await importSupplierCatalogue(file)
      app.showToast(`Catalogue imported: ${result.created} added, ${result.updated} updated`)
      app.refreshData()
    } catch (error) { app.showWorkflowAlert('Catalogue import failed', errorMessage(error)) }
    finally { setImporting(false); if (importInput.current) importInput.current.value = '' }
  }
  const uploadQuotation = async (file?: File) => {
    if (!file || !detailRecord) return
    setUploadingQuotation(true)
    try {
      await uploadProcurementAttachment('supplier_catalogue', String(detailRecord.id), 'quotation', file)
      const attachments = await readBackendRecords(`procurement-attachments?document_type=supplier_catalogue&document_id=${detailRecord.id}`)
      setQuotationAttachments(attachments)
      setDetailRecord((current) => current ? { ...current, quotationFiles: attachments.map((entry) => entry.original_name).join(', ') } : current)
      app.showToast('Supplier quotation attached to this price quote')
    } catch (error) {
      app.showWorkflowAlert('Quotation upload failed', errorMessage(error))
    } finally {
      setUploadingQuotation(false)
      if (quotationInput.current) quotationInput.current.value = ''
    }
  }

  return (
    <div className="list-view">
      <div className="list-toolbar" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, color: 'var(--text)', fontSize: 24, fontWeight: 650, letterSpacing: '-.025em' }}>{config.title}</h1>
          <p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>{config.sub}</p>
        </div>
        <div className="list-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {route === 'supplierItems' && canAdd && <><input ref={importInput} type="file" accept=".csv,.xlsx" hidden onChange={(event) => void importFile(event.target.files?.[0])} /><button disabled={importing} onClick={() => importInput.current?.click()} style={secondaryAction}><Icon name="upload_file" size={17} />{importing ? 'Importing…' : 'Import Excel / CSV'}</button></>}
          <button onClick={() => exportRows(rows)} style={secondaryAction}><Icon name="download" size={17} />Export CSV</button>
          {config.editable && canAdd && <button onClick={() => app.openCreate()} className="hover-accent" style={primaryAction}><Icon name="add" size={18} color="#fff" />{config.add}</button>}
        </div>
      </div>

      {route === 'categories' && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12 }}><Icon name="account_tree" size={18} color="var(--accent)" /><span><strong style={{ color: 'var(--text)' }}>{app.data.categories.filter((category) => !category.parentId).length} major groups</strong> contain {app.data.categories.filter((category) => category.parentId).length} item groups. Add articles such as Water or Soda from Items and assign them to an item group.</span></div>}

      <div className="table-command-bar" style={{ minHeight: 50, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderBottom: 0, borderRadius: '8px 8px 0 0' }}>
        <div className="list-search" style={{ position: 'relative' }}>
          <Icon name="search" size={18} color="var(--text-faint)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={app.searchTerm} onChange={(event) => app.setSearchTerm(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}`} style={{ width: 280, height: 34, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', padding: '0 11px 0 34px', color: 'var(--text)', fontSize: 12.5, outline: 'none' }} />
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={{ height: 34, border: '1px solid var(--border)', borderRadius: 5, padding: '0 8px', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12 }}><option value="">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
        {route === 'supplierItems' && <>
          <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} style={filterSelect}><option value="">All suppliers</option>{catalogueValues('supplier').map((value) => <option key={value}>{value}</option>)}</select>
          <select value={articleFilter} onChange={(event) => setArticleFilter(event.target.value)} style={filterSelect}><option value="">All articles</option>{catalogueValues('article').map((value) => <option key={value}>{value}</option>)}</select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} style={filterSelect}><option value="">All categories</option>{catalogueValues('category').map((value) => <option key={value}>{value}</option>)}</select>
        </>}
        {route === 'items' && app.itemCategoryFilter && <span style={filterChip}><Icon name="category" size={15} />Category: {app.itemCategoryFilter.name}<button type="button" title="Clear category filter" aria-label="Clear category filter" onClick={app.clearItemCategoryFilter}><Icon name="close" size={14} /></button></span>}
        <label className="date-filter" title="From date"><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label className="date-filter" title="To date"><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        {(statusFilter || supplierFilter || articleFilter || categoryFilter || dateFrom || dateTo || app.searchTerm || app.itemCategoryFilter) && <button onClick={() => { setStatusFilter(''); setSupplierFilter(''); setArticleFilter(''); setCategoryFilter(''); setDateFrom(''); setDateTo(''); app.setSearchTerm(''); app.clearItemCategoryFilter() }} className="hover-surface2" style={commandAction}><Icon name="filter_alt_off" size={17} />Clear</button>}
        <span style={{ flex: 1 }} />
        <button title="Export selected records" disabled={!selected.size} onClick={() => exportRows(rows.filter((row) => selected.has(row.id)))} className="hover-surface2" style={{ ...iconCommand, opacity: selected.size ? 1 : .4 }}><Icon name="download_for_offline" size={19} /></button>
        <div style={{ position: 'relative' }}><button title="Choose columns" onClick={() => setColumnsOpen((open) => !open)} className="hover-surface2" style={iconCommand}><Icon name="view_column" size={18} /></button>{columnsOpen && <div style={{ position: 'absolute', right: 0, top: 36, zIndex: 10, width: 210, padding: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, boxShadow: 'var(--shadow)' }}>{config.cols.map((column) => <label key={column.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 7, fontSize: 12, color: 'var(--text-muted)' }}><input type="checkbox" checked={!hiddenColumns.has(column.key)} onChange={() => setHiddenColumns((current) => { const next = new Set(current); next.has(column.key) ? next.delete(column.key) : next.add(column.key); return next })} />{column.label}</label>)}</div>}</div>
        <button title="Refresh" onClick={app.refreshData} className="hover-surface2" style={iconCommand}><Icon name="refresh" size={18} /></button>
      </div>

      <div className="data-table" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
        <div className="data-head" style={{ display: 'grid', gridTemplateColumns: columns, padding: '0 8px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 2 }}>
          <div style={{ display: 'grid', placeItems: 'center' }}><input type="checkbox" checked={pageRows.length > 0 && pageRows.every((row) => selected.has(row.id))} onChange={(event) => setSelected((current) => { const next = new Set(current); pageRows.forEach((row) => event.target.checked ? next.add(row.id) : next.delete(row.id)); return next })} /></div>
          {visibleColumns.map((column) => <button title={helpText(column.label)} onClick={() => toggleSort(column.key)} key={column.key} style={{ padding: '11px 12px', border: 0, background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 650, letterSpacing: '.045em', textTransform: 'uppercase', display: 'flex', gap: 4, justifyContent: column.align === 'right' ? 'flex-end' : undefined, cursor: 'pointer' }}>{column.label}{helpText(column.label) && <Icon name="info" size={13} color="var(--text-faint)" />}{sortKey === column.key && <Icon name={sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'} size={13} />}</button>)}
          <div />
        </div>

        {pageRows.map((row) => (
          <div key={row.id} onClick={() => openRow(row)} className="data-row hover-surface2" style={{ minHeight: 50, display: 'grid', gridTemplateColumns: columns, alignItems: 'center', padding: '0 8px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
            <div style={{ display: 'grid', placeItems: 'center' }}><input type="checkbox" checked={selected.has(row.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(row.id) : next.delete(row.id); return next })} /></div>
            {visibleColumns.map((column, index) => {
              const value = valueFor(column, row)
              if (route === 'categories' && column.key === 'name') {
                const child = Number(row.level || 0) > 0
                return <div key={column.key} className="data-cell" data-label={column.label} data-primary={index === 0 ? 'true' : undefined} style={{ ...cellStyle(column), paddingLeft: child ? 32 : 12, gap: 8 }}><Icon name={child ? 'subdirectory_arrow_right' : 'folder'} size={17} color={child ? 'var(--text-faint)' : 'var(--accent)'} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span></div>
              }
              if (route === 'categories' && column.key === 'itemsCount') {
                return <div key={column.key} className="data-cell" data-label={column.label} style={cellStyle(column)}><button type="button" title={`View articles in ${row.name}`} onClick={(event) => { event.stopPropagation(); app.viewCategoryItems(row) }} style={countLink}>{value}</button></div>
              }
              return <div key={column.key} className="data-cell" data-label={column.label} data-primary={index === 0 ? 'true' : undefined} style={cellStyle(column)}>{column.kind === 'status' ? <span style={chipStyleFor(value)}>{value}</span> : value}</div>
            })}
            <div className="data-actions" style={{ padding: '8px', display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
              <Icon name="chevron_right" size={18} color="var(--text-faint)" />
              {config.editable && <>
                {canChange &&
                <button onClick={(event) => { event.stopPropagation(); app.openEdit(row.id) }} title="Edit" className="hover-edit" style={iconAction}><Icon name="edit" size={17} /></button>
                }
                {canDelete &&
                <button onClick={(event) => { event.stopPropagation(); app.requestDelete(row.id) }} title="Deactivate or delete" className="hover-del" style={iconAction}><Icon name="delete" size={17} /></button>
                }
              </>}
            </div>
          </div>
        ))}

        {!rows.length && (
          <div style={{ padding: 44, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            {app.apiStatus === 'loading' && 'Loading records…'}
            {app.apiStatus === 'offline' && <>
              <div style={{ color: 'var(--bad)', marginBottom: 10 }}>{app.apiMessage || 'The service is currently unavailable.'}</div>
              <button onClick={app.refreshData} style={secondaryAction}><Icon name="refresh" size={17} />Retry connection</button>
            </>}
            {app.apiStatus === 'live' && (term ? 'No records match the current search.' : emptyMessage)}
            {app.apiStatus === 'idle' && 'Connecting…'}
          </div>
        )}
        <div className="list-footer" style={{ minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 12 }}>
          <span><b style={{ color: 'var(--text)', fontWeight: 600 }}>{rows.length}</b> records · {selected.size} selected</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} style={pager}><Icon name="chevron_left" size={17} /></button><span style={{ padding: '0 7px', color: 'var(--text)', fontWeight: 600 }}>{page} / {pageCount}</span><button disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} style={pager}><Icon name="chevron_right" size={17} /></button></div>
        </div>
      </div>
      {detailRecord && <RecordDetailDrawer
        title={config.singular || config.title}
        subtitle={String(detailRecord.name || detailRecord.id || 'Record details')}
        record={detailRecord}
        preferredKeys={config.cols.map((column) => column.key)}
        labels={{ ...Object.fromEntries(config.cols.map((column) => [column.key, column.label])), priceHistory: 'Previous prices', quotationFiles: 'Supplier quotation files' }}
        onClose={() => setDetailRecord(null)}
        actions={(route === 'categories' || route === 'suppliers' || route === 'balances' || (config.editable && (canChange || canDelete))) ? <>
          {route === 'categories' && <button type="button" onClick={() => app.viewCategoryItems(detailRecord)} style={drawerPrimary}><Icon name="inventory_2" size={17} color="#fff" />View articles ({String(detailRecord.itemsCount || 0)})</button>}
          {route === 'suppliers' && <button type="button" onClick={() => { app.navTo('supplierItems', 'Supplier catalogue'); app.setSearchTerm(String(detailRecord.name || '')) }} style={drawerSecondary}><Icon name="contract" size={17} />View supplied goods</button>}
          {route === 'supplierItems' && canChange && <><input ref={quotationInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" hidden onChange={(event) => void uploadQuotation(event.target.files?.[0])} /><button type="button" disabled={uploadingQuotation} onClick={() => quotationInput.current?.click()} style={drawerSecondary}><Icon name="attach_file" size={17} />{uploadingQuotation ? 'Uploading…' : 'Attach supplier quotation'}</button></>}
          {route === 'supplierItems' && quotationAttachments[0] && <button type="button" onClick={() => void downloadProcurementAttachment(String(quotationAttachments[0].id), String(quotationAttachments[0].original_name))} style={drawerSecondary}><Icon name="download" size={17} />Download latest quotation</button>}
          {route === 'balances' && Number(detailRecord.reservationVariance || 0) !== 0 && (app.user.isSuperuser || ['administrator', 'system administrator', 'store keeper'].includes(app.user.role.toLowerCase())) && <button type="button" onClick={() => { const recordId = String(detailRecord.id); void runBackendAction('inventory-balances', recordId, 'reconcile-reservation').then(() => { setDetailRecord(null); app.refreshData(); app.showToast('Reserved stock reconciled to open approved requests') }).catch((error) => app.showWorkflowAlert('Reservation reconciliation blocked', errorMessage(error))) }} style={drawerPrimary}><Icon name="sync" size={17} color="#fff" />Reconcile reservation</button>}
          {canChange && <button type="button" onClick={() => { const recordId = detailRecord.id; setDetailRecord(null); app.openEdit(recordId) }} style={drawerSecondary}><Icon name="edit" size={17} />Edit record</button>}
          {canDelete && <button type="button" onClick={() => { const recordId = detailRecord.id; setDetailRecord(null); app.requestDelete(recordId) }} style={drawerDanger}><Icon name="delete" size={17} />Deactivate or delete</button>}
        </> : undefined}
      />}
    </div>
  )
}

const primaryAction: CSSProperties = { height: 38, display: 'flex', alignItems: 'center', gap: 7, border: 0, borderRadius: 6, padding: '0 14px', background: 'var(--accent)', color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600 }
const secondaryAction: CSSProperties = { height: 38, display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--border)', borderRadius: 6, padding: '0 12px', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 500 }
const commandAction: CSSProperties = { height: 34, display: 'flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 5, padding: '0 9px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 500 }
const iconCommand: CSSProperties = { width: 32, height: 32, display: 'grid', placeItems: 'center', border: 0, borderRadius: 5, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }
const iconAction: CSSProperties = { width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: 5, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }
const pager: CSSProperties = { width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
const drawerSecondary: CSSProperties = { minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 650 }
const drawerDanger: CSSProperties = { ...drawerSecondary, borderColor: 'rgba(220,38,38,.25)', color: 'var(--bad)' }
const drawerPrimary: CSSProperties = { ...drawerSecondary, borderColor: 'var(--accent)', background: 'var(--accent)', color: '#fff' }
const filterSelect: CSSProperties = { height: 34, maxWidth: 170, border: '1px solid var(--border)', borderRadius: 5, padding: '0 8px', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12 }
const countLink: CSSProperties = { minWidth: 28, minHeight: 28, padding: '0 7px', border: 0, borderRadius: 5, background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer', font: 'inherit', fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 2 }
const filterChip: CSSProperties = { minHeight: 30, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 5px 0 9px', border: '1px solid var(--accent)', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 12.5, fontWeight: 600 }
