import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const load = (path) => readFileSync(new URL('../../../' + path, import.meta.url), 'utf8')
const css = load('src/hotel-evergreen-unified.css')
const layout = load('app/layout.tsx')
const header = load('src/components/Header.tsx')
const sidebar = load('src/components/Sidebar.tsx')
const shell = load('src/screens/AppShell.tsx')

test('approved palette loads after legacy navy CSS', () => {
  assert.ok(layout.indexOf('hospitality-precision.css') < layout.indexOf('hotel-evergreen-unified.css'))
  for (const color of ['#17382C', '#176A49', '#BD8F48', '#F7F8F5', '#FFFFFF', '#1C2924']) {
    assert.ok(css.includes(color), 'Missing approved color: ' + color)
  }
})
test('shared design covers all five key workspaces and other role screens', () => {
  for (const token of ['.neo-sidebar', '.neo-header', '.neo-workspace', '.mc-dense-panel', '.bp-panel', '.ds-detail', '.mc-invoice-detail']) {
    assert.ok(css.includes(token), 'Missing UI selector: ' + token)
  }
  assert.ok(shell.includes('EnterpriseBlindReceiving'))
  assert.ok(shell.includes('GrnPostingConsole'))
  assert.ok(shell.includes('EnterpriseInvoiceMatching'))
})
test('topbar keeps secure property selector while page title has its own row', () => {
  assert.ok(!header.split('</header>')[0].includes('<h1>'))
  assert.ok(header.includes('erp-page-heading'))
  assert.ok(header.includes('neo-property-chip'))
  assert.ok(header.includes('canSwitchBranches(app.user)'))
  assert.ok(header.includes('CommandPalette'))
  assert.ok(sidebar.includes('Materials &amp; Cost Control'))
  assert.ok(shell.includes("content = role === 'department head'"))
  assert.ok(css.includes('@media print'))
  assert.ok(css.includes(':focus-visible'))
})
