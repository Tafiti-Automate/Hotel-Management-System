import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDataId, toBackendPayload } from '../../lib/api.ts'

const categories = [
  { id: 'sub-001', name: 'Soft Drinks', parentId: 'major-001' },
  { id: 'major-001', name: 'Beverages', parentId: null },
  { id: 'sub-002', name: 'Housekeeping', parentId: 'major-002' },
  { id: 'major-002', name: 'Operations', parentId: null },
]
const data = { categories }

test('a blank parent never resolves to the first Item Group with no abbreviation', () => {
  assert.equal(findDataId(data, 'categories', ''), '')
  assert.equal(findDataId(data, 'categories', null), '')
  assert.equal(findDataId(data, 'categories', undefined), '')
  assert.equal(findDataId(data, 'categories', '  '), '')
})

test('New Major Group GUEST SUPPLIES posts a null parent even with existing Item Groups', () => {
  const payload = toBackendPayload('categories', {
    name: 'GUEST SUPPLIES',
    description: 'GUEST AMENITIES',
    code: '',
    status: 'Active',
    parent: '',
  }, data)
  assert.deepEqual(payload, {
    name: 'GUEST SUPPLIES', code: '', parent: null,
    description: 'GUEST AMENITIES', is_active: true,
  })
})

test('new Item Group chooses a real Major Group parent', () => {
  const payload = toBackendPayload('categories', {
    name: 'Guest Amenities', parent: 'Beverages', status: 'Active',
  }, data)
  assert.equal(payload.parent, 'major-001')
})

test('an Item Group cannot be used as the parent for another Item Group', () => {
  assert.throws(() => toBackendPayload('categories', {
    name: 'Invalid Third Level', parent: 'Soft Drinks',
  }, data), /Choose a Major Group/)
})

test('unknown parent never silently becomes a root group', () => {
  assert.throws(() => toBackendPayload('categories', {
    name: 'Unattached Item Group', parent: 'Missing Group',
  }, data), /Select an existing Major Group/)
})
