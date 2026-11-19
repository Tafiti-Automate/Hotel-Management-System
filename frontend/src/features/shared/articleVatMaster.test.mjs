import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
test('Article Master requires explicit VAT classification', () => {
  const data = read('../../lib/data.ts')
  const form = read('../../components/FormDrawer.tsx')
  assert.match(data, /taxTreatment/)
  assert.match(data, /'vatTreatments'/)
  assert.match(form, /VAT selection required/)
  assert.match(form, /existing.vatApplicable/)
})
test('Article payload stores VAT and LPO summary distinguishes net from gross', () => {
  const api = read('../../lib/api.ts')
  const ui = read('../../screens/ProcurementWorkbench.tsx')
  assert.match(api, /vat_applicable: text\(values.taxTreatment\)/)
  assert.match(ui, /VAT \(selected Articles\)/)
  assert.match(ui, /Total incl\. VAT/)
})
