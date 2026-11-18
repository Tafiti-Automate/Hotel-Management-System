import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {validity,comparableQuote,rankedQuotes} from '../../lib/quotationComparison.ts'
const today='2026-11-18'
const article={id:'a',baseUnitId:'ream',uom:'Ream'}
const conversion=[{itemId:'a',unitId:'carton',conversionFactor:5,status:'Active'}]
const quote=(id,price,basePrice,unitId,expires='2026-12-01',leadTime=7)=>({id,price,basePrice,unitId,quotationValidUntil:expires,effectiveFrom:'2026-01-01',status:'Active',currency:'UGX',leadTime,supplier:id})
test('carton quoted cost normalizes using configured article conversion',()=>{
 const carton=comparableQuote(quote('carton',92500,18500,'carton'),article,conversion,today)
 const ream=comparableQuote(quote('ream',25000,25000,'ream'),article,conversion,today)
 assert.equal(carton.factor,5)
 assert.equal(rankedQuotes([ream,carton])[0].quote.id,'carton')
})
test('expired and future quotes are ineligible for recommendation',()=>{
 const expired=comparableQuote(quote('expired',12000,12000,'ream','2026-11-03'),article,conversion,today)
 const future=comparableQuote({...quote('future',12000,12000,'ream'),effectiveFrom:'2026-12-01'},article,conversion,today)
 assert.equal(expired.eligible,false)
 assert.match(validity('2026-11-03',today).label,/Expired 15 days/)
 assert.equal(future.eligible,false)
 assert.equal(rankedQuotes([expired,future]).length,0)
})
test('missing conversion and missing expiry are never guessed',()=>{
 assert.equal(comparableQuote(quote('unknown',9000,9000,'pallet'),article,conversion,today).eligible,false)
 assert.equal(comparableQuote(quote('undated',9000,9000,'ream',''),article,conversion,today).eligible,false)
})
test('tie-breaker prefers faster delivery and excludes mixed currencies',()=>{
 const a=comparableQuote(quote('slow',25000,25000,'ream','2026-12-01',7),article,conversion,today)
 const b=comparableQuote(quote('fast',25000,25000,'ream','2026-12-01',3),article,conversion,today)
 assert.equal(rankedQuotes([a,b])[0].quote.id,'fast')
 assert.equal(rankedQuotes([a,{...b,currency:'USD'}]).length,0)
})
test('comparison and API badge reject raw price-only and expired recommendations',()=>{
 const ui=readFileSync(new URL('../../screens/SupplierQuotationOptionOne.tsx',import.meta.url),'utf8')
 const backend=readFileSync(new URL('../../../../hotel_erp_backend/apps/inventory/serializers.py',import.meta.url),'utf8')
 assert.ok(ui.includes('rankedQuotes(eligibleQuotes)'))
 assert.ok(ui.includes('Lowest eligible price'))
 assert.ok(backend.includes('quotation_valid_until__gte=today'))
})
