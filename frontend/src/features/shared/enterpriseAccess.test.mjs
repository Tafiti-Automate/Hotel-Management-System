import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canAccessRoute } from '../../lib/access.ts'

const user = (role, isSuperuser=false) => ({
  role, isSuperuser, permissions: [],
})

test('operational role boundaries remain strict for new enterprise routes', () => {
  assert.equal(canAccessRoute(user('Department Supervisor'),'waste-new'),true)
  assert.equal(canAccessRoute(user('Department Supervisor'),'finance-budgets'),false)
  assert.equal(canAccessRoute(user('Department Supervisor'),'purchasing-quotes'),false)
  assert.equal(canAccessRoute(user('Receiving Clerk'),'receiving-po-detail'),true)
  assert.equal(canAccessRoute(user('Receiving Clerk'),'grn-posting'),false)
  assert.equal(canAccessRoute(user('Store Keeper'),'grn-posting'),true)
  assert.equal(canAccessRoute(user('Store Keeper'),'transfer-dispatch'),true)
  assert.equal(canAccessRoute(user('Store Keeper'),'finance-invoice-matching'),false)
  assert.equal(canAccessRoute(user('Financial Manager'),'finance-period-close'),true)
  assert.equal(canAccessRoute(user('Accounts Payable Clerk'),'finance-invoice-matching'),true)
  assert.equal(canAccessRoute(user('Department Head'),'purchasing-pr-new'),true)
  assert.equal(canAccessRoute(user('Procurement Officer'),'purchasing-workbench'),true)
  assert.equal(canAccessRoute(user('General Manager'),'approval-inbox'),true)
})

test('IT administrators can configure but not run purchasing, transfers or posting', () => {
  for(const admin of [user('System Administrator'),user('System Administrator',true)]) {
    assert.equal(canAccessRoute(admin,'admin-cost-centers'),true)
    assert.equal(canAccessRoute(admin,'admin-authorisation-rules'),true)
    assert.equal(canAccessRoute(admin,'access-management'),true)
    assert.equal(canAccessRoute(admin,'grn-posting'),false)
    assert.equal(canAccessRoute(admin,'transfer-dispatch'),false)
    assert.equal(canAccessRoute(admin,'finance-period-close'),false)
    assert.equal(canAccessRoute(admin,'purchasing-workbench'),false)
    assert.equal(canAccessRoute(admin,'approval-inbox'),false)
  }
})
