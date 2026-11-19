import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { canAccessRoute } from '../../lib/access.ts'

const sidebar = readFileSync(new URL('../../components/Sidebar.tsx', import.meta.url), 'utf8')
const access = readFileSync(new URL('../../lib/access.ts', import.meta.url), 'utf8')
const stock = readFileSync(new URL('../../screens/StockOnHand.tsx', import.meta.url), 'utf8')

test('Cost Controller has dedicated Stock on Hand navigation and permitted route', () => {
  const costNav = sidebar.slice(sidebar.indexOf("  'cost controller': ["), sidebar.indexOf("  'procurement manager': ["))
  assert.match(costNav, /route: 'stock-on-hand', label: 'Stock on Hand'/)
  const strict = access.slice(access.indexOf("  'cost controller': new Set("), access.indexOf("  'procurement manager': new Set("))
  assert.match(strict, /'stock-on-hand'/)
  assert.match(access, /\['store keeper', 'cost controller'\]\.includes\(role\)/)
})

test('Stock on Hand shows Cost Controllers property stores without editable stock controls', () => {
  assert.match(stock, /isCostController = app\.user\.role\.trim\(\)\.toLowerCase\(\) === 'cost controller'/)
  assert.match(stock, /All property stores/)
  assert.match(stock, /Read-only inventory oversight for stores within your property/)
  assert.match(stock, /Quarantined \(supplier returns\)/)
})

test('Stock on Hand route allows Cost Controller and Store Keeper but blocks other operational roles', () => {
  const user = (role) => ({ role, isSuperuser: false, permissions: ['inventory.view_inventorybalance'] })
  assert.equal(canAccessRoute(user('cost controller'), 'stock-on-hand'), true)
  assert.equal(canAccessRoute(user('store keeper'), 'stock-on-hand'), true)
  assert.equal(canAccessRoute(user('receiving clerk'), 'stock-on-hand'), false)
  assert.equal(canAccessRoute(user('department supervisor'), 'stock-on-hand'), false)
  assert.equal(canAccessRoute(user('financial manager'), 'stock-on-hand'), false)
  assert.equal(canAccessRoute({ role: 'cost controller', isSuperuser: false, permissions: [] }, 'stock-on-hand'), false)
})
