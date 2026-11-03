import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiHttpError, isUnauthorizedError } from './httpError.ts'

test('only authenticated HTTP 401 responses invalidate the current session', () => {
  assert.equal(isUnauthorizedError(new ApiHttpError('Invalid token.', 401)), true)
  assert.equal(isUnauthorizedError(new ApiHttpError('Permission denied.', 403)), false)
  assert.equal(isUnauthorizedError(new Error('Invalid token.')), false)
})
