import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
test('outlet request has searchable source and assigned cost center', () => {
  const src = read('../../screens/OutletWorkflow.tsx')
  assert.match(src, /Search source stores/)
  assert.match(src, /Search destination cost centers/)
  assert.match(src, /destination_department: destination/)
  assert.match(src, /bp-store-search-options/)
  assert.match(src, /bp-cost-center-options/)
})
test('Stock on Hand shows cumulative issued and transferred not mislabelled reservations', () => {
  const src = read('../../screens/StockOnHand.tsx')
  assert.match(src, /Issued \/ transferred/)
  assert.match(src, /Reserved \(pending allocation\)/)
  assert.match(src, /received GRN/)
  assert.match(src, /Open GRN posting/)
})
test('Storekeeper valued issue vouchers show unit and total cost after dispatch only', () => {
  const src = read('../../screens/StorekeeperSprintOne.tsx')
  assert.match(src, /dispatched_unit_cost/)
  assert.match(src, /line_total_cost/)
  assert.match(src, /Print valued issue voucher/)
  assert.match(src, /Department Transfer \/ Valued Issue Voucher/)
  assert.match(src, /Dispatch successful — valuation unavailable/)
})
