import { operationalStatus, signalStyle } from '../lib/operationalSignals'
import { useMemo, useState, type ReactNode } from 'react'
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
  type ColumnDef, type PaginationState, type RowSelectionState, type SortingState,
} from '@tanstack/react-table'
import { Icon } from './Icon'

export type EnterpriseColumn<T extends { id?: string }> = {
  id: string
  label: string
  value: (record: T) => string | number | null | undefined
  render?: (record: T) => ReactNode
  numeric?: boolean
  sortable?: boolean
  width?: string
}

export default function EnterpriseTable<T extends { id?: string }>({
  rows, columns, onOpen, onSelectionChange, emptyText = 'No records match this selection.',
  emptyTitle = 'No records found', emptyActionLabel, onEmptyAction,
  label, pageSize = 25, actions,
}: {
  rows: T[]
  columns: EnterpriseColumn<T>[]
  onOpen?: (row: T) => void
  onSelectionChange?: (rows: T[]) => void
  emptyText?: string
  emptyTitle?: string
  emptyActionLabel?: string
  onEmptyAction?: () => void
  label: string
  pageSize?: number
  actions?: ReactNode
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const statusColumn = columns.find(column => /^(status|posting_status|fulfillment_status|payment_status|receipt_status|approval_status)$/.test(column.id))
  const statusOptions = useMemo(() => statusColumn ? Array.from(new Set(rows.map(row => operationalStatus(statusColumn.value(row)).label))).sort() : [], [rows, statusColumn])
  const activeStatus = !onSelectionChange && statusOptions.includes(statusFilter) ? statusFilter : ''
  const visibleRows = useMemo(() => activeStatus && statusColumn ? rows.filter(row => operationalStatus(statusColumn.value(row)).label === activeStatus) : rows, [rows, activeStatus, statusColumn])
  const [selection, setSelection] = useState<RowSelectionState>({})
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize })
  const definitions = useMemo<ColumnDef<T>[]>(() => [
    ...(onSelectionChange ? [{
      id: '_select', header: ({ table }) => <input aria-label="Select all visible rows" type="checkbox"
        checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} />,
      cell: ({ row }) => <input aria-label={'Select row ' + row.id} type="checkbox"
        checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />,
      enableSorting: false,
      enableGlobalFilter: false,
    } satisfies ColumnDef<T>] : []),
    ...columns.map((column): ColumnDef<T> => ({
      id: column.id,
      accessorFn: column.value,
      header: column.label,
      cell: ({ row, getValue }) => column.render
        ? column.render(row.original)
        : /^(status|posting_status|fulfillment_status|payment_status|receipt_status|approval_status)$/.test(column.id)
          ? <span style={signalStyle(operationalStatus(getValue()).tone)}>{operationalStatus(getValue()).label}</span>
          : String(getValue() ?? '—'),
      enableSorting: column.sortable !== false,
    })),
  ], [columns, onSelectionChange])
  const table = useReactTable({
    data: visibleRows, columns: definitions,
    getRowId: (row, index) => String(row.id || index),
    state: { sorting, globalFilter: search, rowSelection: selection, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    onPaginationChange: setPagination,
    onRowSelectionChange: (change) => {
      setSelection((old) => {
        const next = typeof change === 'function' ? change(old) : change
        if (onSelectionChange) onSelectionChange(rows.filter((row, index) => next[String(row.id || index)]))
        return next
      })
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: 'includesString',
    autoResetPageIndex: true,
  })

  return <section className="mc-dense-panel" aria-label={label}>
    <div className="mc-dense-toolbar tw:flex tw:items-center tw:justify-between tw:gap-3 tw:flex-wrap">
      <div style={{display:'flex',alignItems:'center',gap:6}}><div className="mc-search-wrap"><Icon name="search" size={15}/><input
        aria-label={'Search ' + label} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)}
        onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();setSearch(searchDraft);setPagination(current=>({...current,pageIndex:0}))}}}
        placeholder={'Find ' + label.toLowerCase() + '…'} /></div>
        <button type="button" className="mc-action" onClick={()=>{setSearch(searchDraft);setPagination(current=>({...current,pageIndex:0}))}}>Search</button>
        {(search || searchDraft) && <button type="button" className="mc-action" onClick={()=>{setSearch('');setSearchDraft('');setPagination(current=>({...current,pageIndex:0}))}}>Clear</button>}
      </div>
      <div className="mc-toolbar-end">{!onSelectionChange && statusOptions.length > 1 && <label style={{display:'inline-flex',alignItems:'center',gap:6}}>Status <select aria-label={'Filter ' + label + ' by status'} value={activeStatus} onChange={event=>{setStatusFilter(event.target.value);setPagination(current=>({...current,pageIndex:0}))}}><option value="">All statuses</option>{statusOptions.map(status=><option key={status} value={status}>{status}</option>)}</select></label>}{actions}<span className="mc-count">{table.getFilteredRowModel().rows.length.toLocaleString()} records</span>
        {onOpen && <span className="mc-key-hint">↑ ↓ Navigate · Enter Open</span>}</div>
    </div>
    <div className="mc-dense-scroll"><table className="mc-dense-table">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th
        key={header.id} scope="col" style={columns.find((col) => col.id === header.column.id)?.width
          ? { width: columns.find((col) => col.id === header.column.id)?.width } : undefined}
        aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}>
        {header.column.getCanSort() ? <button type="button" onClick={header.column.getToggleSortingHandler()}
          className="mc-sort-head">{flexRender(header.column.columnDef.header, header.getContext())}
          {header.column.getIsSorted() ? <Icon name={header.column.getIsSorted() === 'asc' ? 'arrow_upward' : 'arrow_downward'} size={12} /> : null}
        </button> : flexRender(header.column.columnDef.header, header.getContext())}
      </th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className={row.getIsSelected() ? 'mc-row-selected' : ''}
        tabIndex={onOpen ? 0 : -1}
        onClick={(event) => { if (onOpen && !(event.target as HTMLElement).closest('button,input,select,a')) onOpen(row.original) }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' && onOpen) { event.preventDefault(); onOpen(row.original) }
          if (onOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            const sibling = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling
            if (sibling instanceof HTMLElement) sibling.focus()
          }
        }}>
        {row.getVisibleCells().map((cell) => <td key={cell.id} className={columns.find((col) => col.id === cell.column.id)?.numeric ? 'mc-num' : ''}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>)}
      </tr>)}
      {!table.getRowModel().rows.length && <tr><td colSpan={definitions.length}><div className="mc-no-records">
        <span className="mc-empty-icon"><Icon name={search ? 'search_off' : 'inbox'} size={22} /></span>
        <strong>{search || activeStatus ? 'No matching records' : emptyTitle}</strong>
        <p>{search || activeStatus ? 'Try another search term or clear the current filters.' : emptyText}</p>
        {(search || activeStatus || onEmptyAction) && <button type="button" className="mc-action mc-action-primary" onClick={() => {
          if (search || activeStatus) { setSearch(''); setSearchDraft(''); setStatusFilter(''); setPagination((current) => ({ ...current, pageIndex: 0 })) }
          else onEmptyAction?.()
        }}>{search || activeStatus ? 'Clear filters' : emptyActionLabel || 'Refresh records'}</button>}
      </div></td></tr>}
      </tbody>
    </table></div>
    <footer className="mc-table-footer">
      <span>Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}</span>
      <div className="mc-toolbar-end">
        <label>Rows <select aria-label="Rows per page" value={pagination.pageSize} onChange={event => table.setPageSize(Number(event.target.value))}>
          {[10, 25, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page"><Icon name="chevron_left" size={17}/></button>
        <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page"><Icon name="chevron_right" size={17}/></button>
      </div>
    </footer>
  </section>
}
