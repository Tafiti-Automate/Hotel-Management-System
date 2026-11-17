import assert from 'node:assert/strict'
import { test } from 'node:test'
import { labelForRoute, pathForRoute, routeFromPath } from '../../lib/navigation.ts'

test('semantic operational URLs are bookmarkable', () => {
  assert.equal(routeFromPath('/dashboard'), 'dashboard')
  assert.equal(routeFromPath('/transfers/requisitions/new'), 'new-store-request')
  assert.equal(routeFromPath('/transfers/incoming'), 'incoming-pickup')
  assert.equal(routeFromPath('/stores/grn-posting'), 'grn-posting')
  assert.equal(routeFromPath('/stores/transfers'), 'transfer-dispatch')
  assert.equal(pathForRoute('grn-posting'), '/stores/grn-posting')
  assert.equal(routeFromPath('/finance/budgets'), 'finance-budgets')
  assert.equal(routeFromPath('/finance/period-close'), 'finance-period-close')
  assert.equal(routeFromPath('/finance/invoice-matching'), 'finance-invoice-matching')
  assert.equal(routeFromPath('/purchasing/workbench'), 'purchasing-workbench')
  assert.equal(routeFromPath('/purchasing/quotes'), 'purchasing-quotes')
  assert.equal(routeFromPath('/reports/menu-engineering'), 'menu-engineering')
  assert.equal(routeFromPath('/purchasing/orders/PO-0042'), 'purchasing-order-detail')
  assert.equal(routeFromPath('/receiving/po/PO-0042'), 'receiving-po-detail')
  assert.equal(routeFromPath('/recipes/123'), 'recipes-detail')
  assert.equal(routeFromPath('/stocktake/123'), 'stocktake-sheet')
  assert.equal(routeFromPath('/stocktake/123/variance'), 'stocktake-variance')
  assert.equal(pathForRoute('new-store-request'), '/transfers/requisitions/new')
  assert.equal(pathForRoute('workflow-pay'), '/finance')
  assert.equal(labelForRoute('incoming-pickup'), 'Confirm pickup')
})

test('unknown paths are not treated as authorized workspaces', () => {
  assert.equal(routeFromPath('/not-a-module'), null)
  assert.equal(routeFromPath('/workspace/not-a-module'), null)
  assert.equal(pathForRoute('not-a-module'), null)
})
