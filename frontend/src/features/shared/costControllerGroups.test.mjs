import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
test('Cost Control catalogue has separate major and item group actions', () => {
  const screen = read('../../screens/InventoryCatalogue.tsx')
  assert.match(screen, /Create Major Group/)
  assert.match(screen, /Create Item Group/)
  assert.match(screen, /roots\.length === 1 \? \{ parent:/)
  assert.match(screen, /app\.openCreate\('categories', 'Item Grouping', 'majorGroup'\)/)
})
test('Cost Controller can reach category route without missing Django view grant', () => {
  const access = read('../../lib/access.ts')
  assert.match(access, /route === 'categories' && role === 'cost controller'/)
  const sidebar = read('../../components/Sidebar.tsx')
  assert.match(sidebar, /Major & Item Groups/)
})
test('Create form checks group name and duplicate before saving', () => {
  const form = read('../../components/FormDrawer.tsx')
  assert.match(form, /Group name required/)
  assert.match(form, /Group name already in use/)
  assert.match(form, /Select the Major Group/)
})
