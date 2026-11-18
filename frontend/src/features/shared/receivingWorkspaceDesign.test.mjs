import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const screen = readFileSync(new URL('../../screens/ReceivingClerkWorkspaceV2.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../receiving-workspace.css', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../../../app/layout.tsx', import.meta.url), 'utf8')
test('receiving command centre has source-backed KPIs and searchable registers', () => {
  for (const expected of ['filteredReady', 'filteredHistory', 'awaitingStore', 'postedCount', 'receiving-register-search', 'ds-receiving-summary']) assert.ok(screen.includes(expected), expected)
})
test('blind receiving and GRN document invariants are retained', () => {
  for (const expected of ['Ordered quantities remain hidden', '***', 'step="0.0001"', 'blind-reconciliation/', 'Save & lock blind count', 'GrnReferenceDocument']) assert.ok(screen.includes(expected), expected)
  assert.ok(layout.indexOf("import '../src/receiving-workspace.css'") < layout.indexOf("import '../src/grn-reference-exact.css'"))
  assert.ok(!css.includes('.grn-reference-page'))
})
test('receiving responsive states and keyboard navigation are supported', () => {
  assert.ok(screen.includes('aria-label="Receiving registers"'))
  assert.ok(screen.includes('No matching LPOs'))
  assert.ok(screen.includes('No matching GRNs'))
  assert.ok(css.includes('@media (max-width: 680px)'))
})
