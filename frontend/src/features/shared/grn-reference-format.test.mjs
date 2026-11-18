import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const template = readFileSync(new URL('../../components/GrnReferenceDocument.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../../grn-reference-exact.css', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../../../app/layout.tsx', import.meta.url), 'utf8')
const receiving = readFileSync(new URL('../../screens/ReceivingClerkWorkspaceV2.tsx', import.meta.url), 'utf8')
const procurement = readFileSync(new URL('../../screens/ProcurementWorkbench.tsx', import.meta.url), 'utf8')

test('matches the supplied landscape hotel GRN layout and exact field order', () => {
  assert.match(template, /<strong>{propertyLabel}<\/strong>/)
  assert.match(template, /\(PURCHASE ORDER RECEIVING\)/)
  assert.match(template, /grn-reference-supplier-address/)
  assert.match(template, /GRN No\./)
  assert.match(template, /LPO No\./)
  assert.match(template, /Delivery Date/)
  assert.match(template, /Delivery Note No\./)
  const headings = ['Status', 'Article', 'Ordered', 'Unit', 'Delivered', 'Unit Price', 'Net', 'VAT %', 'Amount']
  const header = template.slice(template.indexOf('<thead>'), template.indexOf('</thead>'))
  let previous = -1
  for (const heading of headings) {
    const match = header.indexOf('>' + heading + '<')
    assert.ok(match > previous, 'Missing or out-of-order column: ' + heading)
    previous = match
  }
  assert.match(template, /Net Total/)
  assert.match(template, /VAT Total/)
  assert.match(template, /<strong>Total<\/strong>/)
  assert.match(template, /Signature :/)
  assert.match(template, /Status: UD- Partial Delivery/)
  assert.match(template, /grn-reference-timestamp/)
  assert.match(styles, /@page\s*\{\s*size:\s*A4 landscape;/)
  assert.match(layout, /import '\.\.\/src\/grn-reference-exact\.css'/)
})

test('both the active Receiving Clerk and Procurement history use one GRN template', () => {
  assert.match(receiving, /<GrnReferenceDocument/)
  assert.match(procurement, /<GrnReferenceDocument/)
  assert.match(receiving, /comparison=\{comparison\}/)
  assert.match(receiving, /disabled=\{loading \|\| Boolean\(receipt\.blind_count_locked_at && !comparison\)\}/)
  assert.match(receiving, /Print GRN/)
  assert.match(procurement, /Print GRN/)
})

test('no fabricated ordered values, supplier price or financial amount in blind copies', () => {
  assert.match(template, /hasOrdered \? qty\(line\.ordered_quantity\) : '—'/)
  assert.match(template, /costKnown/)
  assert.match(template, /const money = \(value: number \| null\) => value === null \? '—'/)
  assert.match(template, /supplier_name/)
  assert.match(template, /hotel\?\.name/)
  assert.doesNotMatch(template, /NATIONAL WATER AND SEWERAGE CORP/i)
  assert.doesNotMatch(template, /1,038,400\.00/)
})


test('Receiving Clerk can reach supplier returns and form blocks unsafe submissions', () => {
  const roleTemplates = readFileSync(new URL('../../../../hotel_erp_backend/apps/accounts/role_templates.py', import.meta.url), 'utf8')
  const receivingRole = roleTemplates.slice(roleTemplates.indexOf('"Receiving Clerk": {'))
  assert.match(receivingRole, /"supplierreturn", "supplierreturnitem"/)
  assert.match(procurement, /'receiving clerk': \['receipt', 'inspect', 'return'\]/)
  const returnPanel = procurement.slice(procurement.indexOf('function ReturnPanel('), procurement.indexOf('function StageTable('))
  assert.match(returnPanel, /rows=\{postedReceipts\}/)
  assert.match(returnPanel, /selectedItemInReceipt/)
  assert.match(returnPanel, /quantityValid/)
  assert.match(returnPanel, /draftHasLines/)
  assert.doesNotMatch(returnPanel, /returned_by: form\.employee/)
})
