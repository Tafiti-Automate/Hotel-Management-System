import test from 'node:test'
import assert from 'node:assert/strict'
import { reportPreferenceKey,normalizeReportPreferences } from '../../lib/reportPreferences.ts'
test('report preferences isolate role, user and property and reject anonymous scope',()=>{
  const key=reportPreferenceKey('u1','Cost Controller','Property A')
  assert.notEqual(key,reportPreferenceKey('u2','Cost Controller','Property A'))
  assert.notEqual(key,reportPreferenceKey('u1','Financial Manager','Property A'))
  assert.notEqual(key,reportPreferenceKey('u1','Cost Controller','Property B'))
  assert.equal(reportPreferenceKey('','Cost Controller','Property A'),'')
})
test('report preferences store only whitelisted criteria and IDs',()=>{
  const prefs=normalizeReportPreferences({favorites:['aging','aging',123,'<bad>'],recent:['movement'],saved:{aging:{mode:'summary',groupIndex:3,item:'123',employee:'private',search:'private',results:[1],dateFrom:'2026-11-01'}}})
  assert.deepEqual(prefs.favorites,['aging'])
  assert.equal(prefs.saved.aging.mode,'summary')
  assert.equal(prefs.saved.aging.item,'123')
  assert.equal(prefs.saved.aging.dateFrom,'2026-11-01')
  assert.equal(prefs.saved.aging.search,undefined)
  assert.equal(prefs.saved.aging.results,undefined)
  assert.equal(prefs.saved.aging.employee,undefined)
})
