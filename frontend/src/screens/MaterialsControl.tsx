import SearchableSelect from '../components/SearchableSelect'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import {
  createBackendRecord,
  downloadGLExport,
  errorMessage,
  readBackendRecords,
  runBackendAction,
} from '../lib/api'
import type { Row } from '../lib/data'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

export type MaterialsSection = 'waste' | 'recipes' | 'pos' | 'governance' | 'integrations'

const id = (value: unknown) => String(value ?? '')
const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => `${today().slice(0, 7)}-01`
const titleCase = (value: unknown) => id(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

const sectionMeta: Record<MaterialsSection, { eyebrow: string; title: string; description: string; icon: string }> = {
  waste: { eyebrow: 'Outlet control', title: 'Waste & variance control', description: 'Record operational waste at source, reduce stock once, and route exceptions for independent review.', icon: 'delete_sweep' },
  recipes: { eyebrow: 'Production control', title: 'Recipe costing', description: 'Maintain recipe yields, ingredient conversions, trim factors, and current food-cost targets.', icon: 'menu_book' },
  pos: { eyebrow: 'Cost control', title: 'POS depletion control', description: 'Map sales PLUs to published recipes and post ingredient usage without duplicate inventory movements.', icon: 'point_of_sale' },
  governance: { eyebrow: 'Finance control', title: 'Budgets & period close', description: 'Control cost-center commitments, decide overrides, close fiscal periods, and produce traceable GL exports.', icon: 'account_balance' },
  integrations: { eyebrow: 'System administration', title: 'Assignments & integrations', description: 'Assign outlet responsibility and configure integration metadata without storing credentials in the application.', icon: 'hub' },
}

export default function MaterialsControl({ section }: { section: MaterialsSection }) {
  const app = useApp()
  const meta = sectionMeta[section]
  return <div className="mc-workspace">
    <header className="mc-hero">
      <span className="mc-hero-icon"><Icon name={meta.icon} size={24} /></span>
      <div><div className="mc-eyebrow">{meta.eyebrow}</div><h1>{meta.title}</h1><p>{meta.description}</p></div>
      <button type="button" className="mc-secondary" onClick={() => void app.refreshData()}><Icon name="sync" size={16} /> Refresh master data</button>
    </header>
    {section === 'waste' && <WasteControl />}
    {section === 'recipes' && <RecipeControl />}
    {section === 'pos' && <PosControl />}
    {section === 'governance' && <GovernanceControl />}
    {section === 'integrations' && <IntegrationControl />}
  </div>
}

function useRecords(paths: string[]) {
  const app = useApp()
  const [records, setRecords] = useState<Record<string, Row[]>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const results = await Promise.all(paths.map((path) => readBackendRecords(path)))
      setRecords(Object.fromEntries(paths.map((path, index) => [path, results[index]])))
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Materials control unavailable', message)
    } finally { setLoading(false) }
  }, [paths.join('|'), app.showWorkflowAlert])
  useEffect(() => { void load() }, [load])
  const act = async (operation: () => Promise<unknown>, success: string) => {
    if (busy) return undefined
    setBusy(true)
    setError('')
    try {
      const result = await operation()
      await load()
      await app.refreshData()
      app.showToast(success)
      return result
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      app.showWorkflowAlert('Action could not be completed', message)
      return undefined
    } finally { setBusy(false) }
  }
  return { records, loading, busy, error, load, act }
}

function Status({ value }: { value: unknown }) {
  const status = id(value).toLowerCase()
  const tone = ['reviewed', 'published', 'processed', 'approved', 'closed', 'healthy'].includes(status)
    ? 'good' : ['flagged', 'rejected', 'failed'].includes(status) ? 'bad' : 'warn'
  return <span className={`mc-status ${tone}`}>{titleCase(status || 'unknown')}</span>
}

function Empty({ loading, children }: { loading: boolean; children: string }) {
  return <div className="mc-empty"><Icon name={loading ? 'progress_activity' : 'inbox'} size={22} /><span>{loading ? 'Loading current records…' : children}</span></div>
}

