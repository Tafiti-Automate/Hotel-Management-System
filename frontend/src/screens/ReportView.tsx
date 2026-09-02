import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import RecordDetailDrawer from '../components/RecordDetailDrawer'
import { canViewReport } from '../lib/access'
import { errorMessage, fetchOperationalReport, isOperationalReport } from '../lib/api'
import { reports, type EntityKey } from '../lib/data'
import { buildOperationalReport, buildReport } from '../lib/reports'
import { useApp } from '../state/AppContext'

const exportBtn: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 14px', border: '1px solid var(--border)',
  cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', borderRadius: 10, font: 'inherit',
  fontSize: 12.5, fontWeight: 700,
}

const filterChip: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 11px', border: '1px solid var(--border)',
  borderRadius: 9, background: 'var(--surface-2)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
}

function reportScope(role: string, branch: string) {
  const key = role.trim().toLowerCase()
  if (key === 'requester') return 'My requests'
  if (key === 'department head') return `My department${branch ? ` · ${branch}` : ''}`
  if (key === 'store keeper') return `Assigned stores${branch ? ` · ${branch}` : ''}`
  if (key === 'cost controller') return `Procurement controls${branch ? ` · ${branch}` : ''}`
  if (key === 'system administrator') return branch || 'Permitted properties'
  return branch || 'Current property'
}

