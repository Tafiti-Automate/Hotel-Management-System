import test from 'node:test'
import assert from 'node:assert/strict'
import { formWizardPages } from './formWizard.ts'

const fields = (keys) => keys.map((key) => ({ key }))

test('supplier quotations use three complete, logically grouped pages', () => {
  const pages = formWizardPages('supplierItems', fields([
    'supplier', 'article', 'unit', 'supplierSku',
    'quotationReference', 'quotationValidUntil', 'price', 'currency',
    'effectiveFrom', 'minimumOrder', 'leadTime', 'lastQuoted', 'status',
  ]))

  assert.deepEqual(pages.map((page) => page.map((field) => field.key)), [
    ['supplier', 'article', 'unit', 'supplierSku'],
    ['quotationReference', 'quotationValidUntil', 'price', 'currency'],
    ['effectiveFrom', 'minimumOrder', 'leadTime', 'lastQuoted', 'status'],
  ])
  assert.equal(pages.length, 3)
  assert.ok(pages.every((page) => page.length > 1))
})

test('other long forms retain four fields per page', () => {
  assert.deepEqual(
    formWizardPages('suppliers', fields(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).map((page) => page.length),
    [4, 3],
  )
})
