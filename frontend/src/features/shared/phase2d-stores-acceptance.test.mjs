import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const storekeeper = readFileSync(new URL('../../screens/StorekeeperSprintOne.tsx', import.meta.url), 'utf8')
const outlet = readFileSync(new URL('../../screens/OutletWorkflow.tsx', import.meta.url), 'utf8')
const access = readFileSync(new URL('../../lib/access.ts', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../../components/Sidebar.tsx', import.meta.url), 'utf8')
const operations = readFileSync(new URL('../enterprise/OperationsAdmin.tsx', import.meta.url), 'utf8')

test('Stores dispatch accepts four decimal places end to end in the UI', () => {
  assert.match(storekeeper, /\\d\\{1,4\\}/)
  assert.match(storekeeper, /step="0\\.0001"/)
  assert.match(storekeeper, /maximumFractionDigits: 4/)
  assert.match(storekeeper, /ConfirmTransaction title="Dispatch selected transfers\\?"/)
})

test('Department supervisor must explicitly sign a confirmed physical pickup', () => {
  assert.match(outlet, /title=\\{'Sign pickup for issue '/)
  assert.match(outlet, /confirmLabel="Sign physical pickup"/)
  assert.match(outlet, /disabled=\\{!ready \\|\\| !agreed \\|\\| busy \\|\\| !items\\.length\\}/)
  assert.match(outlet, /runBackendAction\\('stock-issues', sid\\(candidate\\.id\\), 'acknowledge'\\)/)
})

test('Storekeeper receives a visible error for print popup failures', () => {
  assert.match(storekeeper, /if \\(!popup\\) return false/)
  assert.match(storekeeper, /Unable to print picking list/)
  assert.match(storekeeper, /Unable to print packing list/)
})

test('Department returns stay in the Storekeeper workspace with a posting confirmation', () => {
  assert.match(sidebar, /route: 'department-returns-new', label: 'Department returns'/)
  assert.match(access, /'department-returns-new': \\['store keeper'\\]/)
  assert.match(operations, /export function EnterpriseDepartmentReturn\\(/)
  assert.match(operations, /title="Post department return to stock\\?"/)
})