function safeFilename(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report'
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10)
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
  const authorized = Boolean(app.reportId && canViewReport(app.user, reportId))
  const reportDefinition = reports.find((entry) => entry.id === reportId)
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
    if (!authorized || !operationalReportId) return
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
  }, [actionType, authorized, branchId, category, dateFrom, dateTo, department, documentType, employee, item, operationalReportId, refreshKey, reportId, reportStatus, store, supplier, valueMin])

  const report = operationalReportId
    ? buildOperationalReport(operationalReportId, livePayload)
    : buildReport(reportId, filteredData)
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(report.rows.length / pageSize))
  const visibleRows = report.rows.slice((page - 1) * pageSize, page * pageSize)
  const controlReport = ['dailyActivities', 'pendingActions', 'exceptions', 'userActivity', 'stockMovementControl', 'approvalTrail', 'directWorkspace', 'supplierPriceChanges', 'managementSummary'].includes(reportId)
  const storeReports = ['departmentRequests', 'storeIssues', 'purchaseOrders', 'goodsReceipts', 'valuation', 'lowstock', 'movement', 'aging', 'consumption', 'stockMovementControl']
  const categoryReports = ['valuation', 'lowstock', 'aging', 'consumption', 'stockMovementControl', 'supplierPriceChanges']
  const dateReports = ['departmentRequests', 'storeIssues', 'purchaseRequisitions', 'purchaseOrders', 'goodsReceipts', 'movement', 'aging', 'procurement', 'consumption', 'dailyActivities', 'pendingActions', 'exceptions', 'userActivity', 'stockMovementControl', 'approvalTrail', 'directWorkspace', 'supplierPriceChanges']
  const itemReports = ['movement', 'consumption', 'stockMovementControl', 'supplierPriceChanges']
  const departmentFilterReports = ['departmentRequests', 'storeIssues', 'purchaseRequisitions', 'purchaseOrders', 'goodsReceipts', 'dailyActivities', 'pendingActions', 'exceptions', 'userActivity', 'approvalTrail', 'directWorkspace']
  const employeeFilterReports = ['dailyActivities', 'userActivity', 'stockMovementControl', 'approvalTrail', 'supplierPriceChanges']
  const supplierFilterReports = ['purchaseOrders', 'goodsReceipts', 'pendingActions', 'exceptions', 'directWorkspace', 'supplierPriceChanges']
  const statusFilterReports = ['departmentRequests', 'purchaseRequisitions', 'purchaseOrders', 'goodsReceipts', 'dailyActivities', 'pendingActions', 'exceptions', 'userActivity', 'stockMovementControl', 'approvalTrail', 'directWorkspace', 'supplierPriceChanges']
  const documentFilterReports = ['dailyActivities', 'pendingActions', 'exceptions', 'userActivity', 'stockMovementControl', 'approvalTrail', 'directWorkspace', 'supplierPriceChanges']
  const supportsStore = storeReports.includes(reportId)
  const supportsCategory = categoryReports.includes(reportId)
  const supportsDates = dateReports.includes(reportId)
  const supportsItem = itemReports.includes(reportId)
  const supportsDepartment = departmentFilterReports.includes(reportId)
  const supportsEmployee = employeeFilterReports.includes(reportId)
  const supportsSupplier = supplierFilterReports.includes(reportId)
  const supportsStatus = statusFilterReports.includes(reportId)
  const supportsDocumentFilters = documentFilterReports.includes(reportId)
  const supportsValueMinimum = controlReport && reportId !== 'managementSummary'
  const controlRows = Array.isArray(livePayload.results) ? livePayload.results as Record<string, any>[] : []
  const controlValues = (key: string) => Array.from(new Set(controlRows.map((row) => String(row[key] || '')).filter(Boolean))).sort()
  const needsItem = reportId === 'movement' && !item
  const emptyMessage = needsItem
    ? 'Choose an article to generate its stock card.'
    : liveError
      ? liveError
      : 'No records match the selected criteria.'
  const scope = reportScope(app.user.role, app.currentBranch)
  const generatedAt = new Date()
  const baseFilename = `${safeFilename(report.title)}-${dateStamp()}`

  const exportCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const csv = [report.columns.map((column) => quote(column.label)).join(','), ...report.rows.map((row) => row.cells.map((cell) => quote(cell.text)).join(','))].join('\n')
    download(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }), `${baseFilename}.csv`)
  }

  const exportExcel = () => {
    const escape = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const metadataRows = [
      ['Report', report.title],
      ['Prepared for', `${app.user.name} · ${app.user.role}`],
      ['Scope', scope],
      ['Generated', generatedAt.toLocaleString()],
      [],
    ]
    const tableRows = [...metadataRows, report.columns.map((column) => column.label), ...report.rows.map((row) => row.cells.map((cell) => cell.text))]
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>${tableRows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escape(cell)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`
    download(new Blob([xml], { type: 'application/vnd.ms-excel' }), `${baseFilename}.xls`)
  }

  const exportPdf = () => {
    const popup = window.open('', '_blank', 'width=1100,height=760')
    if (!popup) { app.showWorkflowAlert('PDF export blocked', 'Allow pop-ups for this site, then try again.', 'warning'); return }
    const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const head = report.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')
    const body = report.rows.map((row) => `<tr>${row.cells.map((cell) => `<td>${escapeHtml(cell.text)}</td>`).join('')}</tr>`).join('')
    const criteria = [
      dateFrom ? `From ${dateFrom}` : '',
      dateTo ? `To ${dateTo}` : '',
      selectedStoreName ? `Store: ${selectedStoreName}` : '',
      selectedCategoryName ? `Category: ${selectedCategoryName}` : '',
    ].filter(Boolean).join(' · ') || 'Current report scope'
    const controlledNote = reportId === 'purchaseOrders'
      ? '<div class="notice"><strong>Controlled LPO copies:</strong> The register records the controlled-copy position of each LPO. Printing or downloading an individual LPO continues to issue <strong>ORIGINAL COPY</strong> first and <strong>COPY OF ORIGINAL</strong> thereafter.</div>'
      : ''
    popup.document.write(`<html><head><title>${escapeHtml(report.title)}</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#111827;font-family:Arial,sans-serif;font-size:8.5pt}header{display:flex;justify-content:space-between;gap:24px;padding-bottom:10px;border-bottom:2px solid #111827}h1{margin:0;font-size:17pt;letter-spacing:-.2px}p{margin:4px 0 0;color:#4b5563}.meta{text-align:right;color:#4b5563;font-size:7.8pt;line-height:1.5}.criteria{margin:10px 0;color:#374151;font-size:8pt}.notice{margin:0 0 10px;padding:7px 9px;border:1px solid #d1d5db;background:#f9fafb;font-size:7.8pt;line-height:1.4}table{border-collapse:collapse;width:100%;table-layout:auto}tr{break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:left;vertical-align:top;word-break:break-word}th{background:#f3f4f6;text-transform:uppercase;font-size:7pt;letter-spacing:.2px}footer{margin-top:10px;padding-top:6px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:7pt;display:flex;justify-content:space-between}.internal{font-weight:700;color:#374151}</style></head><body><header><div><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(report.subtitle)}</p></div><div class="meta"><strong>${escapeHtml(app.currentBranch || 'Hotel Management System')}</strong><br>Prepared for ${escapeHtml(app.user.name)} · ${escapeHtml(app.user.role)}<br>${escapeHtml(generatedAt.toLocaleString())}</div></header><div class="criteria"><strong>Scope:</strong> ${escapeHtml(scope)} · <strong>Criteria:</strong> ${escapeHtml(criteria)} · <strong>Records:</strong> ${report.rows.length}</div>${controlledNote}<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${report.columns.length}">No records match the selected criteria.</td></tr>`}</tbody></table><footer><span class="internal">Internal report</span><span>${escapeHtml(report.title)} · Generated by Hotel Management System</span></footer><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }

  const drillIntoSource = () => {
    if (!selectedReportRow) return
    const type = String(selectedReportRow.drilldown_type || '')
    const sourceId = String(selectedReportRow.drilldown_id || '')
    if (!sourceId) return
    const entities: Record<string, EntityKey> = {
      requisitions: 'requisitions',
      orders: 'orders',
      grns: 'grns',
      inspections: 'inspections',
      supplierItems: 'supplierItems',
      'store-requisitions': 'storeRequisitions',
      stock_issue: 'stockIssues',
      store_return: 'storeReturns',
      supplier_return: 'supplierReturns',
      goods_receipt: 'grns',
    }
    const entity = entities[type]
    if (entity) app.openDetail(entity, sourceId, 'reports')
  }

  if (!app.reportId) return null

  if (!authorized) {
    return (
      <div className="enterprise-workspace report-view-screen">
        <button onClick={app.backFromReport} className="hover-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0', marginBottom: 14 }}>
          <Icon name="arrow_back" size={19} />All reports
        </button>
        <div style={{ maxWidth: 620, padding: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', marginBottom: 12 }}><Icon name="lock" size={21} color="var(--text-muted)" /></div>
          <h2 style={{ margin: 0, fontSize: 17, color: 'var(--text)' }}>Report access restricted</h2>
          <p style={{ margin: '7px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--text-muted)' }}>This report is outside the reporting scope assigned to your role.</p>
        </div>
      </div>
    )
  }

  const canOpenSource = Boolean(selectedReportRow?.drilldown_id && selectedReportRow?.drilldown_type && ['requisitions', 'orders', 'grns', 'inspections', 'supplierItems', 'store-requisitions', 'stock_issue', 'store_return', 'supplier_return', 'goods_receipt'].includes(String(selectedReportRow.drilldown_type)))

  return (
    <div className="enterprise-workspace report-view-screen">
      <button onClick={app.backFromReport} className="hover-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0', marginBottom: 14 }}>
        <Icon name="arrow_back" size={19} />All reports
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--text)' }}>{report.title}</h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{report.subtitle}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 9, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span>{app.user.role}</span><span aria-hidden="true">•</span><span>{scope}</span><span aria-hidden="true">•</span><span>{report.rows.length} record{report.rows.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <button onClick={exportPdf} className="hover-surface2" style={exportBtn}><Icon name="picture_as_pdf" size={17} color="var(--text-muted)" />PDF</button>
          <button onClick={exportExcel} className="hover-surface2" style={exportBtn}><Icon name="table_view" size={17} color="var(--text-muted)" />Excel</button>
          <button onClick={exportCsv} className="hover-surface2" style={exportBtn}><Icon name="download" size={17} color="var(--text-muted)" />CSV</button>
        </div>
      </div>

      {reportDefinition?.controlledDocument === 'lpo' && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', marginBottom: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 12.2, lineHeight: 1.5 }}>
          <Icon name="verified" size={18} color="var(--accent)" />
          <div><strong style={{ color: 'var(--text)' }}>Controlled LPO output.</strong> The register shows the next controlled-copy position. Open an LPO to print or download it; the first controlled output remains <strong>ORIGINAL COPY</strong> and subsequent outputs remain <strong>COPY OF ORIGINAL</strong>.</div>
        </div>
      )}

      {reportDefinition?.controlledDocument === 'grn' && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', marginBottom: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 12.2, lineHeight: 1.5 }}>
          <Icon name="description" size={18} color="var(--accent)" />
          <div><strong style={{ color: 'var(--text)' }}>GRN source document.</strong> Receipt and posting remain separate states. Open the GRN source record for the approved A4 landscape document.</div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '11px 14px', marginBottom: 'var(--gap)', boxShadow: 'var(--shadow-sm)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Filters</span>
        {supportsDates && <><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} style={filterControl} title="From date" /><input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} style={filterControl} title="To date" /></>}
        {supportsStore && <select value={store} onChange={(event) => { setStore(event.target.value); setPage(1) }} style={filterControl}><option value="">All permitted stores</option>{app.data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        {supportsCategory && <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }} style={filterControl}><option value="">All categories</option>{app.data.categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        {supportsItem && <select value={item} onChange={(event) => { setItem(event.target.value); setPage(1) }} style={filterControl}><option value="">{reportId === 'movement' ? 'Choose article…' : 'All articles'}</option>{app.data.items.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        <span style={filterChip}>Scope: {scope}</span>
        {supportsDepartment && <select value={department} onChange={(event) => { setDepartment(event.target.value); setPage(1) }} style={filterControl}><option value="">All permitted departments</option>{app.data.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        {supportsEmployee && <select value={employee} onChange={(event) => { setEmployee(event.target.value); setPage(1) }} style={filterControl}><option value="">All permitted employees</option>{app.data.employees.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        {supportsSupplier && <select value={supplier} onChange={(event) => { setSupplier(event.target.value); setPage(1) }} style={filterControl}><option value="">All suppliers</option>{app.data.suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}
        {supportsDocumentFilters && <select value={documentType} onChange={(event) => { setDocumentType(event.target.value); setPage(1) }} style={filterControl}><option value="">All document types</option>{controlValues('document_type').map((value) => <option key={value} value={value}>{value}</option>)}</select>}
        {supportsDocumentFilters && <select value={actionType} onChange={(event) => { setActionType(event.target.value); setPage(1) }} style={filterControl}><option value="">All actions</option>{controlValues('action').map((value) => <option key={value} value={value}>{value}</option>)}</select>}
        {supportsStatus && <select value={reportStatus} onChange={(event) => { setReportStatus(event.target.value); setPage(1) }} style={filterControl}><option value="">All statuses</option>{controlValues('status').map((value) => <option key={value} value={value}>{value}</option>)}</select>}
        {supportsValueMinimum && <input type="number" min="0" value={valueMin} onChange={(event) => { setValueMin(event.target.value); setPage(1) }} placeholder="Minimum value" style={{ ...filterControl, width: 130 }} />}
        {live && <button onClick={() => setRefreshKey((value) => value + 1)} style={{ ...filterControl, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><Icon name="sync" size={15} />Refresh</button>}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-sm)', overflow: 'auto' }}>
        <div style={{ minWidth: 820 }}>
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
        </div>
        <div style={{ minHeight: 46, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '0 14px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Showing {report.rows.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, report.rows.length)} of {report.rows.length}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} style={pager}>Previous</button><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{page} / {pageCount}</span><button disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} style={pager}>Next</button></div>
        </div>
      </div>
      {selectedReportRow && <RecordDetailDrawer title={report.title} subtitle={String(selectedReportRow.reference || Object.values(selectedReportRow)[0] || 'Report row')} record={selectedReportRow} onClose={() => setSelectedReportRow(null)} actions={canOpenSource ? <button type="button" onClick={drillIntoSource} style={exportBtn}><Icon name="open_in_new" size={17} />{reportId === 'purchaseOrders' ? 'Open controlled LPO' : reportId === 'goodsReceipts' ? 'Open GRN' : 'Open source transaction'}</button> : undefined} />}
    </div>
  )
}

function download(blob: Blob, filename: string) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const filterControl: CSSProperties = { height: 34, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)', padding: '0 9px', font: 'inherit', fontSize: 12 }
const pager: CSSProperties = { height: 30, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', padding: '0 10px', cursor: 'pointer', font: 'inherit', fontSize: 12 }
