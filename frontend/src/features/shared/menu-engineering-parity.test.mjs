import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync(
  new URL('../enterprise/OperationsAdmin.tsx', import.meta.url), 'utf8',
)

test('Menu Engineering displays authoritative Django classifications, not a second median rule', () => {
  assert.match(ui, /row\.classification/)
  assert.match(ui, /unit_contribution/)
  assert.match(ui, /categoryNames/)
  assert.doesNotMatch(ui, /const median=/)
  assert.doesNotMatch(ui, /marginThreshold=median/)
  assert.match(ui, /Unclassified/)
  assert.match(ui, /Historical unit contribution/)
  assert.match(ui, /costs captured when POS sales|frozen historical recipe COGS|immutable recipe cost snapshots/i)
})
