import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canAccessRoute } from '../../lib/access.ts'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const ui = read('screens/RoomManagementWorkspace.tsx')
const sidebar = read('components/Sidebar.tsx')
const shell = read('screens/AppShell.tsx')
const nav = read('lib/navigation.ts')
const access = read('lib/access.ts')
const profile = read('screens/HotelProfile.tsx')

test('Room Management is visible to administrators and Front Office Managers', () => {
  assert.match(sidebar, /route: 'front-desk-rooms', label: 'Rooms & room types'/)
  assert.match(sidebar, /route: 'front-desk-rooms', label: 'Room management'/)
  assert.match(shell, /route === 'front-desk-rooms'/)
  assert.match(nav, /'front-desk-rooms': '\/front-desk\/rooms'/)
  assert.match(access, /'front-desk-rooms': \['front office manager'\]/)
  assert.match(profile, /app\.navTo\('front-desk-rooms', 'Rooms & room types'\)/)
})

test('operational users cannot access master configuration', () => {
  const make = role => ({
    role, isSuperuser: false,
    permissions: ['hospitality.view_room', 'hospitality.view_roomtype', 'hospitality.view_reservation'],
  })
  assert.equal(canAccessRoute(make('Front Office Manager'), 'front-desk-rooms'), true)
  assert.equal(canAccessRoute(make('Receptionist'), 'front-desk-rooms'), false)
  assert.equal(canAccessRoute(make('Reservations Agent'), 'front-desk-rooms'), false)
  assert.equal(canAccessRoute(make('Store Keeper'), 'front-desk-rooms'), false)
  assert.equal(canAccessRoute(make('System Administrator'), 'front-desk-rooms'), true)
  assert.equal(canAccessRoute({...make('Receptionist'),isSuperuser:true},'front-desk-rooms'),true)
})

test('room and type forms use protected backend endpoints and property selection', () => {
  assert.match(ui, /readBackendRecords\('hospitality-room-types'\)/)
  assert.match(ui, /readBackendRecords\('hospitality-rooms'\)/)
  assert.match(ui, /createBackendRecord\('hospitality-room-types'/)
  assert.match(ui, /createBackendRecord\('hospitality-rooms'/)
  assert.match(ui, /updateBackendRecord\('hospitality-room-types'/)
  assert.match(ui, /updateBackendRecord\('hospitality-rooms'/)
  assert.match(ui, /roomTypes\.filter\(type => type\.is_active/)
  assert.match(ui, /branch:.*room_type|branch, room_type:/)
  assert.doesNotMatch(ui, /deleteBackendRecord\(/)
})

test('Room Management screens and styles expose protected occupancy state', () => {
  assert.match(ui, /Room Management/)
  assert.match(ui, /Room types/)
  assert.match(ui, /Room number/)
  assert.match(ui, /Housekeeping/)
  assert.match(ui, /operational status/)
  assert.match(read('hospitality-workspaces.css'), /\.rm-split/)
  assert.match(read('hospitality-workspaces.css'), /\.rm-table/)
})
