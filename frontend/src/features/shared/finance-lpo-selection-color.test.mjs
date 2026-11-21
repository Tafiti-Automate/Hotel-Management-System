import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workspace = readFileSync(new URL('../../screens/FinancialManagerLpoWorkspace.tsx', import.meta.url), 'utf8')

test('selected Finance LPO uses a soft blue record highlight instead of primary-action green', () => {
  assert.match(workspace, /finance-lpo-queue-row\$\{active \? ' is-selected' : ''\}/)
  assert.match(workspace, /borderLeft: active \? '3px solid #2563eb'/)
  assert.match(workspace, /background: active \? 'color-mix\(in srgb, #2563eb 9%, var\(--surface\)\)'/)
  assert.doesNotMatch(workspace, /borderLeft: active \? '3px solid var\(--accent\)'/)
})