function WasteControl() {
  const app = useApp()
  const role = id(app.user.role).toLowerCase()
  const canReport = ['department supervisor', 'outlet supervisor', 'supervisor'].includes(role)
  const canReview = ['department head', 'cost controller'].includes(role)
  const paths = useMemo(() => ['waste-records'], [])
  const { records, loading, busy, error, act } = useRecords(paths)
  const waste = records['waste-records'] || []
  const [form, setForm] = useState({ outlet: '', item: '', unit: '', quantity: '', reason_code: 'prep_spoilage', note: '' })
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const locations = app.data.locations as Row[]
  const items = app.data.items as Row[]
  const units = app.data.uoms as Row[]

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const created = await act(() => createBackendRecord('waste-records', {
      ...form, unit: form.unit || null, quantity: Number(form.quantity),
    }), 'Waste draft created') as Row | undefined
    if (!created?.id) return
    const posted = await act(() => runBackendAction('waste-records', id(created.id), 'submit'), 'Waste submitted and inventory adjusted')
    if (posted) setForm({ outlet: '', item: '', unit: '', quantity: '', reason_code: 'prep_spoilage', note: '' })
  }

  return <>
    {error && <div className="mc-alert">{error}</div>}
    <div className={`mc-grid ${canReport ? '' : 'single'}`}>
      {canReport && <form className="mc-card mc-form" onSubmit={submit}>
        <div className="mc-card-head"><div><h2>Log outlet waste</h2><p>The stock movement is posted only when this draft is submitted.</p></div><Icon name="add_circle" size={20} /></div>
        <div className="mc-fields two">
          <label>Outlet *<select required value={form.outlet} onChange={(event) => setForm({ ...form, outlet: event.target.value })}><option value="">Select outlet</option>{locations.map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label>
          <label>Article *<select required value={form.item} onChange={(event) => { const item = items.find((row) => id(row.id) === event.target.value); setForm({ ...form, item: event.target.value, unit: id(item?.baseUnitId) }) }}><option value="">Select article</option>{items.map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)} · {id(row.sku)}</option>)}</select></label>
          <label>Quantity *<input required min="0.0001" step="0.0001" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
          <label>Unit<select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}><option value="">Base unit</option>{units.map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)} ({id(row.abbr)})</option>)}</select></label>
          <label>Reason *<select value={form.reason_code} onChange={(event) => setForm({ ...form, reason_code: event.target.value })}><option value="prep_spoilage">Kitchen prep spoilage</option><option value="broken_service">Broken in service</option><option value="expired">Expired</option><option value="vip_complimentary">VIP complimentary</option><option value="staff_meal">Staff meal</option><option value="quality_rejection">Quality rejection</option><option value="other">Other</option></select></label>
          <label className="wide">Operational note {form.reason_code === 'other' ? '*' : ''}<textarea required={form.reason_code === 'other'} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="What happened, where, and who verified it?" /></label>
        </div>
        <button className="mc-primary" disabled={busy}><Icon name="send" size={16} /> Save, submit & adjust stock</button>
      </form>}
      <section className="mc-card">
        <div className="mc-card-head"><div><h2>{canReview ? 'Waste review queue' : 'Recent waste records'}</h2><p>{waste.length} record{waste.length === 1 ? '' : 's'} visible in your role scope.</p></div><span className="mc-count">{waste.filter((row) => id(row.status) === 'submitted').length} pending</span></div>
        {!waste.length ? <Empty loading={loading}>No waste has been recorded in your scope.</Empty> : <div className="mc-list">{waste.map((row) => <article className="mc-list-row" key={id(row.id)}>
          <div className="mc-row-main"><strong>{id(row.item_name)}</strong><span>{id(row.outlet_name)} · {row.quantity} {id(row.reason_label)}</span><small>{id(row.note) || 'No operational note'}</small></div>
          <div className="mc-row-side"><Status value={row.status} /><time>{id(row.created_at).slice(0, 10)}</time></div>
          {canReview && ['submitted', 'flagged'].includes(id(row.status)) && <div className="mc-review">
            <input aria-label="Review note" placeholder="Review or investigation note" value={reviewNotes[id(row.id)] || ''} onChange={(event) => setReviewNotes({ ...reviewNotes, [id(row.id)]: event.target.value })} />
            <button disabled={busy} className="mc-secondary" onClick={() => void act(() => runBackendAction('waste-records', id(row.id), 'review', { note: reviewNotes[id(row.id)] || '', flagged: false }), 'Waste reviewed')}>Accept</button>
            <button disabled={busy || !(reviewNotes[id(row.id)] || '').trim()} className="mc-danger" onClick={() => void act(() => runBackendAction('waste-records', id(row.id), 'review', { note: reviewNotes[id(row.id)], flagged: true }), 'Waste flagged for investigation')}>Flag</button>
          </div>}
        </article>)}</div>}
      </section>
    </div>
  </>
}

