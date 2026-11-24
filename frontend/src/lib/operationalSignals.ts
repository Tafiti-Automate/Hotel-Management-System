/** Display-only signals. Never authorise transactions or change balances here. */
export type SignalTone = 'good' | 'pending' | 'attention' | 'danger' | 'progress' | 'financial' | 'neutral'
export type Signal = {label: string; tone: SignalTone}
export const signalPalette: Record<SignalTone, {color:string; background:string}> = {
  good: {color:'#166534',background:'#dcfce7'},
  pending: {color:'#854d0e',background:'#fef3c7'},
  attention: {color:'#9a3412',background:'#ffedd5'},
  danger: {color:'#991b1b',background:'#fee2e2'},
  progress: {color:'#1e40af',background:'#dbeafe'},
  financial: {color:'#5b21b6',background:'#ede9fe'},
  neutral: {color:'#334155',background:'#e2e8f0'},
}

const known: Record<SignalTone,string[]> = {
  good: ['approved','accepted','completed','received','active','available','in_stock','valid','balanced','successful','verified','published','matched'],
  pending: ['pending','requested','pending_approval','pending_department_approval','pending_stores_approval','awaiting_procurement','awaiting_approval','awaiting_finance','awaiting_management','planned','count_pending','due_soon','expires_today'],
  attention: ['partially_approved','partially_issued','partially_received','partially_paid','partial','low_stock','critical','expiring_soon','surplus','missing_expiry','missing_valuation','unavailable','unposted'],
  danger: ['rejected','failed','error','exception','variance_alert','expired','overdue','out_of_stock','shortage','blocked'],
  progress: ['submitted','in_progress','counting','packed','dispatched','in_transit','issued','released','open','processing'],
  financial: ['posted','booked','applied','reconciled','paid','settled','closed'],
  neutral: ['draft','inactive','cancelled','canceled','void','not_applicable','unknown'],
}
const byStatus = new Map<string,SignalTone>(Object.entries(known).flatMap(([tone,values])=>values.map(value=>[value,tone as SignalTone] as const)))
export function operationalStatus(value: unknown): Signal {
  const raw = String(value ?? '').trim()
  const key = raw.toLowerCase().replace(/[\s/-]+/g,'_')
  return {label:raw ? raw.replace(/_/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase()) : 'Unknown',tone:byStatus.get(key) ?? 'neutral'}
}
export function signalStyle(tone: SignalTone) {
  return {...signalPalette[tone],fontWeight:650,display:'inline-flex',alignItems:'center',borderRadius:5,padding:'3px 7px',fontSize:11,lineHeight:1.4}
}
export function recordedNumber(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim()==='') return null
  const n=Number(value)
  return Number.isFinite(n)?n:null
}
export function stockSignal(available:unknown, onHand:unknown, reorder:unknown): Signal {
  const a=recordedNumber(available), h=recordedNumber(onHand), r=recordedNumber(reorder)
  if(a===null || h===null || a<0 || h<0) return {label:'Stock unavailable',tone:'neutral'}
  if(a===0) return h===0?{label:'Out of stock',tone:'danger'}:{label:'Unavailable — allocated / held',tone:'attention'}
  if(r!==null && r>0 && a<=r/2) return {label:'Critical stock',tone:'attention'}
  if(r!==null && r>0 && a<=r) return {label:'Low stock',tone:'pending'}
  return {label:'Available',tone:'good'}
}
export function varianceSignal(value:unknown):Signal {
  const n=recordedNumber(value)
  return n===null?{label:'Not valued / counted',tone:'neutral'}:n<0?{label:'Shortage',tone:'danger'}:n>0?{label:'Surplus — review',tone:'pending'}:{label:'Balanced',tone:'good'}
}
export function calendarDateInKampala(now:Date=new Date()):string {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Kampala',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  return ['year','month','day'].map(key=>parts.find(part=>part.type===key)?.value ?? '').join('-')
}
function dateNumber(value:unknown):number|null {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null
  const timestamp=Date.parse(value+'T00:00:00Z')
  return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value?timestamp:null
}
export function daysUntil(date:unknown,asOf=calendarDateInKampala()):number|null {
  const a=dateNumber(asOf),b=dateNumber(date)
  return a===null||b===null?null:(b-a)/86400000
}
export function invoiceDueSignal(balance:unknown,dueDate:unknown,status:unknown,asOf=calendarDateInKampala()):Signal {
  const key=String(status??'').trim().toLowerCase()
  const n=recordedNumber(balance)
  if(['cancelled','canceled','void','rejected'].includes(key))return {label:'Not payable',tone:'neutral'}
  if(n===null||n<0)return {label:'Balance not confirmed',tone:'neutral'}
  if(n===0)return {label:'No outstanding balance',tone:'neutral'}
  if(['paid','settled','closed'].includes(key))return {label:'Balance requires reconciliation',tone:'attention'}
  const days=daysUntil(dueDate,asOf)
  if(days===null)return {label:'Due date missing',tone:'attention'}
  if(days<0)return {label:Math.abs(days)+' day'+(days===-1?'':'s')+' overdue',tone:'danger'}
  if(days===0)return {label:'Due today',tone:'attention'}
  return {label:'Due in '+days+' day'+(days===1?'':'s'),tone:days<=7?'pending':'good'}
}

export const invoiceAgeBuckets = ['Not yet due / due today','1–30 days overdue','31–60 days overdue','61–90 days overdue','Over 90 days overdue','Needs reconciliation','No outstanding / excluded'] as const
export type InvoiceAgeBucket = typeof invoiceAgeBuckets[number]
export function invoiceAgeBucket(balance:unknown,dueDate:unknown,status:unknown,asOf=calendarDateInKampala()):InvoiceAgeBucket {
  const signal=invoiceDueSignal(balance,dueDate,status,asOf)
  if(signal.label==='Not payable'||signal.label==='No outstanding balance')return invoiceAgeBuckets[6]
  if(['Balance not confirmed','Balance requires reconciliation','Due date missing'].includes(signal.label))return invoiceAgeBuckets[5]
  const days=daysUntil(dueDate,asOf)
  if(days===null)return invoiceAgeBuckets[5]
  return days>=0?invoiceAgeBuckets[0]:days>=-30?invoiceAgeBuckets[1]:days>=-60?invoiceAgeBuckets[2]:days>=-90?invoiceAgeBuckets[3]:invoiceAgeBuckets[4]
}
