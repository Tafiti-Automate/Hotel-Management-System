import type { Row } from './data'

const str = (value: unknown) => String(value ?? '').trim()
const numeric = (value: unknown) => Number(value)
const day = (value: unknown) => str(value).slice(0, 10)
const utcDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const timestamp = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0,10) === value ? timestamp : NaN
}
export const businessDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$1-$2')

export function validity(value: unknown, today: string) {
  const expiry = day(value)
  if (!expiry) return {valid: false, label:'Expiry not recorded', tone:'neutral' as const, days: null}
  const difference = (utcDay(expiry) - utcDay(today)) / 86400000
  if (!Number.isFinite(difference)) return {valid:false,label:'Invalid expiry date',tone:'bad' as const,days:null}
  if (difference < 0) return {valid:false,label:`Expired ${Math.abs(difference)} day${difference===-1?'':'s'} ago · ${expiry}`,tone:'bad' as const,days:difference}
  if (difference === 0) return {valid:true,label:`Expires today · ${expiry}`,tone:'warn' as const,days:difference}
  return {valid:true,label:`Expires in ${difference} day${difference===1?'':'s'} · ${expiry}`,tone:difference<=14?'warn' as const:'good' as const,days:difference}
}
export function comparableQuote(quote: Row, article: Row | null, conversions: Row[], today: string) {
  const currency = (str(quote.currency) || 'UGX').toUpperCase()
  const unitId = str(quote.unitId)
  const baseId = str(article?.baseUnitId)
  const mapped = conversions.find(row=>str(row.itemId)===str(article?.id) && str(row.unitId)===unitId && str(row.status).toLowerCase()==='active')
  const factor = unitId && baseId && unitId===baseId ? 1 : mapped ? numeric(mapped.conversionFactor) : NaN
  // Backend computes discount-adjusted price; never silently substitute raw pack price.
  const basePrice = quote.basePrice == null ? NaN : numeric(quote.basePrice)
  const packPrice = numeric(quote.price)
  const expiry = validity(quote.quotationValidUntil,today)
  const from = day(quote.effectiveFrom)
  const started = Boolean(from) && Number.isFinite(utcDay(from)) && from <= today
  const eligible = str(quote.status).toLowerCase()==='active' && expiry.valid && started
    && Number.isFinite(factor) && factor>0 && Number.isFinite(basePrice) && basePrice>0
    && Number.isFinite(packPrice) && packPrice>0
  const reason = str(quote.status).toLowerCase()!=='active' ? 'Quotation inactive'
    : !expiry.valid ? expiry.label
    : !started ? 'Quotation not yet effective or missing effective date'
    : !(Number.isFinite(factor) && factor>0) ? 'Missing approved UOM conversion'
    : !(Number.isFinite(basePrice) && basePrice>0) ? 'Normalized price unavailable'
    : !(Number.isFinite(packPrice) && packPrice>0) ? 'Invalid quoted price' : 'Eligible quotation'
  return {quote,currency,basePrice,factor,expiry,eligible,reason}
}
export type ComparedQuote = ReturnType<typeof comparableQuote>
export function rankedQuotes(rows: ComparedQuote[]) {
  const currencySet = new Set(rows.filter(row=>row.eligible).map(row=>row.currency))
  const comparable = currencySet.size===1 ? rows.filter(row=>row.eligible) : []
  return comparable.sort((a,b)=>
    a.basePrice-b.basePrice ||
    (Number.isFinite(Number(a.quote.leadTime))?Number(a.quote.leadTime):Number.MAX_SAFE_INTEGER) -
    (Number.isFinite(Number(b.quote.leadTime))?Number(b.quote.leadTime):Number.MAX_SAFE_INTEGER) ||
    (b.expiry.days ?? 0)-(a.expiry.days ?? 0) ||
    str(a.quote.supplier).localeCompare(str(b.quote.supplier))
  )
}
