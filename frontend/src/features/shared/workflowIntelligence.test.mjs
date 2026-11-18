import test from 'node:test'
import assert from 'node:assert/strict'
import { explainWorkflowAction } from './workflowIntelligence.ts'

test('unapproved LPO cannot issue, shows exact approval prerequisite', () => {
  const result = explainWorkflowAction('purchase_order', { status: 'pending_approval' }, 'issue')
  assert.equal(result.allowed, false)
  assert.match(result.message, /cannot be issued/i)
  assert.match(result.next, /approval history/i)
  assert.equal(explainWorkflowAction('purchase_order', { status: 'approved' }, 'issue').allowed, true)
})

test('payment submission, approval and release are guided without claiming settlement', () => {
  const empty = explainWorkflowAction('supplier_payment', null, 'authorize')
  assert.equal(empty.allowed, false)
  assert.match(empty.next, /select/i)
  const draft = explainWorkflowAction('supplier_payment', { status: 'draft' }, 'authorize')
  assert.equal(draft.allowed, false)
  const pending = explainWorkflowAction('supplier_payment', { status: 'submitted' }, 'authorize')
  assert.equal(pending.allowed, true)
  const release = explainWorkflowAction('supplier_payment', { status: 'approved' }, 'release')
  assert.equal(release.allowed, true)
  assert.match(release.message, /not paid/i)
  assert.equal(explainWorkflowAction('supplier_payment', { status: 'released' }, 'settle').allowed, false)
})

test('receiving, inventory and invoice matching never auto-override safeguards', () => {
  assert.equal(explainWorkflowAction('goods_receipt', { status: 'draft' }, 'post').allowed, false)
  assert.equal(explainWorkflowAction('supplier_invoice', { status: 'exception' }, 'approve').allowed, false)
  assert.equal(explainWorkflowAction('stock_adjustment', { status: 'pending' }, 'apply').allowed, false)
  assert.equal(explainWorkflowAction('stock_adjustment', { status: 'approved' }, 'apply').allowed, true)
  assert.equal(explainWorkflowAction('stock_issue', { status: 'pending' }, 'acknowledge').allowed, false)
})
