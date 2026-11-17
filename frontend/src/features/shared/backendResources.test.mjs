import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveBackendResourcePath } from './backendResources.ts'

test('supplier aliases use the actual Django vendors endpoint', () => {
  assert.equal(resolveBackendResourcePath('suppliers'), 'vendors')
  assert.equal(resolveBackendResourcePath('suppliers/42'), 'vendors/42')
})

test('registered canonical resources are unaffected', () => {
  assert.equal(resolveBackendResourcePath('supplier-item-prices'), 'supplier-item-prices')
  assert.equal(resolveBackendResourcePath('supplier-price-quotes'), 'supplier-price-quotes')
  assert.equal(resolveBackendResourcePath('vendors'), 'vendors')
  assert.equal(resolveBackendResourcePath('items'), 'items')
  assert.equal(resolveBackendResourcePath('stock-count-items'), 'stock-count-items')
})
