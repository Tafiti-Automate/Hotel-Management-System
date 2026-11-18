import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const view = readFileSync(new URL('../../screens/ReceivingClerkWorkspaceV2.tsx', import.meta.url), 'utf8')

test('two-stage receiving conceals ordered quantities until count committed', () => {
  assert.match(view, /Stage 1 · Blind physical count/)
  assert.match(view, /Ordered quantities remain hidden until this physical count/)
  assert.match(view, /title="Ordered quantity concealed during blind receiving"/)
  assert.match(view, /confirmLabel="Save & lock blind count"/)
  assert.match(view, /setPreviewGrnId\(receiptId\)/)
  assert.match(view, /Stage 2 · Locked count reconciliation/)
  assert.match(view, /\/blind-reconciliation\//)
  assert.match(view, /Saved receiving and inspection quantities cannot be edited/)
})

test('locked reconciliation exposes only quantity comparisons with auditable variance explanation', () => {
  assert.match(view, /due_before_delivery/)
  assert.match(view, /counted_quantity/)
  assert.match(view, /accepted_quantity/)
  assert.match(view, /rejected_quantity/)
  assert.match(view, /short_quantity/)
  assert.match(view, /excess_quantity/)
  assert.match(view, /outstanding_after_inspection/)
  assert.match(view, /'variance-note'/)
  assert.match(view, /Save audited explanation/)
  assert.doesNotMatch(view, /short_delivery_reason: reason\.trim\(\)/)
})
