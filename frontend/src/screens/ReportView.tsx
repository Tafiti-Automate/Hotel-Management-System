import { useMemo, useState, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import { buildReport } from '../lib/reports'

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
  const [page, setPage] = useState(1)
  const reportId = app.reportId || 'valuation'
  const filteredData = useMemo(() => {
    const next = { ...app.data }
    const inDateRange = (row: Record<string, any>) => {
      const value = String(row.date || row.expiry || row.required_date || '')
      return (!dateFrom || !value || value >= dateFrom) && (!dateTo || !value || value <= dateTo)
    }
    ;(['balances', 'ledgers', 'batches', 'reorderRules'] as const).forEach((key) => {
      next[key] = app.data[key].filter((row) => (!store || row.store === store) && (!category || row.category === category) && inDateRange(row))
    })
    ;(['requisitions', 'orders', 'grns', 'storeRequisitions', 'stockIssues', 'storeReturns', 'supplierReturns'] as const).forEach((key) => {
      next[key] = app.data[key].filter(inDateRange)
    })
    return next
  }, [app.data, category, dateFrom, dateTo, store])
  const report = buildReport(reportId, filteredData)
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(report.rows.length / pageSize))
  const visibleRows = report.rows.slice((page - 1) * pageSize, page * pageSize)

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
    if (!popup) { app.showWorkflowAlert('PDF export blocked', 'Allow pop-ups for this site, then try again.'); return }
    const head = report.columns.map((column) => `<th>${column.label}</th>`).join('')
    const body = report.rows.map((row) => `<tr>${row.cells.map((cell) => `<td>${cell.text}</td>`).join('')}</tr>`).join('')
    popup.document.write(`<html><head><title>${report.title}</title><style>body{font-family:Arial;padding:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f3f4f6}</style></head><body><h1>${report.title}</h1><p>${report.subtitle}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }
  if (!app.reportId) return null

  return (
    <div>
      <button onClick={app.backFromReport} className="hover-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0', marginBottom: 14 }}>
        <Icon name="arrow_back" size={19} />All reports
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--text)' }}>{report.title}</h1>
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
        <input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} style={filterControl} title="From date" />
        <input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} style={filterControl} title="To date" />
        <select value={store} onChange={(event) => { setStore(event.target.value); setPage(1) }} style={filterControl}><option value="">All stores</option>{app.data.locations.map((row) => <option key={row.id}>{row.name}</option>)}</select>
        <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }} style={filterControl}><option value="">All categories</option>{app.data.categories.map((row) => <option key={row.id}>{row.name}</option>)}</select>
        <span style={filterChip}>Branch: {app.currentBranch || 'All'}</span>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: report.grid, borderBottom: '1px solid var(--border)', padding: '0 8px', background: 'var(--surface-2)' }}>
          {report.columns.map((col, i) => <div key={i} style={col.style}>{col.label}</div>)}
        </div>
        {visibleRows.map((row, ri) => (
          <div key={ri} className="hover-surface2" style={{ display: 'grid', gridTemplateColumns: report.grid, borderBottom: '1px solid var(--border)', padding: '0 8px' }}>
            {row.cells.map((cell, ci) => <div key={ci} style={cell.style}>{cell.text}</div>)}
          </div>
        ))}
        {report.hasTotals && (
          <div style={{ display: 'grid', gridTemplateColumns: report.grid, padding: '0 8px', background: 'var(--surface-2)' }}>
            {report.totals.map((cell, ci) => <div key={ci} style={cell.style}>{cell.text}</div>)}
          </div>
        )}
        <div style={{ minHeight: 46, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '0 14px' }}><button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} style={pager}>Previous</button><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{page} / {pageCount}</span><button disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} style={pager}>Next</button></div>
      </div>
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
const pager: CSSProperties = { height: 30, border: '1px solid var(--border)', borderRadius: 5, background: 'var(--surface)', color: 'var(--text-muted)', padding: '0 10px', cursor: 'pointer', font: 'inherit', fontSize: 11.5 }
