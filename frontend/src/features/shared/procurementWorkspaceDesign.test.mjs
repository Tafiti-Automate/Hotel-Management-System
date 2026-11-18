import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const root = new URL('../../', import.meta.url)
const pf=readFileSync(new URL('features/enterprise/ProcurementFinance.tsx',root),'utf8')
const returns=readFileSync(new URL('features/enterprise/OperationsAdmin.tsx',root),'utf8')
const kit=readFileSync(new URL('features/enterprise/workspaceKit.tsx',root),'utf8')
const layout=readFileSync(new URL('../app/layout.tsx',root),'utf8')
const styles=readFileSync(new URL('procurement-workspace.css',root),'utf8')
test('procurement, approval and supplier returns use shared read-only metrics',()=>{
  assert.ok(kit.includes('export function OperationalSummary'))
  for(const key of ['Quotation workload','Approval workload','Purchase order preparation'])assert.ok(pf.includes(key),key)
  assert.ok(returns.includes('Supplier return workload'))
  assert.ok(returns.includes('Awaiting acknowledgement'))
})
test('critical approval and supplier return server actions remain guarded',()=>{
  for(const action of ["'purchase-orders'","'approve'","'reject'"])assert.ok(pf.includes(action),action)
  assert.ok(returns.includes("'supplier-returns',draftId,'apply'"))
  assert.ok(returns.includes("Posting reduces store stock once"))
  assert.ok(returns.includes("step=\"0.0001\""))
})
test('shared palette loads before procurement styles and GRN print remains last',()=>{
  const p=layout.indexOf("import '../src/procurement-workspace.css'")
  assert.ok(p>layout.indexOf("import '../src/design-foundation.css'"))
  assert.ok(p<layout.indexOf("import '../src/grn-reference-exact.css'"))
  assert.ok(styles.includes('@media (max-width: 680px)'))
  assert.ok(!styles.includes('.grn-reference-page'))
})