function RecipeControl() {
  const app = useApp()
  const paths = useMemo(() => ['recipes', 'recipe-ingredients'], [])
  const { records, loading, busy, error, act } = useRecords(paths)
  const recipes = records.recipes || []
  const ingredients = records['recipe-ingredients'] || []
  const [selected, setSelected] = useState('')
  const [recipe, setRecipe] = useState({ name: '', production_department: '', outlet: '', yield_quantity: '1', yield_unit: 'Portions', target_food_cost_percent: '30', selling_price: '0', is_sub_recipe: false, note: '' })
  const [ingredient, setIngredient] = useState({ item: '', unit: '', quantity: '', trim_percent: '0', note: '' })
  const [recipeSearch, setRecipeSearch] = useState('')
  const [recipeQuery, setRecipeQuery] = useState('')
  const visibleRecipes = recipes.filter(row => [row.name, row.code, row.production_department_name, row.outlet_name].some(value => id(value).toLowerCase().includes(recipeQuery.trim().toLowerCase())))
  const current = recipes.find((row) => id(row.id) === selected)
  const currentIngredients = ingredients.filter((row) => id(row.recipe) === selected)
  const items = app.data.items as Row[]

  const createRecipe = async (event: FormEvent) => {
    event.preventDefault()
    const created = await act(() => createBackendRecord('recipes', recipe), 'Recipe draft created') as Row | undefined
    if (created?.id) { setSelected(id(created.id)); setRecipe({ ...recipe, name: '', note: '' }) }
  }
  const addIngredient = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected) return
    const saved = await act(() => createBackendRecord('recipe-ingredients', { ...ingredient, recipe: selected, unit: ingredient.unit || null }), 'Ingredient added')
    if (saved) setIngredient({ item: '', unit: '', quantity: '', trim_percent: '0', note: '' })
  }

  return <>
    {error && <div className="mc-alert">{error}</div>}
    <div className="mc-grid">
      <form className="mc-card mc-form" onSubmit={createRecipe}>
        <div className="mc-card-head"><div><h2>New recipe standard</h2><p>Create the yield and food-cost target, then add its ingredients.</p></div><Icon name="restaurant_menu" size={20} /></div>
        <div className="mc-fields two">
          <label>Recipe name *<input required value={recipe.name} onChange={(event) => setRecipe({ ...recipe, name: event.target.value })} /></label>
          <label>Production department *<SearchableSelect required value={recipe.production_department} onChange={value=>setRecipe({...recipe,production_department:value})} placeholder="Select department" searchLabel="Search departments" options={(app.data.departments as Row[]).filter(row=>row.is_active!==false).map(row=>({value:id(row.id),label:id(row.name)}))}/></label>
          <label>Ingredient stock source *<SearchableSelect required value={recipe.outlet} onChange={value=>setRecipe({...recipe,outlet:value})} placeholder="Select source store" searchLabel="Search stores" options={(app.data.locations as Row[]).filter(row=>row.is_active!==false&&!row.is_virtual_transit).map(row=>({value:id(row.id),label:id(row.name)}))}/><small>Physical source for ingredient costing and POS stock depletion; does not change department ownership.</small></label>
          <label>Yield quantity *<input required min="0.0001" step="0.0001" type="number" value={recipe.yield_quantity} onChange={(event) => setRecipe({ ...recipe, yield_quantity: event.target.value })} /></label>
          <label>Yield unit *<input required value={recipe.yield_unit} onChange={(event) => setRecipe({ ...recipe, yield_unit: event.target.value })} /></label>
          <label>Target food cost % *<input required min="0.01" max="100" step="0.01" type="number" value={recipe.target_food_cost_percent} onChange={(event) => setRecipe({ ...recipe, target_food_cost_percent: event.target.value })} /></label>
          <label>Selling price<input min="0" step="0.01" type="number" value={recipe.selling_price} onChange={(event) => setRecipe({ ...recipe, selling_price: event.target.value })} /></label>
          <label className="mc-check wide"><input type="checkbox" checked={recipe.is_sub_recipe} onChange={(event) => setRecipe({ ...recipe, is_sub_recipe: event.target.checked })} /> This is a sub-recipe</label>
        </div>
        <button className="mc-primary" disabled={busy}><Icon name="add" size={16} /> Create recipe draft</button>
      </form>
      <section className="mc-card">
        <div className="mc-card-head"><div><h2>Recipe register</h2><p>Select a draft to maintain ingredients and publish.</p></div><span className="mc-count">{visibleRecipes.length}</span></div>
        <form className="mc-fields two" onSubmit={event => { event.preventDefault(); setRecipeQuery(recipeSearch) }}><input aria-label="Search recipes" placeholder="Recipe, department or code" value={recipeSearch} onChange={event => setRecipeSearch(event.target.value)} /><button className="mc-secondary" type="submit"><Icon name="search" size={16} /> Search</button></form>
        {!visibleRecipes.length ? <Empty loading={loading}>No matching recipes.</Empty> : <div className="mc-list compact">{visibleRecipes.map((row) => <button type="button" className={`mc-select-row ${selected === id(row.id) ? 'active' : ''}`} key={id(row.id)} onClick={() => setSelected(id(row.id))}><span><strong>{id(row.name)}</strong><small>{id(row.code)} · {id(row.production_department_name) || "Department not assigned"} · {row.ingredient_count} ingredient(s)</small></span><span><Status value={row.status} /><b>{money(row.cost_per_yield)}</b></span></button>)}</div>}
      </section>
    </div>
    {current && <section className="mc-card mc-recipe-detail">
      <div className="mc-card-head"><div><div className="mc-eyebrow">{id(current.code)}</div><h2>{id(current.name)}</h2><p>Cost {money(current.total_cost)} · {money(current.cost_per_yield)} per {id(current.yield_unit)} · suggested selling price {money(current.suggested_selling_price)}</p></div>{id(current.status) === 'draft' && <button className="mc-primary" disabled={busy || !currentIngredients.length} onClick={() => void act(() => runBackendAction('recipes', id(current.id), 'publish'), 'Recipe published')}><Icon name="publish" size={16} /> Publish</button>}</div>
      <div className="mc-split">
        <form className="mc-form inset" onSubmit={addIngredient}>
          <h3>Add ingredient</h3>
          <label>Article *<select required value={ingredient.item} onChange={(event) => { const item = items.find((row) => id(row.id) === event.target.value); setIngredient({ ...ingredient, item: event.target.value, unit: id(item?.baseUnitId) }) }}><option value="">Select article</option>{items.map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)} · {id(row.sku)}</option>)}</select></label>
          <div className="mc-fields two"><label>Quantity *<input required min="0.0001" step="0.0001" type="number" value={ingredient.quantity} onChange={(event) => setIngredient({ ...ingredient, quantity: event.target.value })} /></label><label>Trim / loss %<input min="0" max="99.99" step="0.01" type="number" value={ingredient.trim_percent} onChange={(event) => setIngredient({ ...ingredient, trim_percent: event.target.value })} /></label></div>
          <button className="mc-secondary" disabled={busy || id(current.status) !== 'draft'}><Icon name="add" size={16} /> Add ingredient</button>
        </form>
        <div className="mc-table-wrap"><table className="mc-table"><thead><tr><th>Ingredient</th><th>Net quantity</th><th>Gross usage</th><th>Current cost</th></tr></thead><tbody>{currentIngredients.map((row) => <tr key={id(row.id)}><td><strong>{id(row.item_name)}</strong><small>{id(row.item_sku)}</small></td><td>{row.quantity} {id(row.base_unit_name)}</td><td>{row.gross_base_quantity}</td><td>{money(row.ingredient_cost)}</td></tr>)}</tbody></table>{!currentIngredients.length && <Empty loading={false}>Add at least one ingredient before publishing.</Empty>}</div>
      </div>
    </section>}
  </>
}

