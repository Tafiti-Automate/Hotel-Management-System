import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const form = readFileSync(new URL('../../components/FormDrawer.tsx', import.meta.url), 'utf8')

test('supplier quotation wizard exposes visible supplier and article search controls', () => {
  assert.match(form, /Search supplier\/article/)
  assert.match(form, /setStep\(0\); setRequestedSearchField\('article'\)/)
  assert.match(form, /\['supplier', 'article'\]\.includes\(fd\.key\)/)
  assert.match(form, /aria-label=\{`Open \$\{fd\.label\} search`\}/)
  assert.match(form, /input\.showPicker\?\.\(\)/)
})
