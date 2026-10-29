import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml } from './html.ts'

test('printable HTML escapes business data and malicious markup', () => {
  assert.equal(escapeHtml('A&B'), 'A&amp;B')
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  assert.equal(escapeHtml(null), '')
})