function PosControl() {
  const app = useApp()
  const paths = useMemo(() => ['pos-plu-mappings', 'pos-imports', 'pos-sale-lines', 'recipes'], [])
  const { records, loading, busy, error, act } = useRecords(paths)
  const mappings = records['pos-plu-mappings'] || []
  const batches = records['pos-imports'] || []
  const lines = records['pos-sale-lines'] || []
  const recipes = (records.recipes || []).filter((row) => id(row.status) === 'published')
  const [mapping, setMapping] = useState({ outlet: '', external_plu: '', external_name: '', recipe: '', is_active: true })
  const [batchForm, setBatchForm] = useState({ outlet: '', business_date: today(), source: 'manual', source_reference: '' })
  const [selectedBatch, setSelectedBatch] = useState('')
  const [csvText, setCsvText] = useState('')
  const [sale, setSale] = useState({ external_plu: '', external_name: '', quantity: '', external_reference: '' })

  const addMapping = async (event: FormEvent) => { event.preventDefault(); const saved = await act(() => createBackendRecord('pos-plu-mappings', mapping), 'PLU mapping saved'); if (saved) setMapping({ ...mapping, external_plu: '', external_name: '', recipe: '' }) }
  const createBatch = async (event: FormEvent) => { event.preventDefault(); const saved = await act(() => createBackendRecord('pos-imports', batchForm), 'POS import opened') as Row | undefined; if (saved?.id) setSelectedBatch(id(saved.id)) }
  const addSale = async (event: FormEvent) => { event.preventDefault(); const saved = await act(() => createBackendRecord('pos-sale-lines', { ...sale, batch: selectedBatch, quantity: Number(sale.quantity) }), 'POS sale line added'); if (saved) setSale({ external_plu: '', external_name: '', quantity: '', external_reference: '' }) }
  const selected = batches.find((row) => id(row.id) === selectedBatch)

  return <>
    {error && <div className="mc-alert">{error}</div>}
    <div className="mc-grid">
      <form className="mc-card mc-form" onSubmit={addMapping}><div className="mc-card-head"><div><h2>PLU to recipe map</h2><p>Only published recipes can drive POS ingredient depletion.</p></div><span className="mc-count">{mappings.length}</span></div><div className="mc-fields two">
        <label>Outlet *<select required value={mapping.outlet} onChange={(event) => setMapping({ ...mapping, outlet: event.target.value })}><option value="">Select outlet</option>{(app.data.locations as Row[]).map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label>
        <label>Published recipe *<select required value={mapping.recipe} onChange={(event) => setMapping({ ...mapping, recipe: event.target.value })}><option value="">Select recipe</option>{recipes.map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label>
        <label>External PLU *<input required value={mapping.external_plu} onChange={(event) => setMapping({ ...mapping, external_plu: event.target.value })} /></label><label>POS item name<input value={mapping.external_name} onChange={(event) => setMapping({ ...mapping, external_name: event.target.value })} /></label>
      </div><button className="mc-primary" disabled={busy}><Icon name="link" size={16} /> Save mapping</button></form>
      <section className="mc-card"><div className="mc-card-head"><div><h2>Active mapping register</h2><p>Outlet-specific mappings prevent one menu code from consuming the wrong recipe.</p></div></div>{!mappings.length ? <Empty loading={loading}>No POS mappings exist.</Empty> : <div className="mc-list compact">{mappings.map((row) => <div className="mc-list-row" key={id(row.id)}><div className="mc-row-main"><strong>{id(row.external_plu)} · {id(row.external_name) || id(row.recipe_name)}</strong><span>{id(row.outlet_name)} → {id(row.recipe_name)}</span></div><Status value={row.is_active ? 'active' : 'inactive'} /></div>)}</div>}</section>
    </div>
    <section className="mc-card"><div className="mc-card-head"><div><h2>POS sales import</h2><p>Create an import batch, load its sale lines, then run depletion. Unmapped PLUs remain pending and can be re-run safely.</p></div>{selected && <button className="mc-primary" disabled={busy || id(selected.status) === 'processed'} onClick={() => void act(() => runBackendAction('pos-imports', id(selected.id), 'run-depletion'), 'POS depletion processed')}><Icon name="play_arrow" size={16} /> Run depletion</button>}</div>
      <div className="mc-three-column">
        <form className="mc-form inset" onSubmit={createBatch}><h3>1. Open import</h3><label>Outlet *<select required value={batchForm.outlet} onChange={(event) => setBatchForm({ ...batchForm, outlet: event.target.value })}><option value="">Select outlet</option>{(app.data.locations as Row[]).map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label><label>Business date *<input required type="date" value={batchForm.business_date} onChange={(event) => setBatchForm({ ...batchForm, business_date: event.target.value })} /></label><label>Source reference<input value={batchForm.source_reference} onChange={(event) => setBatchForm({ ...batchForm, source_reference: event.target.value })} placeholder="Z-report or file ID" /></label><button className="mc-secondary" disabled={busy}>Open batch</button></form>
        <div className="mc-form inset"><h3>2. Select batch</h3><div className="mc-list compact">{batches.map((row) => <button type="button" className={`mc-select-row ${selectedBatch === id(row.id) ? 'active' : ''}`} key={id(row.id)} onClick={() => setSelectedBatch(id(row.id))}><span><strong>{id(row.business_date)} · {id(row.outlet_name)}</strong><small>{row.line_count} line(s), {row.unmapped_count} pending</small></span><Status value={row.status} /></button>)}</div></div>
        <form className="mc-form inset" onSubmit={addSale}><h3>3. Add sale line</h3><label>External PLU *<input required value={sale.external_plu} onChange={(event) => setSale({ ...sale, external_plu: event.target.value })} /></label><label>Quantity sold *<input required min="0.0001" step="0.0001" type="number" value={sale.quantity} onChange={(event) => setSale({ ...sale, quantity: event.target.value })} /></label><label>External reference<input value={sale.external_reference} onChange={(event) => setSale({ ...sale, external_reference: event.target.value })} /></label><button className="mc-secondary" disabled={busy || !selectedBatch || id(selected?.status) === 'processed'}>Add line</button></form>
      </div>
      {selectedBatch && id(selected?.status) !== 'processed' && <div className="mc-form inset"><h3>Import sale lines from CSV</h3><p>Required columns: external_plu, external_reference, quantity. Optional: external_name, net_sales.</p><textarea rows={4} placeholder={'external_plu,external_reference,quantity,external_name,net_sales\nPLU-001,CHECK-001,2,House special,50000'} value={csvText} onChange={(event) => setCsvText(event.target.value)} /><button type="button" className="mc-secondary" disabled={busy || !csvText.trim()} onClick={() => void act(() => runBackendAction('pos-imports', selectedBatch, 'import-csv', { csv: csvText }), 'POS CSV imported')}>Import CSV</button></div>}
      {selectedBatch && <div className="mc-table-wrap"><table className="mc-table"><thead><tr><th>PLU</th><th>POS name</th><th>Sold</th><th>Recipe mapping</th><th>Inventory</th></tr></thead><tbody>{lines.filter((row) => id(row.batch) === selectedBatch).map((row) => <tr key={id(row.id)}><td>{id(row.external_plu)}</td><td>{id(row.external_name) || '—'}</td><td>{row.quantity}</td><td>{id(row.mapping_name) || 'Unmapped'}</td><td><Status value={row.inventory_changes_applied ? 'processed' : 'pending'} /></td></tr>)}</tbody></table></div>}
    </section>
  </>
}

function GovernanceControl() {
  const app = useApp()
  const paths = useMemo(() => ['cost-center-budgets', 'budget-overrides', 'fiscal-periods', 'gl-exports'], [])
  const { records, loading, busy, error, act } = useRecords(paths)
  const budgets = records['cost-center-budgets'] || []
  const overrides = records['budget-overrides'] || []
  const periods = records['fiscal-periods'] || []
  const exports = records['gl-exports'] || []
  const [budget, setBudget] = useState({ branch: '', department: '', period_month: monthStart(), spending_cap: '', enforce_hard_block: true, is_active: true, note: '' })
  const [period, setPeriod] = useState({ branch: '', name: '', start_date: monthStart(), end_date: today() })
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [periodNotes, setPeriodNotes] = useState<Record<string, string>>({})
  const addBudget = async (event: FormEvent) => { event.preventDefault(); const saved = await act(() => createBackendRecord('cost-center-budgets', budget), 'Cost-center budget saved'); if (saved) setBudget({ ...budget, department: '', spending_cap: '', note: '' }) }
  const addPeriod = async (event: FormEvent) => { event.preventDefault(); const saved = await act(() => createBackendRecord('fiscal-periods', period), 'Fiscal period opened'); if (saved) setPeriod({ ...period, name: '' }) }

  return <>
    {error && <div className="mc-alert">{error}</div>}
    <div className="mc-grid">
      <form className="mc-card mc-form" onSubmit={addBudget}><div className="mc-card-head"><div><h2>Monthly cost-center budget</h2><p>A hard block requires an approved financial override before the requisition proceeds.</p></div><Icon name="savings" size={20} /></div><div className="mc-fields two">
        <label>Property *<select required value={budget.branch} onChange={(event) => setBudget({ ...budget, branch: event.target.value })}><option value="">Select property</option>{(app.data.branches as Row[]).map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label>
        <label>Cost center *<select required value={budget.department} onChange={(event) => setBudget({ ...budget, department: event.target.value })}><option value="">Select department</option>{(app.data.departments as Row[]).map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label>
        <label>Budget month *<input required type="date" value={budget.period_month} onChange={(event) => setBudget({ ...budget, period_month: event.target.value })} /></label><label>Spending cap *<input required min="0.01" step="0.01" type="number" value={budget.spending_cap} onChange={(event) => setBudget({ ...budget, spending_cap: event.target.value })} /></label>
        <label className="mc-check wide"><input type="checkbox" checked={budget.enforce_hard_block} onChange={(event) => setBudget({ ...budget, enforce_hard_block: event.target.checked })} /> Block over-budget requisitions pending finance approval</label>
      </div><button className="mc-primary" disabled={busy}>Save budget</button></form>
      <section className="mc-card"><div className="mc-card-head"><div><h2>Budget position</h2><p>Committed spend is calculated from non-cancelled purchase orders.</p></div><span className="mc-count">{budgets.length}</span></div>{!budgets.length ? <Empty loading={loading}>No cost-center budgets are configured.</Empty> : <div className="mc-list compact">{budgets.map((row) => <div className="mc-list-row" key={id(row.id)}><div className="mc-row-main"><strong>{id(row.department_name)} · {id(row.period_month).slice(0, 7)}</strong><span>{money(row.committed_spend)} committed of {money(row.spending_cap)}</span></div><div className="mc-row-side"><b>{money(row.remaining_amount)}</b><small>remaining</small></div></div>)}</div>}</section>
    </div>
    <section className="mc-card"><div className="mc-card-head"><div><h2>Budget override decisions</h2><p>Every decision requires a financial note and remains part of the requisition history.</p></div><span className="mc-count">{overrides.filter((row) => id(row.status) === 'pending').length} pending</span></div>{!overrides.length ? <Empty loading={loading}>No requisitions require a budget override.</Empty> : <div className="mc-list">{overrides.map((row) => <article className="mc-list-row" key={id(row.id)}><div className="mc-row-main"><strong>{id(row.requisition_number)} · {id(row.department_name)}</strong><span>{money(row.requested_amount)} requested · {money(row.overage_amount)} over budget</span><small>{id(row.reason)}</small></div><Status value={row.status} />{id(row.status) === 'pending' && <div className="mc-review"><input placeholder="Required financial decision note" value={notes[id(row.id)] || ''} onChange={(event) => setNotes({ ...notes, [id(row.id)]: event.target.value })} /><button className="mc-secondary" disabled={busy || !notes[id(row.id)]?.trim()} onClick={() => void act(() => runBackendAction('budget-overrides', id(row.id), 'decide', { decision: 'approve', note: notes[id(row.id)] }), 'Budget override approved')}>Approve</button><button className="mc-danger" disabled={busy || !notes[id(row.id)]?.trim()} onClick={() => void act(() => runBackendAction('budget-overrides', id(row.id), 'decide', { decision: 'reject', note: notes[id(row.id)] }), 'Budget override rejected')}>Reject</button></div>}</article>)}</div>}</section>
    <div className="mc-grid">
      <form className="mc-card mc-form" onSubmit={addPeriod}><div className="mc-card-head"><div><h2>Open fiscal period</h2><p>Overlapping periods are rejected for the same property.</p></div><Icon name="date_range" size={20} /></div><div className="mc-fields two"><label>Property *<select required value={period.branch} onChange={(event) => setPeriod({ ...period, branch: event.target.value })}><option value="">Select property</option>{(app.data.branches as Row[]).map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label><label>Period name *<input required value={period.name} onChange={(event) => setPeriod({ ...period, name: event.target.value })} placeholder="November 2026" /></label><label>Start *<input required type="date" value={period.start_date} onChange={(event) => setPeriod({ ...period, start_date: event.target.value })} /></label><label>End *<input required type="date" value={period.end_date} onChange={(event) => setPeriod({ ...period, end_date: event.target.value })} /></label></div><button className="mc-primary" disabled={busy}>Open period</button></form>
      <section className="mc-card"><div className="mc-card-head"><div><h2>Period-close register</h2><p>Resolve outstanding GRNs, transfers, stock counts, POS imports and invoice discrepancies before closing.</p></div></div>{!periods.length ? <Empty loading={loading}>No fiscal periods exist.</Empty> : <div className="mc-list compact">{periods.map((row) => <div className="mc-list-row" key={id(row.id)}><div className="mc-row-main"><strong>{id(row.name)} · {id(row.branch_name)}</strong><span>{id(row.start_date)} to {id(row.end_date)}</span><small>{(row.checklist?.blockers || []).join(' ') || 'Pre-close controls clear'}</small></div><div className="mc-row-actions"><Status value={row.status} />{id(row.status) === 'open' && <><input aria-label="Period close approval note" placeholder="Required period close note" value={periodNotes[id(row.id)] || ''} onChange={(event) => setPeriodNotes({ ...periodNotes, [id(row.id)]: event.target.value })} /><button className="mc-secondary" disabled={busy || !row.checklist?.can_close || !periodNotes[id(row.id)]?.trim()} onClick={() => void act(() => runBackendAction('fiscal-periods', id(row.id), 'close', { note: periodNotes[id(row.id)] }), 'Fiscal period closed')}>Close</button></>}{id(row.status) === 'closed' && <button className="mc-secondary" disabled={busy} onClick={() => void act(() => runBackendAction('fiscal-periods', id(row.id), 'generate-gl-export'), 'GL export generated')}>Generate GL</button>}</div></div>)}</div>}</section>
    </div>
    <section className="mc-card"><div className="mc-card-head"><div><h2>GL export history</h2><p>Balanced journal rows use configured accounts. Historical inventory/COGS valuations still require a dedicated posting integration.</p></div><span className="mc-count">{exports.length}</span></div>{!exports.length ? <Empty loading={loading}>No GL exports have been generated.</Empty> : <div className="mc-table-wrap"><table className="mc-table"><thead><tr><th>Period</th><th>Generated</th><th>Rows</th><th>SHA-256 checksum</th><th>File</th></tr></thead><tbody>{exports.map((row) => <tr key={id(row.id)}><td><strong>{id(row.period_name)}</strong></td><td>{id(row.generated_at).replace('T', ' ').slice(0, 16)}</td><td>{row.row_count}</td><td className="mc-mono">{id(row.checksum)}</td><td><button type="button" className="mc-secondary" disabled={busy} onClick={() => void act(() => downloadGLExport(id(row.id)), 'GL export downloaded')}>Download CSV</button></td></tr>)}</tbody></table></div>}</section>
  </>
}

function IntegrationControl() {
  const app = useApp()
  const paths = useMemo(() => ['outlet-assignments', 'integration-configs', 'gl-account-mappings'], [])
  const { records, loading, busy, error, act } = useRecords(paths)
  const assignments = records['outlet-assignments'] || []
  const integrations = records['integration-configs'] || []
  const glMappings = records['gl-account-mappings'] || []
  const [glMap, setGlMap] = useState({ branch: '', department: '', source_type: 'supplier_invoice', debit_account: '', credit_account: '', tax_account: '', is_active: true })
  const [assignment, setAssignment] = useState({ employee: '', outlet: '', is_primary: true, is_active: true })
  const [integration, setIntegration] = useState({ branch: '', name: '', integration_type: 'pos', provider: '', endpoint_hint: '', secret_environment_variable: '', schedule: '', is_active: true, health: 'unknown', last_message: '' })
  const addAssignment = async (event: FormEvent) => { event.preventDefault(); const saved = await act(() => createBackendRecord('outlet-assignments', assignment), 'Outlet responsibility assigned'); if (saved) setAssignment({ ...assignment, employee: '', outlet: '' }) }
  const addGlMap = async (event: FormEvent) => { event.preventDefault(); const saved = await act(() => createBackendRecord('gl-account-mappings', {...glMap, department:glMap.department || null}), 'GL mapping saved'); if (saved) setGlMap({ ...glMap, debit_account: '', credit_account: '', tax_account: '' }) }
  const addIntegration = async (event: FormEvent) => { event.preventDefault(); const saved = await act(() => createBackendRecord('integration-configs', { ...integration, branch: integration.branch || null }), 'Integration metadata saved'); if (saved) setIntegration({ ...integration, name: '', provider: '', endpoint_hint: '', secret_environment_variable: '', schedule: '' }) }
  return <>
    {error && <div className="mc-alert">{error}</div>}
    <div className="mc-grid">
      <form className="mc-card mc-form" onSubmit={addAssignment}><div className="mc-card-head"><div><h2>Outlet responsibility</h2><p>Outlet Supervisors see and submit records only for their active assignments.</p></div><Icon name="badge" size={20} /></div><div className="mc-fields two"><label>Employee *<select required value={assignment.employee} onChange={(event) => setAssignment({ ...assignment, employee: event.target.value })}><option value="">Select employee</option>{(app.data.employees as Row[]).map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)} · {id(row.designation)}</option>)}</select></label><label>Outlet *<select required value={assignment.outlet} onChange={(event) => setAssignment({ ...assignment, outlet: event.target.value })}><option value="">Select outlet</option>{(app.data.locations as Row[]).map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label><label className="mc-check wide"><input type="checkbox" checked={assignment.is_primary} onChange={(event) => setAssignment({ ...assignment, is_primary: event.target.checked })} /> Primary assignment</label></div><button className="mc-primary" disabled={busy}>Assign outlet</button></form>
      <section className="mc-card"><div className="mc-card-head"><div><h2>Assignment register</h2><p>Property alignment is validated on save.</p></div><span className="mc-count">{assignments.length}</span></div>{!assignments.length ? <Empty loading={loading}>No outlet assignments exist.</Empty> : <div className="mc-list compact">{assignments.map((row) => <div className="mc-list-row" key={id(row.id)}><div className="mc-row-main"><strong>{id(row.employee_name)}</strong><span>{id(row.outlet_name)}{row.is_primary ? ' · Primary' : ''}</span></div><Status value={row.is_active ? 'active' : 'inactive'} /></div>)}</div>}</section>
    </div>
    <div className="mc-grid">
      <form className="mc-card mc-form" onSubmit={addIntegration}><div className="mc-card-head"><div><h2>Integration metadata</h2><p>Store only the environment-variable name. Credentials remain outside the database.</p></div><Icon name="vpn_key_off" size={20} /></div><div className="mc-fields two"><label>Name *<input required value={integration.name} onChange={(event) => setIntegration({ ...integration, name: event.target.value })} /></label><label>Type *<select value={integration.integration_type} onChange={(event) => setIntegration({ ...integration, integration_type: event.target.value })}><option value="pos">POS import</option><option value="accounting">Accounting export</option></select></label><label>Provider *<input required value={integration.provider} onChange={(event) => setIntegration({ ...integration, provider: event.target.value })} /></label><label>Property<select value={integration.branch} onChange={(event) => setIntegration({ ...integration, branch: event.target.value })}><option value="">Global</option>{(app.data.branches as Row[]).map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label><label>Endpoint hint<input value={integration.endpoint_hint} onChange={(event) => setIntegration({ ...integration, endpoint_hint: event.target.value })} placeholder="Host or integration route; no secret" /></label><label>Secret environment variable<input value={integration.secret_environment_variable} onChange={(event) => setIntegration({ ...integration, secret_environment_variable: event.target.value })} placeholder="POS_API_TOKEN" /></label><label className="wide">Schedule<input value={integration.schedule} onChange={(event) => setIntegration({ ...integration, schedule: event.target.value })} placeholder="Every 15 minutes / nightly at 23:00" /></label></div><button className="mc-primary" disabled={busy}>Save integration</button></form>
      <section className="mc-card"><div className="mc-card-head"><div><h2>Integration health register</h2><p>Configuration state is visible without exposing credentials.</p></div><span className="mc-count">{integrations.length}</span></div>{!integrations.length ? <Empty loading={loading}>No integrations are configured.</Empty> : <div className="mc-list compact">{integrations.map((row) => <div className="mc-list-row" key={id(row.id)}><div className="mc-row-main"><strong>{id(row.name)} · {id(row.provider)}</strong><span>{titleCase(row.integration_type)} · {id(row.branch_name) || 'Global'}</span><small>{id(row.schedule) || 'Manual schedule'} · secret: {id(row.secret_environment_variable) || 'not configured'}</small></div><Status value={row.health} /></div>)}</div>}</section>
    </div>
    <div className="mc-grid">
      <form className="mc-card mc-form" onSubmit={addGlMap}><h2>GL account mappings</h2><p>Use the property's actual chart-of-account codes, not temporary defaults.</p><div className="mc-fields two"><label>Property *<select required value={glMap.branch} onChange={(event) => setGlMap({ ...glMap, branch: event.target.value })}><option value="">Select property</option>{(app.data.branches as Row[]).map((row) => <option key={id(row.id)} value={id(row.id)}>{id(row.name)}</option>)}</select></label><label>Source *<select value={glMap.source_type} onChange={(event) => setGlMap({ ...glMap, source_type: event.target.value, department:'' })}><option value="supplier_invoice">Supplier invoice</option><option value="expense">Expense</option><option value="supplier_payment">Supplier payment</option><option value="stock_consumption">General stock consumption</option><option value="pos_cogs">POS cost of sales</option><option value="stock_waste">Waste and spoilage</option><option value="stock_variance">Physical count variance</option><option value="department_expense">Department expense</option><option value="department_cogs">Department cost of sales</option></select></label>{['department_expense','department_cogs'].includes(glMap.source_type) && <label>Department *<SearchableSelect required value={glMap.department} onChange={value=>setGlMap({...glMap,department:value})} placeholder="Select department" searchLabel="Search departments" options={(app.data.departments as Row[]).filter(row=>row.is_active!==false).map(row=>({value:id(row.id),label:id(row.name)}))}/></label>}<label>Debit account *<input required value={glMap.debit_account} onChange={(event) => setGlMap({ ...glMap, debit_account: event.target.value })} /></label><label>Credit account *<input required value={glMap.credit_account} onChange={(event) => setGlMap({ ...glMap, credit_account: event.target.value })} /></label><label>VAT input account<input value={glMap.tax_account} onChange={(event) => setGlMap({ ...glMap, tax_account: event.target.value })} /></label></div><button className="mc-primary" disabled={busy}>Save GL mapping</button></form>
      <section className="mc-card"><h2>Account mapping register</h2>{!glMappings.length ? <Empty loading={loading}>No GL mappings are configured.</Empty> : <div className="mc-list compact">{glMappings.map((row) => <div className="mc-list-row" key={id(row.id)}><div className="mc-row-main"><strong>{id(row.branch_name)} · {titleCase(row.source_type)}{row.department_name ? ' · '+id(row.department_name) : ''}</strong><span>Debit {id(row.debit_account)} · Credit {id(row.credit_account)}{row.tax_account ? ' · VAT ' + id(row.tax_account) : ''}</span></div><Status value={row.is_active ? 'active' : 'inactive'} /></div>)}</div>}</section>
    </div>
  </>
}
