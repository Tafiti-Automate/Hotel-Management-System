import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const screen = readFileSync(new URL('../../screens/ReceivingClerkWorkspaceV2.tsx', import.meta.url), 'utf8')

test('receiving permits a supplier delivery note without an invoice', () => {
  assert.match(screen, /missingDocumentReference = !invoice\.trim\(\) && !delivery\.trim\(\)/)
  assert.match(screen, /Supplier invoice \(if supplied\)/)
  assert.match(screen, /Delivery note \(if supplied\)/)
  assert.doesNotMatch(screen, /disabled=\{busy \|\| !invoice\.trim\(\)/)
})
test('reused supplier invoices require a separate delivery reference', () => {
  assert.match(screen, /needsDistinctDeliveryNote/)
  assert.match(screen, /reusedDeliveryNote/)
  assert.match(screen, /previousGrns/)
  assert.match(screen, /invalidReference/)
  assert.match(screen, /Never invent a reference/)
})
test('blind receiving quantities stay concealed until count is locked', () => {
  assert.match(screen, /Ordered quantities remain hidden until this physical count/)
  assert.match(screen, /title="Ordered quantity concealed during blind receiving"/)
  assert.match(screen, /Save & lock blind count/)
})
