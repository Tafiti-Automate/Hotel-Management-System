import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canAccessRoute } from '../../lib/access.ts'
const read = p => readFileSync(new URL('../../'+p,import.meta.url),'utf8')
const routes = ["front-office-dashboard","front-desk-rooms","front-desk-reservations","front-office-arrivals","front-office-inhouse","front-office-departures","front-office-assignments","front-office-housekeeping","front-office-guests","front-office-folios","front-office-cashier","front-office-night-audit","front-office-reports","front-office-config"]
test('All Front Office Manager links resolve to dedicated routes and workspaces', () => {
 const sidebar=read('components/Sidebar.tsx'),nav=read('lib/navigation.ts'),shell=read('screens/AppShell.tsx')
 for (const route of routes) {
   assert.ok(sidebar.includes("route: '"+route+"'"),route)
   assert.ok(nav.includes("'"+route+"'"),route)
   assert.ok(shell.includes(route) || ['front-office-dashboard','front-office-arrivals'].includes(route),route)
 }
})
test('Front Office Manager navigation excludes Receptionist and other operations roles',()=>{
 const user=role=>({role,isSuperuser:false,permissions:['hospitality.view_room','hospitality.view_reservation','hospitality.view_roomtype']})
 for(const route of routes){
   assert.equal(canAccessRoute(user('Front Office Manager'),route),true,route)
   assert.equal(canAccessRoute(user('Receptionist'),route),false,route)
   assert.equal(canAccessRoute(user('Store Keeper'),route),false,route)
 }
})
test('Unsafe payments and check-out are not posted from review screens',()=>{
 const ui=read('screens/FrontOfficeWorkspace.tsx')
 assert.match(ui,/runBackendAction\('hospitality-rooms'/)
 assert.match(ui,/runBackendAction\('hospitality-reservations'/)
 assert.doesNotMatch(ui,/createBackendRecord\(/)
 assert.match(ui,/check-out is blocked/)
 assert.match(ui,/Night audit closing is not enabled/)
 assert.doesNotMatch(ui,/runBackendAction\('hospitality-reservations',\s*[^\n]+,\s*'check-out'/)
})
