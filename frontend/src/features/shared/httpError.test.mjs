import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiHttpError, isUnauthorizedError, explainReadFailure } from './httpError.ts'

test('only authenticated HTTP 401 responses invalidate the current session', () => {
  assert.equal(isUnauthorizedError(new ApiHttpError('Invalid token.', 401)), true)
  assert.equal(isUnauthorizedError(new ApiHttpError('Permission denied.', 403)), false)
  assert.equal(isUnauthorizedError(new Error('Invalid token.')), false)
})

test('failed reads explain missing role permissions and safe recovery', () => {
  assert.match(explainReadFailure('expenses', 403), /assigned role/)
  assert.match(explainReadFailure('supplier-payments', 403), /permissions/)
  assert.match(explainReadFailure('grns', 500), /records have not been changed/)
  assert.match(explainReadFailure('notifications', 401), /sign in again/i)
})
