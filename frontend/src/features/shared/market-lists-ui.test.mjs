import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const load = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const shell = load('../../screens/AppShell.tsx')
const access = load('../../lib/access.ts')
const nav = load('../../components/Sidebar.tsx')
const page = load('../../screens/MarketLists.tsx')
const styles = load('../../market-lists.css')
const layout = readFileSync(new URL('../../../app/layout.tsx', import.meta.url), 'utf8')
const sourcing = load('../../screens/ProcurementWorkbench.tsx')

test('Market Lists are navigable only by the Department Head in the client role matrix', () => {
  assert.match(shell, /route === 'market-lists'\) content = <MarketLists \/>/)
  assert.match(access, /'market-lists': \['procurement\.add_purchaserequisition'\]/)
  assert.match(access, /'department head': new Set\(\[ 'market-lists'/)
  assert.match(nav, /route: 'market-lists', label: 'Daily Market Lists'/)
  assert.match(layout, /import '\.\.\/src\/market-lists\.css'/)
  assert.match(styles, /\.market-list-columns\s*\{\s*display:grid/)
})

test('Market List UI is quantity-only and protects irreversible transitions', () => {
  assert.match(page, /type="number" inputMode="decimal" min="0\.0001" step="0\.0001"/)
  assert.match(page, /<ConfirmTransaction/)
  assert.match(page, /submit-market-list/)
  assert.match(page, /Market List submission blocked/)
  assert.doesNotMatch(page, /unit_price|discount_percent|estimated_total/)
  assert.match(sourcing, /'store_purchase', 'store_requisition', 'store_shortage', 'market_list'/)
})
