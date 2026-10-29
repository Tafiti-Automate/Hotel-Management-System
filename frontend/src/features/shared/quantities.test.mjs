import test from 'node:test'
import assert from 'node:assert/strict'
import { validateApproval, validateCount, validateQuantity } from './quantities.ts'

test('quantity limits accept valid zero and partial receipts', () => {
  assert.equal(validateQuantity('0', 12), null)
  assert.equal(validateQuantity('7.5', 12), null)
  assert.match(validateQuantity('13', 12), /exceeds/)
  assert.match(validateQuantity('-1', 12), /negative/)
  assert.match(validateQuantity('', 12), /Enter/)
  assert.match(validateQuantity('abc', 12), /valid/)
})
test('quantity reduction requires a documented reason', () => {
  assert.match(validateApproval('4', 10, ''), /Explain/)
  assert.equal(validateApproval('4', 10, 'Items unavailable'), null)
  assert.equal(validateApproval('10', 10, ''), null)
  assert.match(validateApproval('11', 10, 'reason'), /exceeds/)
})
test('stock counts require finite non-negative quantities', () => {
  assert.equal(validateCount('0'), null)
  assert.equal(validateCount('4.25'), null)
  assert.match(validateCount(''), /Enter/)
  assert.match(validateCount('-0.1'), /negative/)
  assert.match(validateCount('NaN'), /valid/)
})
