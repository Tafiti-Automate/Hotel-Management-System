import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const layout = readFileSync(new URL('../../../app/layout.tsx', import.meta.url), 'utf8')
const foundation = readFileSync(new URL('../../design-foundation.css', import.meta.url), 'utf8')

test('approved palette precedes the shared foundation and operational print styles follow', () => {
  const evergreen = layout.indexOf("import '../src/hotel-evergreen-unified.css'")
  const design = layout.indexOf("import '../src/design-foundation.css'")
  const grnPrint = layout.indexOf("import '../src/grn-reference-exact.css'")
  assert.ok(evergreen !== -1 && evergreen < design && design < grnPrint)
})

test('semantic tokens and opt-in primitives exist without mutating transactions', () => {
  for (const token of ['--ds-canvas:', '--ds-primary:', '--ds-danger:', '--ds-warning:', '--ds-border:']) {
    assert.ok(foundation.includes(token), `Missing ${token}`)
  }
  for (const cls of ['.ds-panel', '.ds-field', '.ds-table-scroll', '.ds-status', ':focus-visible']) {
    assert.ok(foundation.includes(cls), `Missing ${cls}`)
  }
  assert.ok(foundation.includes('@media (max-width: 680px)'))
  assert.ok(foundation.includes('@media (prefers-reduced-motion: reduce)'))
})
