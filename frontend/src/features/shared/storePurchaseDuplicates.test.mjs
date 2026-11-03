import test from 'node:test'
import assert from 'node:assert/strict'
import { findOpenStorePurchaseRequest } from './storePurchaseDuplicates.ts'

test('finds only duplicate lines that are still open for the same store', () => {
  const requests = [
    { id: 'open', status: 'approved', requisition_number: '000123' },
    { id: 'done', status: 'fulfilled', requisition_number: '000122' },
  ]
  const lines = [
    { requisition: 'done', item: 'paper', destination_store: 'main' },
    { requisition: 'open', item: 'paper', destination_store: 'main' },
  ]

  assert.equal(findOpenStorePurchaseRequest(requests, lines, 'main', 'paper')?.id, 'open')
  assert.equal(findOpenStorePurchaseRequest(requests, lines, 'branch', 'paper'), null)
  assert.equal(findOpenStorePurchaseRequest(requests, lines, 'main', 'pens'), null)
})

test('ordered and partially received requests continue to block duplicates', () => {
  const lines = [{ requisition: 'request', item: 'paper', destination_store: 'main' }]

  for (const status of ['partially_ordered', 'ordered', 'partially_received']) {
    assert.equal(
      findOpenStorePurchaseRequest([{ id: 'request', status }], lines, 'main', 'paper')?.id,
      'request',
    )
  }
})
