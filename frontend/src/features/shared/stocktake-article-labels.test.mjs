import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../enterprise/OperationsAdmin.tsx', import.meta.url), 'utf8')
const serializer = readFileSync(new URL('../../../../hotel_erp_backend/apps/inventory/serializers.py', import.meta.url), 'utf8')

test('Store Keeper stocktake shows article names and SKUs instead of raw UUIDs', () => {
  const start = ui.indexOf('export function EnterpriseStocktakeSheet()')
  const end = ui.indexOf('export function EnterpriseRecipeDetail()', start)
  assert.ok(start !== -1 && end > start)
  const screen = ui.slice(start, end)
  assert.match(screen, /const articleName=\(line:ApiRow\)=>str\(line.item_name/)
  assert.match(screen, /const articleSku=\(line:ApiRow\)=>str\(line.item_sku/)
  assert.match(screen, /<td><b>\{articleName\(line\)\}<\/b>/)
  assert.match(screen, /aria-label=\{'Physical count for '\+articleName\(line\)\}/)
  assert.match(screen, /esc\(articleName\(line\)\)/)
  assert.match(screen, /esc\(articleUnit\(line\)\)/)
  assert.doesNotMatch(screen, /str\(line.item_name\|\|line.item\)/)
})

test('stocktake API includes article identity without exposing blind theoretical counts', () => {
  const start = serializer.indexOf('class StockCountItemSerializer(')
  const end = serializer.indexOf('class StockCountSerializer(', start)
  assert.ok(start !== -1 && end > start)
  const code = serializer.slice(start, end)
  assert.match(code, /item_name = serializers.CharField\(source="item.name", read_only=True\)/)
  assert.match(code, /item_sku = serializers.CharField\(source="item.sku", read_only=True\)/)
  assert.match(code, /unit_name = serializers.SerializerMethodField\(\)/)
  assert.match(code, /"system_quantity", "variance", "variance_value"/)
})

test('Cost Controller stocktake variance identifies articles by name', () => {
  const start = ui.indexOf('export function EnterpriseStocktakeVariance()')
  assert.ok(start !== -1)
  const screen = ui.slice(start, ui.indexOf('export function ', start + 1) > 0 ? ui.indexOf('export function ', start + 1) : undefined)
  assert.match(screen, /const articleName=\(line:ApiRow\)=>str\(line.item_name/)
  assert.match(screen, /label:'Article',value:r=>articleName\(r\)/)
})
