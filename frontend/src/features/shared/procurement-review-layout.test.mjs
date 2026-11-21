import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../../screens/ProcurementWorkbench.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../../procurement-workspace.css', import.meta.url), 'utf8')

test('purchase request review replaces the queue with a full-width working page', () => {
  assert.match(ui, /const isPurchaseRequestReview = stage === 'quote' && Boolean\(form\.requisition\)/)
  assert.match(ui, /!isPurchaseRequestReview && <section className="procurement-queue-card"/)
  assert.match(ui, /procurement-review-page/)
  assert.match(ui, /Back to purchase requests/)
  assert.match(styles, /\.procurement-workbench-grid\.is-review-page/)
  assert.match(styles, /\.procurement-detail-panel\.procurement-review-page/)
  assert.match(styles, /max-height: none !important/)
})
