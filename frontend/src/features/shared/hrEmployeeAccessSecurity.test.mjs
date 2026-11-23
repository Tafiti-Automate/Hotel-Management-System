import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')

test('HR staff form never offers credential changes or employee ID editing', () => {
  const ui = read('components/FormDrawer.tsx')
  assert.match(ui, /roleKey === 'hr manager' && fd\.key === 'employeeCode'/)
  assert.match(ui, /roleKey === 'hr manager' && f\.id && fd\.key === 'password'/)
  assert.match(ui, /seed\.branch = app\.data\.branches\.find/)
  assert.match(ui, /System roles, account identifiers and password resets are controlled/)
  assert.match(ui, /f\.entity === 'employees' && roleKey === 'hr manager'/)
})
