import test from 'node:test'
import assert from 'node:assert/strict'
import { operationalStatus,stockSignal,varianceSignal,invoiceDueSignal,daysUntil,calendarDateInKampala,recordedNumber,signalPalette } from '../../lib/operationalSignals.ts'
import { buildOperationalReport } from '../../lib/reports.ts'

test('operational colours distinguish partial, completed, posted and inactive records',()=>{
  assert.equal(operationalStatus('partially_issued').tone,'attention')
  assert.equal(operationalStatus('approved').tone,'good')
  assert.equal(operationalStatus('posted').tone,'financial')
  assert.equal(operationalStatus('inactive').tone,'neutral')
  assert.equal(operationalStatus('pending approval').tone,'pending')
  assert.equal(operationalStatus('unrecognized state').tone,'neutral')
  assert.equal(operationalStatus('released').tone,'progress')
})
test('stock indicators use availability and actual reorder limits, not reservations as issued stock',()=>{
  assert.equal(stockSignal('0','10','5').label,'Unavailable — allocated / held')
  assert.equal(stockSignal('0','0','5').label,'Out of stock')
  assert.equal(stockSignal('2.5000','3','5').label,'Critical stock')
  assert.equal(stockSignal('2.5001','3','5').label,'Low stock')
  assert.equal(stockSignal('5.0001','6','5').label,'Available')
  assert.equal(stockSignal('2','2','0').label,'Available')
  assert.equal(stockSignal(null,'10','5').tone,'neutral')
})
test('missing amounts are not zero and variance sign is preserved',()=>{
  for(const input of [null,undefined,'',false,'n/a'])assert.equal(recordedNumber(input),null)
  assert.equal(varianceSignal('0.0000').label,'Balanced')
  assert.equal(varianceSignal('-0.0001').tone,'danger')
  assert.equal(varianceSignal('0.0001').tone,'pending')
  assert.equal(varianceSignal(null).tone,'neutral')
})
test('invoice ageing uses calendar dates, actual outstanding balance and Kampala midnight',()=>{
  assert.equal(calendarDateInKampala(new Date('2026-11-24T21:01:00Z')),'2026-11-25')
  assert.equal(daysUntil('2026-11-25','2026-11-24'),1)
  assert.equal(daysUntil('2026-02-30','2026-02-27'),null)
  assert.equal(invoiceDueSignal('100','2026-11-23','approved','2026-11-24').label,'1 day overdue')
  assert.equal(invoiceDueSignal('100','2026-11-24','approved','2026-11-24').tone,'attention')
  assert.equal(invoiceDueSignal('100','2026-12-01','approved','2026-11-24').tone,'pending')
  assert.equal(invoiceDueSignal('100','2026-12-02','approved','2026-11-24').tone,'good')
  assert.equal(invoiceDueSignal('0','2026-11-23','paid','2026-11-24').tone,'neutral')
  assert.equal(invoiceDueSignal('10','2026-11-23','paid','2026-11-24').tone,'attention')
  assert.equal(invoiceDueSignal(null,'2026-11-23','approved','2026-11-24').tone,'neutral')
})
test('dynamic stocktake reports attach export colours without converting missing values to zero',()=>{
  const report=buildOperationalReport('stockTakeLinewise',{columns:[{key:'variance',label:'Variance',kind:'number'},{key:'variance_value',label:'Variance value',kind:'money'},{key:'status',label:'Status'}],results:[{variance:'-1.1250',variance_value:null,status:'booked'}]})
  assert.equal(report.rows[0].cells[0].expiryTone,'signal:danger')
  assert.equal(report.rows[0].cells[1].expiryTone,'signal:neutral')
  assert.match(report.rows[0].cells[1].text,/Not valued/)
  assert.equal(report.rows[0].cells[2].expiryTone,'signal:financial')
})
test('every signal palette has readable contrast on its own background',()=>{
  const luminance=hex=>{const n=parseInt(hex.slice(1),16);return [16,8,0].map(shift=>((n>>shift)&255)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0)}
  for(const {color,background} of Object.values(signalPalette))assert.ok((luminance(background)+.05)/(luminance(color)+.05)>=4.5)
})
