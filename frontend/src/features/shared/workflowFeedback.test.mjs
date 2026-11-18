import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import WorkflowPrerequisite from '../../components/WorkflowPrerequisite.tsx'

const render = props => renderToStaticMarkup(React.createElement(WorkflowPrerequisite, props))

test('blocked procurement and stores actions explain the next prerequisite accessibly', () => {
  for (const [domain, record, action, expected] of [
    ['purchase_order',{status:'draft'},'issue',/approval/i],
    ['goods_receipt',{status:'draft'},'post',/counted/i],
    ['supplier_invoice',{status:'exception'},'approve',/match/i],
    ['stock_count',{status:'submitted'},'submit',/locked/i],
    ['supplier_return',{status:'posted'},'apply',/cannot/i],
    ['department_return',{inventory_changes_applied:true},'apply',/already been posted/i],
  ]) {
    const html = render({domain,record,action})
    assert.match(html,/role="status"/)
    assert.match(html,/aria-live="polite"/)
    assert.match(html,/Next:/)
    assert.match(html,expected)
  }
})

test('allowed workflow states do not create distracting banners', () => {
  assert.equal(render({domain:'purchase_order',record:{status:'approved'},action:'issue'}),'')
  assert.equal(render({domain:'supplier_invoice',record:{status:'matched'},action:'approve'}),'')
})
