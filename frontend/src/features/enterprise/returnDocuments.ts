/** Read-only printed transaction evidence; never changes stock or approval state. */
type DocumentRow = Record<string, unknown>
const value = (v: unknown) => v === null || v === undefined ? '' : String(v)
const esc = (v: unknown) => value(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const safeCsv = (v: unknown) => {
  const raw = value(v)
  const guarded = /^[\s]*[=+\-@]/.test(raw) ? "'" + raw : raw
  return '"' + guarded.replace(/"/g, '""') + '"'
}
export type ReturnKind = 'department' | 'supplier'

export function printReturnNote(kind: ReturnKind, record: DocumentRow, lines: DocumentRow[],
  items: DocumentRow[], stores: DocumentRow[], targetName: string,
  userName: string): boolean {
  if (!lines.length) return false
  const itemName = new Map(items.map(item => [value(item.id), value(item.name)]))
  const storeName = new Map(stores.map(store => [value(store.id), value(store.name)]))
  const supplier = kind === 'supplier'
  const title = supplier ? 'SUPPLIER RETURN NOTE' : 'DEPARTMENT RETURN NOTE'
  const posted = supplier ? Boolean(record.inventory_changes_applied) : Boolean(record.inventory_changes_applied)
  const rows = lines.map((line, index) => '<tr><td>' + (index + 1) + '</td><td>' +
    esc(itemName.get(value(line.item)) || line.item_name || 'Article unavailable') +
    '</td><td>' + esc(Number(line.base_quantity || line.quantity || 0).toFixed(4)) +
    '</td><td>' + esc(line.condition_note || line.reason || record.reason || '') +
    '</td></tr>').join('')
  const pairs: Array<[string, unknown]> = [
    ['Document number', record.return_no], ['Return date', record.return_date || record.created_at],
    ['Store', storeName.get(value(record.store)) || 'Store unavailable'],
    [supplier ? 'Supplier' : 'Returning department', targetName],
    ['Status', supplier ? record.status : (posted ? 'Posted to stock' : 'Draft')],
    ['Linked GRN', supplier ? record.grn_number || record.goods_receipt : '—'],
    ['Reason', record.reason], ['Supplier credit note', supplier ? record.credit_note_number : '—'],
    ['Supplier acknowledgement', supplier ? record.supplier_acknowledged_by : '—'],
  ]
  const page = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title + ' ' + value(record.return_no)) +
    '</title><style>@page{size:A4 portrait;margin:16mm}body{font:12px Arial,sans-serif;color:#162c23}h1{font-size:20px;margin-bottom:5px}h2{font-size:12px;color:#395548}header{padding-bottom:12px;border-bottom:3px solid #196f4a}small{color:#52665c}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #b5c6bc;padding:9px;text-align:left;vertical-align:top}th{background:#eaf2ed}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:18px 0}.meta div{border-bottom:1px solid #d2ddd6;padding:5px}.meta strong{display:block;font-size:10px;color:#597165;text-transform:uppercase;margin-bottom:4px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:65px}.signatures div{border-top:1px solid #566b60;padding-top:7px}.note{margin-top:20px;border:1px solid #b5c6bc;padding:10px}.draft{font-weight:bold;color:#a04f15}@media print{button{display:none}}</style></head><body><header><h1>' +
    esc(title) + '</h1><small>Hotel ERP · Materials & Cost Control · Transaction evidence</small></header><section class="meta">' +
    pairs.map(([label, val]) => '<div><strong>' + esc(label) + '</strong>' + esc(val || '—') + '</div>').join('') +
    '</section><h2>ARTICLES RETURNED</h2><table><thead><tr><th>#</th><th>Article</th><th>Quantity (base units)</th><th>Condition / reason</th></tr></thead><tbody>' +
    rows + '</tbody></table><div class="note">' + (posted ? 'Stock posting is recorded in the ERP ledger.' :
    '<span class="draft">DRAFT — NOT POSTED TO INVENTORY</span>') +
    ' Verify article condition and the original signed issue / posted GRN against the electronic record.</div><section class="signatures"><div>Returned / Dispatched by<br>Name and signature: ___________________<br>Date: ___________________</div><div>Received / Acknowledged by<br>Name and signature: ___________________<br>Date: ___________________</div></section><p><small>Printed by: ' +
    esc(userName) + ' · ' + esc(new Date().toLocaleString('en-UG')) +
    '. Signatures above are blank until physically signed; printed names are not digital signatures.</small></p></body></html>'
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.document.write(page)
  popup.document.close()
  popup.focus()
  popup.print()
  return true
}

export function exportReturnRegister(kind: ReturnKind, records: DocumentRow[], lines: DocumentRow[],
  items: DocumentRow[], stores: DocumentRow[], targets: DocumentRow[]): void {
  const articleNames = new Map(items.map(row => [value(row.id), value(row.name)]))
  const storeNames = new Map(stores.map(row => [value(row.id), value(row.name)]))
  const targetNames = new Map(targets.map(row => [value(row.id), value(row.name)]))
  const columns = ['Return number','Date','Status','Store','Department / supplier','Article','Quantity (base)','Reason / condition','Supplier credit note','Inventory posted']
  const csvLines = [columns.map(safeCsv).join(',')]
  for (const record of records) {
    const documentLines = lines.filter(line => value(line[kind === 'supplier' ? 'supplier_return' : 'store_return']) === value(record.id))
    for (const line of documentLines.length ? documentLines : [{}]) {
      csvLines.push([
        record.return_no, record.return_date, record.status || (record.inventory_changes_applied ? 'posted' : 'draft'),
        storeNames.get(value(record.store)) || 'Store unavailable',
        targetNames.get(value(record[kind === 'supplier' ? 'supplier' : 'department'])) || 'Name unavailable',
        articleNames.get(value(line.item)) || 'Article unavailable',
        line.base_quantity || line.quantity || '', line.condition_note || line.reason || record.reason,
        record.credit_note_number || '', record.inventory_changes_applied ? 'Yes' : 'No',
      ].map(safeCsv).join(','))
    }
  }
  const blob = new Blob(['\ufeff', csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = kind + '-return-register-' + new Date().toISOString().slice(0, 10) + '.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
