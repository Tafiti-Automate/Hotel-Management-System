import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const screen = readFileSync(
  new URL('../enterprise/ProcurementFinance.tsx', import.meta.url), 'utf8',
)

test('Finance close screen reads the role-protected GRNI endpoint without posting journals', () => {
  assert.match(screen, /grni-reconciliation\//)
  assert.match(screen, /Goods Received Not Invoiced reconciliation/)
  assert.match(screen, /Unmatched GRNI exposure/)
  assert.match(screen, /requires_manual_review/)
  assert.match(screen, /not an accounting journal/)
  assert.doesNotMatch(screen, /runBackendAction\('fiscal-periods',selected,'grni-reconciliation'/)
})
