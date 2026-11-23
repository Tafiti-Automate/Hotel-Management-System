import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Store Keeper count screen does not offer Finance approval or disclose missing theoretical quantities', () => {
  const source = readFileSync(new URL('../../screens/StoreInventory.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /runBackendAction\('stock-counts',[^\n]*'approve'/)
  assert.doesNotMatch(source, /Approve Inventory/)
  assert.match(source, /awaiting independent Financial Manager approval/)
  assert.match(source, /step="0\.0001"/)
  assert.match(source, /maximumFractionDigits: 4/)
  assert.match(source, /line\.system_quantity != null/)
  assert.match(source, /canShowTheoretical && <th>System Qty<\/th>/)
})
