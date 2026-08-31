import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import RecordDetailDrawer from '../components/RecordDetailDrawer'
import { errorMessage, fetchOperationalReport, isOperationalReport } from '../lib/api'
import { buildOperationalReport, buildReport } from '../lib/reports'

const exportBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 14px', border: '1px solid var(--border)',
  cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', borderRadius: 10, font: 'inherit',
  fontSize: 12.5, fontWeight: 700,
}

const filterChip: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 11px', border: '1px solid var(--border)',
  borderRadius: 9, background: 'var(--surface-2)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
}

export default function ReportView() {
  const app = useApp()
  const [store, setStore] = useState('')
  const [category, setCategory] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [item, setItem] = useState('')
  const [department, setDepartment] = useState('')
  const [employee, setEmployee] = useState('')
  const [supplier, setSupplier] = useState('')
  const [documentType, setDocumentType] = useState('')
  const [actionType, setActionType] = useState('')
  const [reportStatus, setReportStatus] = useState('')
  const [valueMin, setValueMin] = useState('')
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [livePayload, setLivePayload] = useState<Record<string, unknown>>({})
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError] = useState('')
  const [selectedReportRow, setSelectedReportRow] = useState<Record<string, unknown> | null>(null)
  const reportId = app.reportId || 'valuation'
  const operationalReportId = isOperationalReport(reportId) ? reportId : null
  const live = Boolean(operationalReportId)
  const branchId = String(app.data.branches.find((row) => row.name === app.currentBranch)?.id || '')
  const selectedStoreName = String(app.data.locations.find((row) => String(row.id) === store)?.name || '')
  const selectedCategoryName = String(app.data.categories.find((row) => String(row.id) === category)?.name || '')
  const filteredData = useMemo(() => {
    const next = { ...app.data }
    const inDateRange = (row: Record<string, any>) => {
      const value = String(row.date || row.expiry || row.required_date || '')
      return (!dateFrom || !value || value >= dateFrom) && (!dateTo || !value || value <= dateTo)
    }
    ;(['balances', 'ledgers', 'batches', 'reorderRules'] as const).forEach((key) => {
      next[key] = app.data[key].filter((row) => (!store || row.store === selectedStoreName) && (!category || row.category === selectedCategoryName) && inDateRange(row))
    })
    ;(['requisitions', 'orders', 'grns', 'storeRequisitions', 'stockIssues', 'storeReturns', 'supplierReturns'] as const).forEach((key) => {
      next[key] = app.data[key].filter(inDateRange)
    })
    return next
  }, [app.data, category, dateFrom, dateTo, selectedCategoryName, selectedStoreName, store])

  useEffect(() => {
    setPage(1)
    setLivePayload({})
    setLiveError('')
    setLiveLoading(false)
    setSelectedReportRow(null)
    if (!operationalReportId) return
    if (reportId === 'movement' && !item) return
    let active = true
    setLiveLoading(true)
    void fetchOperationalReport(operationalReportId, {
      branch: branchId,
      store,
      category,
      item,
      dateFrom,
      dateTo,
      department,
      employee,
      supplier,
      documentType,
      actionType,
      status: reportStatus,
      valueMin,
    }).then((payload) => {
      if (active) setLivePayload(payload)
    }).catch((reason) => {
      if (active) setLiveError(errorMessage(reason))
    }).finally(() => {
      if (active) setLiveLoading(false)
    })
    return () => { active = false }
  }, [actionType, branchId, category, dateFrom, dateTo, department, documentType, employee, item, live, operationalReportId, refreshKey, reportId, reportStatus, store, supplier, valueMin])

  const report = operationalReportId
    ? buildOperationalReport(operationalReportId, livePayload)
    : buildReport(reportId, filteredData)
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(report.rows.length / pageSize))
  const visibleRows = report.rows.slice((page - 1) * pageSize, page * pageSize)
  const supportsStore = !live || reportId !== 'procurement'
  const controlReport = ['dailyActivities', 'pendingActions', 'exceptions', 'userActivity', 'stockMovementControl', 'approvalTrail', 'directWorkspace', 'supplierPriceChanges', 'managementSummary'].includes(reportId)
  const supportsCategory = !live || controlReport || ['valuation', 'lowstock', 'aging', 'consumption'].includes(reportId)
  const supportsDates = !live || controlReport || ['movement', 'aging', 'procurement', 'consumption'].includes(reportId)
  const supportsItem = controlReport || ['movement', 'consumption'].includes(reportId)
  const controlRows = Array.isArray(livePayload.results) ? livePayload.results as Record<string, any>[] : []
  const controlValues = (key: string) => Array.from(new Set(controlRows.map((row) => String(row[key] || '')).filter(Boolean))).sort()
  const needsItem = reportId === 'movement' && !item
  const emptyMessage = needsItem
    ? 'Choose an article to generate its stock card.'
    : liveError
      ? liveError
      : 'No records match the selected criteria.'

  const exportCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const csv = [report.columns.map((column) => quote(column.label)).join(','), ...report.rows.map((row) => row.cells.map((cell) => quote(cell.text)).join(','))].join('\n')
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${reportId}.csv`)
  }
  const exportExcel = () => {
    const escape = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const tableRows = [report.columns.map((column) => column.label), ...report.rows.map((row) => row.cells.map((cell) => cell.text))]
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>${tableRows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escape(cell)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`
    download(new Blob([xml], { type: 'application/vnd.ms-excel' }), `${reportId}.xls`)
  }
  const exportPdf = () => {
    const popup = window.open('', '_blank', 'width=1000,height=700')
    if (!popup) { app.showWorkflowAlert('PDF export blocked', 'Allow pop-ups for this site, then try again.', 'warning'); return }
    const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const head = report.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')
    const body = report.rows.map((row) => `<tr>${row.cells.map((cell) => `<td>${escapeHtml(cell.text)}</td>`).join('')}</tr>`).join('')
    const criteria = [
      app.currentBranch ? `Property: ${app.currentBranch}` : 'All properties',
      dateFrom ? `From: ${dateFrom}` : '',
      dateTo ? `To: ${dateTo}` : '',
      store ? `Store: ${store}` : '',
      category ? `Category: ${category}` : '',
    ].filter(Boolean).join(' · ')
    popup.document.write(`<html><head><title>${escapeHtml(report.title)}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#111827;font-family:Arial,sans-serif;font-size:9pt}header{display:flex;justify-content:space-between;gap:24px;padding-bottom:12px;border-bottom:2px solid #111827}h1{margin:0;font-size:18pt}p{margin:5px 0 0;color:#4b5563}.meta{text-align:right;color:#4b5563;font-size:8pt}.criteria{margin:12px 0;color:#374151;font-size:8.5pt}table{border-collapse:collapse;width:100%}tr{break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:6px 7px;text-align:left;vertical-align:top}th{background:#f3f4f6;text-transform:uppercase;font-size:7.5pt}footer{margin-top:12px;padding-top:6px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:7.5pt;text-align:center}</style></head><body><header><div><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(report.subtitle)}</p></div><div class="meta">Generated ${escapeHtml(new Date().toLocaleString())}<br>${report.rows.length} record${report.rows.length === 1 ? '' : 's'}</div></header><div class="criteria">${escapeHtml(criteria)}</div><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${report.columns.length}">No records match the selected criteria.</td></tr>`}</tbody></table><footer>Hotel Management System · ${escapeHtml(report.title)}</footer><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }
  const drillIntoSource = () => {
    if (!selectedReportRow) return
    const type = String(selectedReportRow.drilldown_type || '')
    const sourceId = String(selectedReportRow.drilldown_id || '')
    if (!sourceId) return
    if (type === 'requisitions') app.openDetail('requisitions', sourceId, 'reports')
    else if (type === 'orders') app.openDetail('orders', sourceId, 'reports')
    else {
      const routes: Record<string, string> = {
        grns: 'grns', inspections: 'inspections', supplierItems: 'supplierItems',
        'store-requisitions': 'storeRequisitions', stock_issue: 'stockIssues',
        store_return: 'storeReturns', supplier_return: 'supplierReturns',
        goods_receipt: 'grns', stock_count: 'balances', stock_transfer: 'balances', stock_adjustment: 'balances',
      }
      const route = routes[type] || type
      app.navTo(route, 'Source document')
      app.setSearchTerm(sourceId)
    }
  }
  if (!app.reportId) return null

  return (
    <div>
      <button onClick={app.backFromReport} className="hover-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0', marginBottom: 14 }}>
        <Icon name="arrow_back" size={19} />All reports
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--text)' }}>{report.title}</h1><span style={{ fontSize: 11.5, fontWeight: 800, color: live ? 'var(--good)' : 'var(--text-faint)', background: live ? 'var(--good-soft)' : 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 8px' }}>{live ? 'Live' : 'Snapshot'}</span></div>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{report.subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button onClick={exportPdf} className="hover-surface2" style={exportBtn}><Icon name="picture_as_pdf" size={17} color="var(--text-muted)" />PDF</button>
          <button onClick={exportExcel} className="hover-surface2" style={exportBtn}><Icon name="table_view" size={17} color="var(--text-muted)" />Excel</button>
          <button onClick={exportCsv} className="hover-surface2" style={exportBtn}><Icon name="download" size={17} color="var(--text-muted)" />CSV</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '11px 14px', marginBottom: 'var(--gap)', boxShadow: 'var(--shadow-sm)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Filters</span>
        {supportsDates && <><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} style={filterControl} title="From date" /><input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} style={filterControl} title="To date" /></>}
        {supportsStore && <select value={store} onChange={(event) => { setStore(event.target.value); setPage(1) }} style={filterControl}><option value="">All stores</option>{app.data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        {supportsCategory && <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }} style={filterControl}><option value="">All categories</option>{app.data.categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        {supportsItem && <select value={item} onChange={(event) => { setItem(event.target.value); setPage(1) }} style={filterControl}><option value="">{reportId === 'movement' ? 'Choose article…' : 'All articles'}</option>{app.data.items.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        <span style={filterChip}>Branch: {app.currentBranch || 'All'}</span>
        {controlReport && <>
          <select value={department} onChange={(event) => setDepartment(event.target.value)} style={filterControl}><option value="">All departments</option>{app.data.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
          <select value={employee} onChange={(event) => setEmployee(event.target.value)} style={filterControl}><option value="">All employees</option>{app.data.employees.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
          <select value={supplier} onChange={(event) => setSupplier(event.target.value)} style={filterControl}><option value="">All suppliers</option>{app.data.suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
          <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} style={filterControl}><option value="">All document types</option>{controlValues('document_type').map((value) => <option key={value}>{value}</option>)}</select>
          <select value={actionType} onChange={(event) => setActionType(event.target.value)} style={filterControl}><option value="">All actions</option>{controlValues('action').map((value) => <option key={value}>{value}</option>)}</select>
          <select value={reportStatus} onChange={(event) => setReportStatus(event.target.value)} style={filterControl}><option value="">All statuses</option>{controlValues('status').map((value) => <option key={value}>{value}</option>)}</select>
          <input type="number" min="0" value={valueMin} onChange={(event) => setValueMin(event.target.value)} placeholder="Minimum value" style={{ ...filterControl, width: 130 }} />
        </>}
        {live && <button onClick={() => setRefreshKey((value) => value + 1)} style={{ ...filterControl, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><Icon name="sync" size={15} />Refresh</button>}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: report.grid, borderBottom: '1px solid var(--border)', padding: '0 8px', background: 'var(--surface-2)' }}>
          {report.columns.map((col, i) => <div key={i} style={col.style}>{col.label}</div>)}
        </div>
        {liveLoading && <div style={{ padding: 42, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>Loading report…</div>}
        {!liveLoading && !visibleRows.length && <div style={{ padding: 42, textAlign: 'center', color: liveError ? 'var(--bad)' : 'var(--text-muted)', fontSize: 12.5 }}>{emptyMessage}</div>}
        {!liveLoading && visibleRows.map((row, ri) => (
          <button type="button" onClick={() => setSelectedReportRow(row.data || Object.fromEntries(report.columns.map((column, index) => [column.label, row.cells[index]?.text || '—'])))} key={ri} className="report-record-row hover-surface2" style={{ width: '100%', display: 'grid', gridTemplateColumns: report.grid, border: 0, borderBottom: '1px solid var(--border)', padding: '0 8px', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
            {row.cells.map((cell, ci) => <div key={ci} style={cell.style}>{cell.text}</div>)}
          </button>
        ))}
        {!liveLoading && !liveError && report.hasTotals && report.rows.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: report.grid, padding: '0 8px', background: 'var(--surface-2)' }}>
            {report.totals.map((cell, ci) => <div key={ci} style={cell.style}>{cell.text}</div>)}
          </div>
        )}
        <div style={{ minHeight: 46, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '0 14px' }}><button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} style={pager}>Previous</button><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{page} / {pageCount}</span><button disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} style={pager}>Next</button></div>
      </div>
      {selectedReportRow && <RecordDetailDrawer title={report.title} subtitle={String(selectedReportRow.reference || Object.values(selectedReportRow)[0] || 'Report row')} record={selectedReportRow} onClose={() => setSelectedReportRow(null)} actions={selectedReportRow.drilldown_id ? <button type="button" onClick={drillIntoSource} style={exportBtn}><Icon name="open_in_new" size={17} />Open source transaction</button> : undefined} />}
    </div>
  )
}

function download(blob: Blob, filename: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

const filterControl: CSSProperties = { height: 34, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text)', padding: '0 9px', font: 'inherit', fontSize: 12 }
const pager: CSSProperties = { height: 30, border: '1px solid var(--border)', borderRadius: 5, background: 'var(--surface)', color: 'var(--text-muted)', padding: '0 10px', cursor: 'pointer', font: 'inherit', fontSize: 12 }
