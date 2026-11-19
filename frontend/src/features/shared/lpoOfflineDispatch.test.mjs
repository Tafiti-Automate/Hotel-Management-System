import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const ui = readFileSync(new URL('../../screens/ProcurementWorkbench.tsx', import.meta.url), 'utf8')
test('Approved LPO download releases to receiving without email gate', () => {
  assert.match(ui, /release-for-receiving/)
  assert.match(ui, /Download .*release to Receiving/)
  assert.doesNotMatch(ui, /Email LPO to Supplier/)
  assert.doesNotMatch(ui, /disabled=\{busy \|\| !registeredSupplierEmail/)
})
