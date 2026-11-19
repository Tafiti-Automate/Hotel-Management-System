import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const root = new URL('../../', import.meta.url)
const read = p => readFileSync(new URL(p, root), 'utf8')
test('hospitality routes use dedicated permissions and least-privilege roles', () => {
 const access = read('lib/access.ts')
 const nav = read('lib/navigation.ts')
 const shell = read('screens/AppShell.tsx')
 const sidebar = read('components/Sidebar.tsx')
 assert.match(access, /'front-desk-reservations': \['hospitality.view_reservation'\]/)
 assert.match(access, /'bar-pos': \['hospitality.view_poscheck'\]/)
 assert.match(nav, /\/front-desk\/reservations/)
 assert.match(nav, /\/bar\/pos/)
 assert.match(shell, /<ReceptionWorkspace\s*\/>/)
 assert.match(shell, /<BarPosWorkspace\s*\/>/)
 assert.match(sidebar, /bartender: \[/)
})
test('hospitality forms only call protected transaction endpoints', () => {
 const screen = read('screens/HospitalityWorkspaces.tsx')
 assert.ok(screen.includes("createBackendRecord('hospitality-reservations'"))
 assert.ok(screen.includes("createBackendRecord('hospitality-pos-checks'"))
 assert.ok(screen.includes('hospitality-reservations/availability?'))
 assert.ok(screen.includes('hospitality-pos-checks/outlets'))
 assert.ok(screen.includes("'add-line'"))
 assert.ok(!screen.includes("createBackendRecord('sales'"))
})
test('hospitality styles remain scoped and imported before GRN print', () => {
 const style = read('hospitality-workspaces.css')
 const layout = read('../app/layout.tsx')
 assert.ok(style.includes('.hs-workspace'))
 assert.ok(layout.indexOf("hospitality-workspaces.css") < layout.indexOf("grn-reference-exact.css"))
})

test('Phase 1D guest registration and draft POS orders are connected without financial posting',()=>{const screen=read('screens/HospitalityWorkspaces.tsx');assert.ok(screen.includes('hospitality-guests/register'));assert.ok(screen.includes("readBackendRecords('hospitality-guests')"));assert.ok(screen.includes("'add-line'"));assert.ok(screen.includes('hospitality-pos-checks/menu?outlet='));assert.ok(screen.includes('Draft total:'))})

test('Phase 1E workspaces expose guarded check-in and supervisor void, without checkout',()=>{const screen=read('screens/HospitalityWorkspaces.tsx');assert.ok(screen.includes("'check-in'"));assert.ok(screen.includes("'void-line'"));assert.ok(screen.includes('!row.voided_at'));assert.ok(!screen.includes("'check-out'"))})
