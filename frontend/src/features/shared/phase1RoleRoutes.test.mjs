import test from 'node:test'
import assert from 'node:assert/strict'
import { canAccessRoute } from '../../lib/access.ts'

const actor = role => ({role, isSuperuser:false, permissions:[]})

test('all ten hotel roles reach their assigned operational workspaces', () => {
  const assigned = [
    ['Department Supervisor','new-store-request'],
    ['Department Head','workflow-stores'],
    ['Store Keeper','dashboard'],
    ['Cost Controller','stocktake-sheet'],
    ['Cost Controller','store-inventory'],
    ['Cost Controller','store-analysis'],
    ['Cost Controller','store-usage'],
    ['Cost Controller','stocktake-variance'],
    ['Procurement Manager','purchasing-quotes'],
    ['Receiving Clerk','receiving-po-detail'],
    ['Accounts Payable Clerk','finance-invoice-matching'],
    ['Financial Manager','finance-budgets'],
    ['General Manager','approval-inbox'],
    ['System Administrator','access-management'],
  ]
  for (const [role,route] of assigned) {
    assert.equal(canAccessRoute(actor(role),route),true,`${role} cannot open ${route}`)
  }
})

test('role navigation rejects routes that use disallowed data or posting capabilities', () => {
  const forbidden = [
    ['Department Supervisor','stocktake-variance'],
    ['Department Supervisor','stocktake-sheet'],
    ['Department Head','approval-inbox'],
    ['Department Head','purchasing-quotes'],
    ['Store Keeper','finance-period-close'],
    ['Store Keeper','stocktake-sheet'],
    ['Store Keeper','store-inventory'],
    ['Store Keeper','store-analysis'],
    ['Store Keeper','store-usage'],
    ['Store Keeper','reports'],
    ['Cost Controller','finance-invoice-matching'],
    ['Procurement Manager','grn-posting'],
    ['Receiving Clerk','purchasing-quotes'],
    ['Accounts Payable Clerk','stocktake-sheet'],
    ['Financial Manager','stocktake-sheet'],
    ['General Manager','stocktake-sheet'],
    ['System Administrator','grn-posting'],
  ]
  for (const [role,route] of forbidden) {
    assert.equal(canAccessRoute(actor(role),route),false,`${role} was unexpectedly allowed into ${route}`)
  }
})
