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
        : String(getValue() ?? '—'),
      enableSorting: column.sortable !== false,
    })),
  ], [columns, onSelectionChange])
  const table = useReactTable({
    data: rows, columns: definitions,
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
      <div className="mc-search-wrap"><Icon name="search" size={15}/><input
        aria-label={'Search ' + label} value={search} onChange={(event) => setSearch(event.target.value)}
        placeholder={'Find ' + label.toLowerCase() + '…'} /></div>
      <div className="mc-toolbar-end">{actions}<span className="mc-count">{table.getFilteredRowModel().rows.length.toLocaleString()} records</span>
        <span className="mc-key-hint">↑ ↓ Navigate · Enter Open</span></div>
    </div>
    <div className="mc-dense-scroll"><table className="mc-dense-table">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th
        key={header.id} scope="col" style={columns.find((col) => col.id === header.column.id)?.width
          ? { width: columns.find((col) => col.id === header.column.id)?.width } : undefined}
        aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}>
        <button type="button" disabled={!header.column.getCanSort()} onClick={header.column.getToggleSortingHandler()}
          className="mc-sort-head">{flexRender(header.column.columnDef.header, header.getContext())}
          {header.column.getIsSorted() ? <Icon name={header.column.getIsSorted() === 'asc' ? 'arrow_upward' : 'arrow_downward'} size={12} /> : null}
        </button>
      </th>)}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className={row.getIsSelected() ? 'mc-row-selected' : ''}
        tabIndex={onOpen ? 0 : -1}
        onClick={(event) => { if (onOpen && !(event.target as HTMLElement).closest('button,input,select,a')) onOpen(row.original) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onOpen) { event.preventDefault(); onOpen(row.original) }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
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
        <strong>{search ? 'No matching records' : emptyTitle}</strong>
        <p>{search ? 'Try another search term or clear the current search.' : emptyText}</p>
        {(search || onEmptyAction) && <button type="button" className="mc-action mc-action-primary" onClick={() => {
          if (search) { setSearch(''); setPagination((current) => ({ ...current, pageIndex: 0 })) }
          else onEmptyAction?.()
        }}>{search ? 'Clear search' : emptyActionLabel || 'Refresh records'}</button>}
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
