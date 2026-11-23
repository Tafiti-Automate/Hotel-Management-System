import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { canAccessRoute } from '../../lib/access.ts'

const sidebar = readFileSync(new URL('../../components/Sidebar.tsx', import.meta.url), 'utf8')
const list = readFileSync(new URL('../../screens/ListView.tsx', import.meta.url), 'utf8')
const form = readFileSync(new URL('../../components/FormDrawer.tsx', import.meta.url), 'utf8')
const data = readFileSync(new URL('../../lib/data.ts', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

test('Cost Controller can access store and department master-data screens', () => {
  const cost = sidebar.slice(
    sidebar.indexOf("  'cost controller': ["),
    sidebar.indexOf("  'procurement manager': ["),
  )
  assert.match(cost, /route: 'locations', label: 'Stores management'/)
  assert.match(cost, /route: 'departments', label: 'Departments management'/)
  const user = {
    role: 'cost controller', isSuperuser: false,
    permissions: ['inventory.view_storelocation', 'departments.view_department'],
  }
  assert.equal(canAccessRoute(user, 'locations'), true)
  assert.equal(canAccessRoute(user, 'departments'), true)
})

test('Create store and create department are visible to Cost Controller', () => {
  assert.match(list, /costControllerMasterDataCreate = role === 'cost controller'/)
  assert.match(list, /costControllerMasterDataCreate \|\| !permissionName/)
  assert.match(list, /config.editable && canAdd/)
  assert.match(data, /add: 'Create store'/)
  assert.match(data, /add: 'Create department'/)
})

test('Store creation preselects assigned property and restricts selectable branches', () => {
  assert.match(api, /hotelId: text\(row.hotel\)/)
  assert.match(form, /f.entity === 'locations' && !f.id && roleKey === 'cost controller'/)
  assert.match(form, /assigned.hotelId/)
  assert.match(form, /branch.hotelId === assigned.hotelId/)
  assert.match(form, /branch.id === assigned.id/)
})
