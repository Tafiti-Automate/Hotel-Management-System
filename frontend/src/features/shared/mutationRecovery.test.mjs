import test from 'node:test'
import assert from 'node:assert/strict'
import { isTransportFailure, supplierQuotationMatches } from './mutationRecovery.ts'

const payload = {
  supplier: 'supplier-1', item: 'item-1', unit: 'unit-1',
  supplier_sku: 'SUP-BOOK', unit_price: 2500,
  currency: 'UGX', effective_from: '2026-11-03',
  minimum_order_quantity: 1, lead_time_days: 2,
  last_quoted_at: '2026-11-03', quotation_reference: 'QUOTE-12',
  quotation_valid_until: '2026-12-03', is_active: true,
}

test('transport failures are distinguished from API validation responses', () => {
  assert.equal(isTransportFailure(new TypeError('Failed to fetch')), true)
  assert.equal(isTransportFailure(new Error('The server took too long to respond. Please retry.')), true)
  assert.equal(isTransportFailure(new Error('item: This supplier already has a quotation.')), false)
})

test('lost-response reconciliation accepts only the exact saved quotation', () => {
  assert.equal(supplierQuotationMatches(payload, {
    ...payload,
    unit_price: '2500.00', minimum_order_quantity: '1.00', lead_time_days: 2,
  }), true)
  assert.equal(supplierQuotationMatches(payload, { ...payload, unit_price: '2750.00' }), false)
  assert.equal(supplierQuotationMatches(payload, { ...payload, quotation_reference: 'OLDER-QUOTE' }), false)
})
