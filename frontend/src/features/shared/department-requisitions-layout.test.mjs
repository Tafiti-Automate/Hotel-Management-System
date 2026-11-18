import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Regression: these two CSS assets were present in the repository but missing
// from the Next.js root layout. Without them the summary becomes vertical
// cards and requisitions collapse into unstyled text buttons.
const layout = readFileSync(new URL('../../../app/layout.tsx', import.meta.url), 'utf8')
const base = readFileSync(new URL('../../responsive.css', import.meta.url), 'utf8')
const fixes = readFileSync(new URL('../../department-requisitions-fix.css', import.meta.url), 'utf8')
const requisitions = readFileSync(new URL('../../screens/DepartmentRequisitions.tsx', import.meta.url), 'utf8')

test('production layout imports department requisition base and final scoped fixes', () => {
  assert.match(layout, /import ['"]\.\.\/src\/responsive\.css['"]/)
  assert.match(layout, /import ['"]\.\.\/src\/department-requisitions-fix\.css['"]/)
  assert.ok(layout.indexOf('responsive.css') < layout.indexOf('ui-v3.css'))
  assert.ok(layout.indexOf('department-requisitions-fix.css') > layout.indexOf('hotel-evergreen-unified.css'))
})

test('essential requisition grids and responsive master/detail styles are never undefined', () => {
  for (const className of [
    'hod-kpi-grid', 'hod-kpi-card', 'hod-workspace', 'hod-list-heading',
    'hod-filters', 'hod-request-row', 'hod-detail-panel', 'hod-form-grid',
  ]) {
    assert.ok(base.includes('.' + className), className + ' must exist in loaded base CSS')
    assert.ok(requisitions.includes(className), className + ' is used by the rendered page')
  }
  assert.match(fixes, /\.screen-app \.hod-kpi-grid\s*\{\s*display:\s*grid\s*!important/)
  assert.match(fixes, /\.screen-app \.hod-workspace\s*\{\s*display:\s*grid\s*!important/)
  assert.match(fixes, /\.screen-app \.hod-request-row\s*\{[^}]*display:\s*grid\s*!important/s)
})

test('one-column mobile layout retains request filters and the selected record', () => {
  assert.match(fixes, /@media \(max-width:\s*760px\)/)
  assert.match(fixes, /\.hod-filters\.mobile-open\s*\{[^}]*display:\s*grid\s*!important/s)
  assert.match(fixes, /\.hod-workspace\.has-selection \.hod-list-panel\s*\{\s*display:\s*none\s*!important/s)
  assert.match(fixes, /\.hod-workspace\.has-selection \.hod-detail-panel\s*\{\s*display:\s*flex\s*!important/s)
  assert.match(fixes, /\.screen-app \.hod-article-options\s*\{/)
  assert.doesNotMatch(fixes, /\.screen-app \.tafiti-sidebar/)
})
