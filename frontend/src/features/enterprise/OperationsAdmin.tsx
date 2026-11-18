import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import EnterpriseTable, { type EnterpriseColumn } from '../../components/EnterpriseTable'
import ConfirmTransaction from '../../components/ConfirmTransaction'
import WorkflowPrerequisite from '../../components/WorkflowPrerequisite'
import {
  createBackendRecord, errorMessage, runBackendAction, updateBackendRecord, fetchOperationalReport, readBackendPayload,
} from '../../lib/api'
import { useApp } from '../../state/AppContext'
import { printReturnNote, exportReturnRegister } from './returnDocuments'
import {
  amount, dateStr, dec, DocumentReference, FormField, StateMessage,
  StatusPill, str, useBackendRows, WorkspacePage, OperationalSummary, type ApiRow,
} from './workspaceKit'

const btn='mc-action'
const primary='mc-action mc-action-primary'
async function verifyReturnLedger(type:'supplier'|'department',app:ReturnType<typeof useApp>){
  try{
    const result=await readBackendPayload('reports/return-reconciliation?type='+type) as unknown as {count:number;unreconciled_count:number;is_truncated:boolean}
    const problems=Number(result.unreconciled_count||0)
    const incomplete=Boolean(result.is_truncated)
    const msg=`${result.count} recorded return lines checked. ${problems} inventory-ledger mismatch(es).`+
      (incomplete?' Results limited to the first 1,000 lines; narrow the report in a future full export.':'')
    if(problems||incomplete)app.showWorkflowAlert('Return stock reconciliation',msg,'warning')
    else app.showToast('Return stock reconciliation passed · '+msg)
  }catch(error){app.showWorkflowAlert('Return reconciliation unavailable',errorMessage(error),'failure')}
}

function useWrite(reload:()=>Promise<void>) {
  const app=useApp()
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const execute=async(fn:()=>Promise<unknown>,message:string)=>{
    if(busy)return false
    setBusy(true);setError('')
    try{await fn();await reload();await app.refreshData();app.showToast(message);return true}
    catch(e){setError(errorMessage(e));return false}
    finally{setBusy(false)}
  }
  return {execute,busy,error}
}

export function EnterpriseCostCenters() {
  const {data,loading,error,reload}=useBackendRows(['stores','branches','departments'])
  const {execute,busy,error:mutationError}=useWrite(reload)
  const [name,setName]=useState('')
  const [branch,setBranch]=useState('')
  const [address,setAddress]=useState('')
  const [selected,setSelected]=useState('')
  const stores=data.stores||[]
  const branches=data.branches||[]
  const chosen=stores.find(r=>str(r.id)===selected)
  const create=async()=>{
    if(!name.trim()||!branch)return
    const saved=await execute(()=>createBackendRecord('stores',{
      name,branch,address,is_active:true,is_default:false,
    }), 'Cost center / store added')
    if(saved){setName('');setAddress('')}
  }
  const cols:EnterpriseColumn<ApiRow>[]=[
    {id:'name',label:'Cost center / Store',value:r=>str(r.name),render:r=><strong>{str(r.name)}</strong>},
    {id:'property',label:'Property',value:r=>str(r.branch_name||r.branch)},
    {id:'default',label:'Main store',value:r=>r.is_default?'Yes':'No',render:r=><StatusPill status={r.is_default?'main store':'other'}/>},
    {id:'vts',label:'Virtual transit store',value:r=>str(r.name).includes('Virtual Transit')?'Yes':'No',render:r=><StatusPill status={str(r.name).includes('Virtual Transit')?'virtual':'physical'}/>},
    {id:'active',label:'Operational',value:r=>r.is_active?'Active':'Inactive',render:r=><StatusPill status={r.is_active?'active':'inactive'}/>},
  ]
  return <WorkspacePage section="System / Master data" title="Manage cost centers & stores"
    subtitle="Physical locations, assigned properties, budget controls and virtual transit definitions."
    actions={<button className={btn} onClick={()=>void reload()}><Icon name="refresh" size={15}/> Refresh</button>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<div className="mc-split mc-admin-split">
      <EnterpriseTable<ApiRow> label="Stores and cost centers" rows={stores} columns={cols} onOpen={r=>setSelected(str(r.id))}/>
      <div className="mc-dense-panel mc-form-panel">
        <header className="mc-panel-title">{chosen?'Store profile / MC flags':'New store location'}</header>
        {chosen?<div className="mc-detail-meta">
          <p className="mc-muted">The backend currently stores physical location, default and active flags. Additional MC-style setup flags are shown as configuration requirements rather than simulated saved fields.</p>
          {[
            ['Virtual Transit Store',Boolean(chosen.is_virtual_transit),'is_virtual_transit'],
            ['Default / Main Store',Boolean(chosen.is_default),'is_default'],
            ['Enable Menu Planning',Boolean(chosen.enable_menu_planning),'enable_menu_planning'],
            ['Permanent Inventory POT-COS',Boolean(chosen.permanent_inventory_pot_cos),'permanent_inventory_pot_cos'],
            ['Cost Center/Store is to budget',Boolean(chosen.is_to_budget),'is_to_budget'],
          ].map(([label,checked,field])=><label className="mc-check" key={str(label)}><input type="checkbox"
            checked={Boolean(checked)} disabled={busy||field==='is_virtual_transit'}
            onChange={()=>void execute(
              ()=>updateBackendRecord('stores',str(chosen.id),{[str(field)]:!checked}),
              'Store control flag updated'
            )}/>{str(label)}</label>)}
          <button className={btn} onClick={()=>setSelected('')}>Add another location</button>
        </div>:<>
          <label className="mc-field"><span>Property</span><select value={branch} onChange={e=>setBranch(e.target.value)}>
            <option value="">Select property</option>{branches.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
          <FormField label="Store / cost center name" value={name} onChange={setName}/>
          <FormField label="Location / aisle description" value={address} onChange={setAddress}/>
          <button className={primary} disabled={busy||!name.trim()||!branch} onClick={()=>void create()}><Icon name="save" size={15}/> Create location</button>
        </>}
      </div>
    </div>}
  </WorkspacePage>
}

export function EnterpriseAuthorisationRules() {
  const {data,loading,error,reload}=useBackendRows(['approval-matrix','roles','branches'])
  const {execute,busy,error:mutationError}=useWrite(reload)
  const [documentType,setDocumentType]=useState('purchase_order')
  const [level,setLevel]=useState('1')
  const [minimum,setMinimum]=useState('0')
  const [maximum,setMaximum]=useState('')
  const [property,setProperty]=useState('')
  const [role,setRole]=useState('')
  const [name,setName]=useState('')
  const rules=data['approval-matrix']||[]
  const roles=data.roles||[]
  const cols:EnterpriseColumn<ApiRow>[]=[
    {id:'name',label:'Rule',value:r=>str(r.name)},
    {id:'doc',label:'Document',value:r=>str(r.document_type)},
    {id:'branch',label:'Property',value:r=>str(r.branch_name||r.branch||'All')},
    {id:'stage',label:'Level',value:r=>dec(r.stage),numeric:true},
    {id:'lower',label:'Min (UGX)',value:r=>dec(r.minimum_amount),render:r=><span className="mc-num">{amount(r.minimum_amount)}</span>,numeric:true},
    {id:'upper',label:'Max (UGX)',value:r=>dec(r.maximum_amount),render:r=><span className="mc-num">{r.maximum_amount==null?'No limit':amount(r.maximum_amount)}</span>,numeric:true},
    {id:'role',label:'Approver role',value:r=>str(r.approver_role_name||r.approver_role||r.approver)},
    {id:'active',label:'Status',value:r=>str(r.is_active),render:r=><StatusPill status={r.is_active?'active':'disabled'}/>},
  ]
  const save=async()=>{
    if(!name.trim()||!role||!(Number(level)>=1)||Number(minimum)<0)return
    const ok=await execute(()=>createBackendRecord('approval-matrix',{
      name,document_type:documentType,branch:property||null,department:null,
      stage:Number(level),stage_name:'Level '+level,
      minimum_amount:minimum,maximum_amount:maximum||null,
      assignment_type:'role',approver_role:role,is_active:true,
    }),'Authorisation rule created')
    if(ok){setName('');setMinimum('0');setMaximum('')}
  }
  return <WorkspacePage section="System / Delegated authority" title="Authorisation threshold matrix"
    subtitle="Configure financial approval stages L1–L3 by property, document type and monetary range.">
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<div className="mc-split mc-admin-split">
      <EnterpriseTable<ApiRow> label="Authorisation rules" rows={rules} columns={cols}/>
      <div className="mc-dense-panel mc-form-panel">
        <header className="mc-panel-title">New approval rule</header>
        <FormField label="Rule name" value={name} onChange={setName} placeholder="Financial Controller · UGX 5M+"/>
        <label className="mc-field"><span>Document type</span><select value={documentType} onChange={e=>setDocumentType(e.target.value)}>
          <option value="purchase_requisition">Purchase requisition</option><option value="purchase_order">Purchase order</option>
          <option value="stock_adjustment">Stock adjustment</option><option value="stock_count">Stock count</option>
        </select></label>
        <label className="mc-field"><span>Property</span><select value={property} onChange={e=>setProperty(e.target.value)}><option value="">All properties</option>
          {(data.branches||[]).map(r=><option value={str(r.id)} key={str(r.id)}>{str(r.name)}</option>)}</select></label>
        <div className="mc-field-pair">
          <label className="mc-field"><span>Authorisation level</span><select value={level} onChange={e=>setLevel(e.target.value)}>
            {[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
          <label className="mc-field"><span>Approver role</span><select value={role} onChange={e=>setRole(e.target.value)}>
            <option value="">Choose role</option>{roles.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
        </div>
        <div className="mc-field-pair"><FormField label="Minimum amount UGX" type="number" value={minimum} onChange={setMinimum}/>
          <FormField label="Maximum amount (blank = no limit)" type="number" value={maximum} onChange={setMaximum}/></div>
        <div className="mc-alert mc-muted">Budget override authority remains a separate Financial Controller decision in Django. A rule configured here does not bypass a hard budget block.</div>
        <button className={primary} disabled={busy||!name.trim()||!role||Number(minimum)<0||(maximum!==''&&Number(maximum)<Number(minimum))}
          onClick={()=>void save()}><Icon name="save" size={15}/> Save authorisation rule</button>
      </div>
    </div>}
  </WorkspacePage>
}

export function EnterpriseArticleMaster() {
  const app=useApp()
  const {data,loading,error}=useBackendRows(['items','categories','item-unit-prices','gl-account-mappings'])
  const [selected,setSelected]=useState('')
  const items=data.items||[]
  const article=items.find(r=>str(r.id)===selected)
  const units=(data['item-unit-prices']||[]).filter(row=>str(row.item)===selected)
  const cols:EnterpriseColumn<ApiRow>[]=[
    {id:'sku',label:'Article code',value:r=>str(r.sku),render:r=><strong className="mc-mono">{str(r.sku)}</strong>},
    {id:'name',label:'Article description',value:r=>str(r.name)},
    {id:'group',label:'Item super group',value:r=>str(r.category_name||r.category)},
    {id:'base',label:'Base / Store unit',value:r=>str(r.base_unit_name||r.base_unit||r.unit)},
    {id:'expiry',label:'Expiry tracking',value:r=>r.expiry_tracking?'Yes':'No'},
    {id:'batch',label:'Batch / Lot',value:r=>r.batch_tracking?'Yes':'No'},
    {id:'status',label:'Status',value:r=>r.is_active?'Active':'Inactive',render:r=><StatusPill status={r.is_active?'active':'inactive'}/>},
  ]
  return <WorkspacePage section="System / Catalogue" title="Article master & unit conversions"
    subtitle="Item groups, coded articles, order-to-base conversions, tracking controls and GL mapping references."
    actions={<button className={primary} onClick={()=>app.navTo('items','Article Management')}><Icon name="add" size={15}/> Manage Articles</button>}>
    <StateMessage loading={loading} error={error}/>
    {!loading&&!error&&<div className="mc-split mc-admin-split">
      <EnterpriseTable<ApiRow> label="Article catalogue" rows={items} columns={cols} onOpen={row=>setSelected(str(row.id))}/>
      <div className="mc-dense-panel mc-form-panel">
        <header className="mc-panel-title">{article?str(article.name):'Article conversion inspector'}</header>
        {!article?<div className="mc-empty-state">Choose an Article to inspect configured units and inventory mapping.</div>:<>
          <div className="mc-detail-meta"><div className="mc-info-row"><span>Code</span><strong>{str(article.sku)}</strong></div>
            <div className="mc-info-row"><span>Base store unit</span><strong>{str(article.base_unit_name||article.unit)}</strong></div></div>
          <div className="mc-conversion-path"><span>Order Unit</span><Icon name="east" size={13}/><span>Delivery Unit</span><Icon name="east" size={13}/><span>Base / Store Unit</span><Icon name="east" size={13}/><span>Recipe Unit</span></div>
          <table className="mc-simple-table"><thead><tr><th>Unit / role</th><th className="mc-num">Conversion factor</th></tr></thead>
          <tbody>{units.map(row=><tr key={str(row.id)}><td>{str(row.unit_name||row.role||row.unit)}</td><td className="mc-num">{amount(row.conversion_factor)}</td></tr>)}</tbody></table>
          <p className="mc-muted">Four distinct unit stages require corresponding configured conversions; this panel shows only records that actually exist in Django.</p>
          <button className={btn} onClick={()=>app.navTo('itemUnits','Unit Conversions')}>Edit unit conversions</button>
        </>}
      </div>
    </div>}
  </WorkspacePage>
}

const STOCKTAKE=['stock-counts','stock-count-items','items','inventory-balances'] as const
export function EnterpriseStocktakeSheet() {
  const {data,loading,error,reload}=useBackendRows(STOCKTAKE)
  const {execute,busy,error:mutationError}=useWrite(reload)
  const pathId=typeof window==='undefined'?'':window.location.pathname.split('/').filter(Boolean).at(-1)||''
  const [chosenId,setChosenId]=useState('')
  const id=chosenId||pathId
  const count=(data['stock-counts']||[]).find(row=>str(row.id)===id)
  const items=(data['stock-count-items']||[]).filter(row=>str(row.stock_count)===id).sort((a,b)=>str(a.bin_location||a.item_name).localeCompare(str(b.bin_location||b.item_name)))
  const storageKey='mc-blind-count-'+id
  const [draft,setDraft]=useState<Record<string,string>>({})
  const [unsynced,setUnsynced]=useState(false)
  useEffect(()=>{
    if(typeof window==='undefined'||!id)return
    try{const saved=window.localStorage.getItem(storageKey);if(saved){setDraft(JSON.parse(saved) as Record<string,string>);setUnsynced(true)}}catch{setDraft({})}
  },[id,storageKey])
  const update=(lineId:string,value:string)=>{
    const next={...draft,[lineId]:value}
    setDraft(next);setUnsynced(true)
    try{window.localStorage.setItem(storageKey,JSON.stringify(next))}catch{/* Private mode may disable storage */}
  }
  const sync=async()=>{
    if(!navigator.onLine){return}
    const pairs=Object.entries(draft).filter(([_,value])=>/^(\d+)(\.\d{1,4})?$/.test(value))
    if(!pairs.length)return
    const ok=await execute(async()=>{
      for(const [lineId,value] of pairs)await updateBackendRecord('stock-count-items',lineId,{physical_quantity:value})
    },'Physical counts synced to Django')
    if(ok){setDraft({});setUnsynced(false);try{localStorage.removeItem(storageKey)}catch{/* unavailable */}}
  }
  const submit=async()=>execute(()=>runBackendAction('stock-counts',id,'submit'),'Count sheet submitted to Cost Control')
  const app=useApp()
  const printBlindCount=()=>{
    if(!count||!items.length)return
    const esc=(v:unknown)=>str(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    const rows=items.map((line,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(line.bin_location||'—')+'</td><td>'+esc(line.item_name||'Article')+'</td><td>'+
      esc(line.unit_name||line.unit||'Base')+'</td><td>'+esc(draft[str(line.id)]??line.physical_quantity??'')+'</td></tr>').join('')
    const html='<!doctype html><html><head><meta charset="utf-8"><title>Blind stocktake '+esc(count.count_no)+
      '</title><style>@page{size:A4 portrait;margin:14mm}body{font:12px Arial,sans-serif;color:#1a3428}h1{font-size:21px;border-bottom:3px solid #146940;padding-bottom:14px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #b2c1b7;padding:8px;text-align:left}th{background:#eaf1ed}.sig{margin-top:50px;border-top:1px solid #768c7d;padding-top:8px}</style></head><body><h1>BLIND PHYSICAL STOCKTAKE SHEET</h1><p>Count: '+esc(count.count_no)+' · Store: '+esc(count.store_name||count.store)+' · Date: '+esc(count.count_date)+
      '</p><p>Physical counts only. Theoretical stock and variances are deliberately concealed from counters.</p><table><thead><tr><th>#</th><th>Shelf / Bin</th><th>Article</th><th>Base unit</th><th>Physical count</th></tr></thead><tbody>'+rows+
      '</tbody></table><div class="sig">Counted by: ____________________ Signature: ____________________ Date: __________</div></body></html>'
    const popup=window.open('','_blank')
    if(!popup){app.showWorkflowAlert('Stocktake print blocked','Allow pop-ups for this site and retry.','warning');return}
    popup.document.write(html);popup.document.close();popup.focus();popup.print()
  }
  const editable=count&&['draft','in_progress'].includes(str(count.status))
  return <WorkspacePage section="Inventory / Physical count" title="Blind stocktake entry"
    subtitle="Shelf-ordered counts · no theoretical quantity revealed to counters · offline draft saved locally."
    actions={<><button className={btn} disabled={!count||!items.length} onClick={printBlindCount}><Icon name="print" size={15}/> Print blind count sheet</button><button className={btn} disabled={loading} onClick={()=>void reload()}><Icon name="refresh" size={15}/> Refresh</button></>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {count&&<WorkflowPrerequisite domain="stock_count" record={count} action="submit"/>}
    {count&&editable&&unsynced&&<div className="mc-workflow-prerequisite" role="status"><Icon name="info" size={17}/><div><strong>Unsynced physical counts</strong><p>Changes on this device are not yet saved to the server.</p><small>Next: Sync saved counts before submitting.</small></div></div>}
    {!loading&&!error&&<label className="mc-field mc-picker"><span>Count session</span><select value={id} onChange={e=>setChosenId(e.target.value)}>
      <option value="">Choose assigned count sheet</option>{(data['stock-counts']||[]).map(row=><option value={str(row.id)} key={str(row.id)}>{str(row.count_no)} · {str(row.store_name||row.store)} · {str(row.status)}</option>)}
    </select></label>}
    {!loading&&!error&&(!count?<StateMessage empty>Choose a valid stocktake session to count articles.</StateMessage>:<>
      <section className="mc-dense-panel mc-stocktake-head">
        <div><strong>{str(count.count_no)}</strong><small>{str(count.store_name||count.store)} · {dateStr(count.count_date)}</small></div><StatusPill status={count.status}/>
        <div className={unsynced?'mc-state mc-state-warn':'mc-state'}>{unsynced?'Local changes not synced':'Count sheet synced'}</div>
      </section>
      <section className="mc-dense-panel mc-count-grid"><header className="mc-panel-title">Physical shelf count <small>{items.length} articles</small></header>
        <div className="mc-table-scroll"><table className="mc-simple-table"><thead><tr><th>Shelf / Bin</th><th>Article</th><th>Base unit</th><th>Physical count</th></tr></thead>
        <tbody>{items.map((line,index)=><tr key={str(line.id)}><td>{str(line.bin_location)||'—'}</td>
          <td><b>{str(line.item_name||line.item)}</b></td><td>{str(line.unit_name||line.unit||'Base')}</td>
          <td><input className="mc-count-input" aria-label={'Physical count for '+str(line.item_name||line.item)} type="number" step="0.0001" min="0"
            disabled={!editable||busy} value={draft[str(line.id)]??str(line.physical_quantity??'')}
            onChange={event=>update(str(line.id),event.target.value)}
            onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();(event.currentTarget.closest('tr')?.nextElementSibling?.querySelector('input') as HTMLInputElement|null)?.focus()}}}/>
            <small className="mc-mono">#{index+1}</small></td></tr>)}</tbody></table></div>
        <div className="mc-decision-bar"><button className={btn} disabled={!unsynced||busy||!navigator.onLine} onClick={()=>void sync()}>
            <Icon name="sync" size={16}/> Sync saved counts</button>
          <ConfirmTransaction title="Submit blind count?" description="Confirm all shelf and bottle quantities have synced. Django will lock this count sheet for review."
            confirmLabel="Submit count sheet" className={primary} disabled={busy||!editable||unsynced} busy={busy} onConfirm={submit}>
            <Icon name="fact_check" size={16}/> Submit for review</ConfirmTransaction></div>
      </section>
    </>)}
  </WorkspacePage>
}

export function EnterpriseRecipeDetail() {
  const {data,loading,error,reload}=useBackendRows(['recipes','recipe-ingredients','items','units'])
  const {execute,busy,error:mutationError}=useWrite(reload)
  const pathId=typeof window==='undefined'?'':window.location.pathname.split('/').filter(Boolean).at(-1)||''
  const [chosenId,setChosenId]=useState('')
  const id=chosenId||pathId
  const recipe=(data.recipes||[]).find(r=>str(r.id)===id)
  const ingredients=(data['recipe-ingredients']||[]).filter(r=>str(r.recipe)===id)
  const subRecipes=(data.recipes||[]).filter(r=>str(r.id)!==id&&str(r.outlet)===str(recipe?.outlet)&&r.status==='published'&&r.is_sub_recipe)
  const items=data.items||[]
  const [article,setArticle]=useState('')
  const [subRecipe,setSubRecipe]=useState('')
  const [quantity,setQuantity]=useState('1.00')
  const [trim,setTrim]=useState('0')
  const [changes,setChanges]=useState<Record<string,string>>({})
  const editable=str(recipe?.status)==='draft'
  const update=async(line:ApiRow)=>{
    const percentage=changes[str(line.id)]??str(line.trim_percent)
    if(!editable||Number(percentage)<0||Number(percentage)>=100)return
    await execute(()=>updateBackendRecord('recipe-ingredients',str(line.id),{trim_percent:percentage}),'Ingredient yield updated')
  }
  const add=async()=>{
    if((!article&&!subRecipe)||(article&&subRecipe)||!(Number(quantity)>0)||Number(trim)<0||Number(trim)>=100)return
    await execute(()=>createBackendRecord('recipe-ingredients',{
      recipe:id,item:subRecipe?null:article,sub_recipe:subRecipe||null,
      quantity,trim_percent:trim,
    }),subRecipe?'Published sub-recipe added':'Article ingredient added')
    setArticle('');setSubRecipe('');setQuantity('1');setTrim('0')
  }
  const portions=dec(recipe?.yield_quantity)||1
  const cost=dec(recipe?.total_cost)
  const portionCost=dec(recipe?.cost_per_yield)
  const selling=dec(recipe?.selling_price)
  const margin=selling>0?(selling-portionCost)/selling*100:0
  return <WorkspacePage section="F&B / Recipe management" title={str(recipe?.name)||'Recipe costing'}
    subtitle="Portion yields, Article consumption, trim percentage, actual ingredient costs and gross margin.">
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<label className="mc-field mc-picker"><span>Recipe</span><select value={id} onChange={e=>setChosenId(e.target.value)}>
      <option value="">Choose recipe</option>{(data.recipes||[]).map(row=><option value={str(row.id)} key={str(row.id)}>{str(row.code)} · {str(row.name)}</option>)}
    </select></label>}
    {!loading&&!error&&(!recipe?<StateMessage empty>Choose an accessible recipe to review its ingredient tree.</StateMessage>:<>
      <div className="mc-compact-metrics"><div><span>Cost per portion</span><strong>UGX {amount(portionCost)}</strong></div>
        <div><span>Target food cost</span><strong>{str(recipe.target_food_cost_percent)}%</strong></div>
        <div><span>Gross margin</span><strong>{margin.toFixed(1)}%</strong></div><div><span>Yield</span><strong>{amount(portions)} {str(recipe.yield_unit)}</strong></div></div>
      <div className="mc-split mc-recipe-split">
        <section className="mc-dense-panel"><header className="mc-panel-title">Ingredient tree <StatusPill status={recipe.status}/></header>
          <div className="mc-recipe-tree"><div className="mc-tree-root"><Icon name="restaurant_menu" size={17}/><strong>{str(recipe.name)}</strong><span>UGX {amount(cost)}</span></div>
            {ingredients.map(line=><div className="mc-tree-ingredient" key={str(line.id)}>
              <div><Icon name="subdirectory_arrow_right" size={15}/><span><strong>{str(line.sub_recipe_name||line.item_name||line.item)}</strong><small>{line.sub_recipe?'Sub-recipe · yielded portions':'Article · base units'}: {str(line.base_quantity)} · Gross: {str(line.gross_base_quantity)}</small></span></div>
              <div className="mc-tree-cost"><strong>UGX {amount(line.ingredient_cost)}</strong><small>Unit UGX {amount(line.current_base_unit_cost)}</small></div>
              <label><span>Trim / waste {str(changes[str(line.id)]??line.trim_percent)}%</span>
                <input type="range" min="0" max="99" step="0.5" value={str(changes[str(line.id)]??line.trim_percent)}
                  disabled={!editable||busy} onChange={event=>setChanges(old=>({...old,[str(line.id)]:event.target.value}))}/></label>
              <button className={btn} disabled={!editable||busy||changes[str(line.id)]===undefined} onClick={()=>void update(line)}>Apply trim</button>
            </div>)}
          </div>
          <div className="mc-alert mc-muted">Nested recipes use their published yield units. Consumption expands recursively to stock Articles on POS import; circular references and cross-outlet recipes are blocked server-side.</div>
        </section>
        <section className="mc-dense-panel mc-form-panel"><header className="mc-panel-title">Add ingredient</header>
          <label className="mc-field"><span>Article</span><select disabled={!!subRecipe} value={article} onChange={e=>setArticle(e.target.value)}>
            <option value="">Select Article</option>{items.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
          <label className="mc-field"><span>Or published sub-recipe</span><select disabled={!!article} value={subRecipe} onChange={e=>setSubRecipe(e.target.value)}>
            <option value="">Select a sub-recipe</option>{subRecipes.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)} · {str(r.yield_unit)}</option>)}</select></label>
          <div className="mc-field-pair"><FormField label="Ingredient quantity" type="number" value={quantity} onChange={setQuantity}/>
            <FormField label="Trim %" type="number" value={trim} onChange={setTrim}/></div>
          <button className={primary} disabled={!editable||busy||(!article&&!subRecipe)||!(Number(quantity)>0)||Number(trim)>=100} onClick={()=>void add()}>
            <Icon name="add" size={15}/> Add ingredient</button>
          <div className="mc-total-line"><span>Total batch cost</span><strong>UGX {amount(cost)}</strong></div>
          <div className="mc-total-line"><span>Suggested price / target</span><strong>UGX {amount(recipe.suggested_selling_price)}</strong></div>
          <div className="mc-total-line"><span>Actual selling price</span><strong>UGX {amount(selling)}</strong></div>
        </section>
      </div>
    </>)}
  </WorkspacePage>
}

export function EnterprisePosReconciliation() {
  const {data,loading,error,reload}=useBackendRows(['pos-imports','pos-sale-lines','pos-plu-mappings','recipes','stores'])
  const {execute,busy,error:mutationError}=useWrite(reload)
  const [selected,setSelected]=useState('')
  const [plu,setPlu]=useState('')
  const [name,setName]=useState('')
  const [recipe,setRecipe]=useState('')
  const batches=data['pos-imports']||[]
  const batch=batches.find(r=>str(r.id)===selected)
  const lines=(data['pos-sale-lines']||[]).filter(r=>str(r.batch)===selected)
  const mappings=data['pos-plu-mappings']||[]
  const unmapped=lines.filter(line=>!mappings.some(m=>str(m.external_plu)===str(line.external_plu)&&str(m.outlet)===str(batch?.outlet)))
  const createMapping=async()=>{
    if(!plu||!recipe||!batch)return
    const ok=await execute(()=>createBackendRecord('pos-plu-mappings',{
      external_plu:plu,external_name:name,outlet:batch.outlet,
      recipe,is_active:true,
    }),'PLU mapping saved')
    if(ok){setPlu('');setName('');setRecipe('')}
  }
  const rerun=async()=>execute(()=>runBackendAction('pos-imports',selected,'run-depletion'),'POS depletion processed')
  const cols:EnterpriseColumn<ApiRow>[]=[
    {id:'plu',label:'PLU',value:r=>str(r.external_plu)},
    {id:'name',label:'POS menu item',value:r=>str(r.external_name)},
    {id:'qty',label:'Sold Qty',value:r=>dec(r.quantity),numeric:true},
    {id:'mapped',label:'Linked recipe',value:r=>str(mappings.find(m=>str(m.external_plu)===str(r.external_plu))?.recipe_name||'Unmapped'),
      render:r=><StatusPill status={mappings.some(m=>str(m.external_plu)===str(r.external_plu))?'mapped':'unmapped'}/>},
    {id:'processed',label:'Depletion',value:r=>str(r.inventory_changes_applied),render:r=><StatusPill status={r.inventory_changes_applied?'processed':'pending'}/>},
  ]
  return <WorkspacePage section="F&B / POS integration" title="POS sales reconciliation"
    subtitle="Nightly import register, unresolved PLU mappings and server-side sales depletion."
    actions={<button className={btn} onClick={()=>void reload()}><Icon name="refresh" size={15}/> Refresh</button>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<div className="mc-split mc-pos-split">
      <aside className="mc-dense-panel mc-master-list"><header className="mc-panel-title">POS import batches <span>{batches.length}</span></header>
        {batches.map(row=><button key={str(row.id)} className={'mc-master-row'+(selected===str(row.id)?' is-active':'')} onClick={()=>setSelected(str(row.id))}>
          <span><strong>{dateStr(row.business_date)}</strong><StatusPill status={row.status}/></span><small>{str(row.outlet_name)} · {str(row.source)}</small><small>{str(row.line_count)} sale lines</small></button>)}
      </aside>
      <section className="mc-dense-panel mc-pos-right">{!batch?<div className="mc-empty-state">Select an import batch to reconcile its menu items.</div>:<>
        <header className="mc-panel-title">PLU reconciliation <span>{unmapped.length} unmapped</span></header>
        <EnterpriseTable<ApiRow> label="POS sale items" rows={lines} columns={cols} onOpen={row=>{setPlu(str(row.external_plu));setName(str(row.external_name))}} />
        {plu&&<div className="mc-inline-form"><strong>Map PLU {plu} · {name}</strong>
          <label className="mc-field"><span>Linked recipe</span><select value={recipe} onChange={e=>setRecipe(e.target.value)}>
            <option value="">Choose recipe</option>{(data.recipes||[]).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
          <button className={primary} disabled={!recipe||busy} onClick={()=>void createMapping()}>Save PLU mapping</button></div>}
        <div className="mc-decision-bar"><ConfirmTransaction title="Run POS depletion?" description="The backend will explode mapped recipes, post stock movements, and retain unresolved PLUs for reconciliation."
          confirmLabel="Run depletion" className={primary} busy={busy} disabled={busy||str(batch.status)==='processed'||unmapped.length>0} onConfirm={rerun}>
          <Icon name="sync" size={16}/> Re-run depletion</ConfirmTransaction></div>
        {unmapped.length>0&&<div className="mc-alert">Resolve {unmapped.length} unmapped PLU(s) before running this batch.</div>}
      </>}</section>
    </div>}
  </WorkspacePage>
}

type ReceiptCount={qty:string;rejected:string;reason:string;batch:string;expiry:string;temperature:string}
export function EnterpriseBlindReceiving() {
  const {data,loading,error,reload}=useBackendRows(['purchase-orders','purchase-order-items','grns'])
  const {execute,busy,error:mutationError}=useWrite(reload)
  const pathId=typeof window==='undefined'?'':window.location.pathname.split('/').filter(Boolean).at(-1)||''
  const [chosenId,setChosenId]=useState('')
  const id=chosenId||pathId
  const order=(data['purchase-orders']||[]).find(r=>str(r.id)===id)
  const lines=(data['purchase-order-items']||[]).filter(r=>str(r.purchase_order)===id)
  const [counts,setCounts]=useState<Record<string,ReceiptCount>>({})
  const [invoice,setInvoice]=useState('')
  const [delivery,setDelivery]=useState('')
  const [shortNote,setShortNote]=useState('')
  const get=(itemId:string)=>counts[itemId]||{qty:'',rejected:'0',reason:'',batch:'',expiry:'',temperature:''}
  const set=(itemId:string,field:keyof ReceiptCount,value:string)=>setCounts(old=>({...old,[itemId]:{...get(itemId),[field]:value}}))
  const payload=lines.map(line=>{
    const row=get(str(line.id))
    return {purchase_order_item:line.id,quantity_received:row.qty,quantity_rejected:row.rejected,
      rejection_reason:row.reason,batch_number:row.batch,expiry_date:row.expiry||null,
      delivery_temperature:row.temperature||null}
  }).filter(line=>Number(line.quantity_received)>0)
  const invalid=payload.some(line=>!Number.isFinite(Number(line.quantity_received))||Number(line.quantity_rejected)<0
    ||Number(line.quantity_rejected)>Number(line.quantity_received)
    ||(Number(line.quantity_rejected)>0&&!line.rejection_reason.trim()))
  const submit=async()=>{
    if(!invoice.trim()||!payload.length||invalid)return
    const ok=await execute(()=>runBackendAction('purchase-orders',id,'receive-delivery',{
      supplier_invoice_no:invoice,delivery_note_no:delivery,short_delivery_reason:shortNote||'Partial / physical quantity recorded by Receiving Clerk',
      lines:payload,
    }),'Blind GRN submitted to Storekeeper posting queue')
    if(ok){setInvoice('');setDelivery('');setCounts({})}
  }
  return <WorkspacePage section="Receiving / Loading bay" title="Blind goods receiving"
    subtitle="Enter physical quantities independently. Supplier rates and PO ordered quantities are intentionally hidden."
    actions={<span className="mc-confidential"><Icon name="visibility_off" size={14}/> Commercial values masked</span>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {order&&<WorkflowPrerequisite domain="goods_receipt" record={order} action="receive"/>}
    {order&&(!invoice.trim()||!payload.length||invalid)&&<div className="mc-workflow-prerequisite" role="status"><Icon name="info" size={17}/><div><strong>Receiving details required</strong><p>{invalid?'Correct rejected quantities and provide reasons.':!invoice.trim()?'Enter the supplier invoice reference.':'Count at least one article with valid quantities.'}</p><small>Next: Complete the blind count; approved order quantities stay masked.</small></div></div>}
    {!loading&&!error&&<label className="mc-field mc-picker"><span>Scheduled supplier delivery</span><select value={id} onChange={e=>{setChosenId(e.target.value);setCounts({})}}>
      <option value="">Select issued PO</option>{(data['purchase-orders']||[]).filter(row=>['issued','partially_received'].includes(str(row.status))).map(row=><option value={str(row.id)} key={str(row.id)}>{str(row.lpo_number||row.po_number)} · {str(row.supplier_name||row.supplier)}</option>)}
    </select></label>}
    {!loading&&!error&&(!order?<StateMessage empty>Choose an issued purchase order from your permitted delivery queue.</StateMessage>:<>
      <section className="mc-dense-panel mc-receiving-masthead"><strong>Delivery against {str(order.lpo_number||order.po_number)}</strong>
        <span>Supplier: {str(order.supplier_name||order.supplier)}</span><StatusPill status={order.status}/></section>
      <div className="mc-split mc-receive-split">
        <section className="mc-dense-panel"><header className="mc-panel-title">Blind count lines</header>
          <div className="mc-table-scroll"><table className="mc-simple-table mc-blind-table">
            <thead><tr><th>Article / SKU</th><th>PO Qty</th><th>Price</th><th>Counted Qty</th><th>Rejected Qty</th><th>Reject reason</th><th>Batch / Lot</th><th>Expiry</th><th>Temp °C</th></tr></thead>
            <tbody>{lines.map(line=>{
              const key=str(line.id), row=get(key)
              return <tr key={key}><td><strong>{str(line.item_name||line.item)}</strong></td><td>***</td><td>***</td>
                <td><input aria-label={'Counted '+key} type="number" min="0" step="0.01" value={row.qty} onChange={e=>set(key,'qty',e.target.value)} /></td>
                <td><input aria-label={'Rejected '+key} type="number" min="0" step="0.01" value={row.rejected} onChange={e=>set(key,'rejected',e.target.value)} /></td>
                <td><input aria-label={'Rejection reason '+key} value={row.reason} onChange={e=>set(key,'reason',e.target.value)} /></td>
                <td><input aria-label={'Batch '+key} value={row.batch} onChange={e=>set(key,'batch',e.target.value)} /></td>
                <td><input aria-label={'Expiry '+key} type="date" value={row.expiry} onChange={e=>set(key,'expiry',e.target.value)} /></td>
                <td><input aria-label={'Temperature '+key} type="number" step="0.1" value={row.temperature} onChange={e=>set(key,'temperature',e.target.value)}/></td>
              </tr>
            })}</tbody></table></div>
        </section>
        <section className="mc-dense-panel mc-form-panel"><header className="mc-panel-title">Delivery references</header>
          <FormField label="Supplier invoice no. *" value={invoice} onChange={setInvoice}/>
          <FormField label="Delivery note no." value={delivery} onChange={setDelivery}/>
          <FormField label="Reason for partial delivery" value={shortNote} onChange={setShortNote}/>
          <div className="mc-alert mc-muted">This action records an inspected/unposted GRN. Only a Storekeeper can post accepted quantities to Stock on Hand.</div>
          <ConfirmTransaction title="Submit blind receiving record?" description="The counted and rejected quantities will be recorded with the delivery's batch and temperature data."
            confirmLabel="Create GRN" className={primary} disabled={busy||!invoice.trim()||!payload.length||invalid} busy={busy} onConfirm={submit}>
            <Icon name="local_shipping" size={16}/> Submit GRN to Stores
          </ConfirmTransaction>
        </section>
      </div>
    </>)}
  </WorkspacePage>
}

export function EnterpriseDepartmentReturn() {
  const {data,loading,error,reload}=useBackendRows([
    'store-returns','store-return-items','stores','departments','items',
  ])
  const {execute,busy,error:mutationError}=useWrite(reload)
  const [store,setStore]=useState('')
  const [department,setDepartment]=useState('')
  const [reason,setReason]=useState('')
  const [draftId,setDraftId]=useState('')
  const [article,setArticle]=useState('')
  const [quantity,setQuantity]=useState('')
  const [conditionNote,setConditionNote]=useState('')
  const app=useApp()
  const returns=data['store-returns']||[]
  const [printId,setPrintId]=useState('')
  const printed=returns.find(r=>str(r.id)===printId)
  const printLines=(data['store-return-items']||[]).filter(r=>str(r.store_return)===printId)
  const onPrint=()=>{
    if(!printed)return
    const deptName=(data.departments||[]).find(r=>str(r.id)===str(printed.department))?.name
    const printedOk=printReturnNote('department',printed,printLines,data.items||[],data.stores||[],str(deptName||'Department unavailable'),app.user.name)
    if(!printedOk)app.showWorkflowAlert('Unable to print Department Return Note','Select a return with recorded articles and allow pop-ups for this site.','warning')
  }
  const lines=(data['store-return-items']||[]).filter(r=>str(r.store_return)===draftId)
  const draft=returns.find(r=>str(r.id)===draftId&&!r.inventory_changes_applied)
  const validQuantity=/^\d+(?:\.\d{1,4})?$/.test(quantity.trim())&&Number(quantity)>0
  const create=async()=>{
    if(!store||!department||!reason.trim())return
    const ok=await execute(()=>createBackendRecord('store-returns',{
      store,department,reason:reason.trim(),
    }),'Department return draft created')
    if(ok){setReason('');setStore('');setDepartment('')}
  }
  const addLine=async()=>{
    if(!draft||!article||!validQuantity)return
    const ok=await execute(()=>createBackendRecord('store-return-items',{
      store_return:draftId,item:article,quantity,condition_note:conditionNote.trim(),
    }),'Department return article recorded')
    if(ok){setArticle('');setQuantity('');setConditionNote('')}
  }
  return <WorkspacePage section="Stores / Returns" title="Department returns"
    subtitle="Accept unused goods only against signed departmental issues. The Storekeeper posts accepted quantities back to stock; the server checks unreturned issued balances.">
    <StateMessage loading={loading} error={error||mutationError}/>
    {printed&&<WorkflowPrerequisite domain="department_return" record={printed} action="apply"/>}
    {draft&&lines.length===0&&<div className="mc-workflow-prerequisite" role="status"><Icon name="info" size={17}/><div><strong>Return needs article lines</strong><p>This draft has no recorded quantities.</p><small>Next: Add an article and its physical return quantity.</small></div></div>}
    {!loading&&!error&&<div className="mc-split mc-admin-split">
      <EnterpriseTable<ApiRow> label="Department return register" rows={returns} columns={[
        {id:'ref',label:'Return',value:r=>str(r.return_no)},
        {id:'store',label:'Store',value:r=>str(r.store)},
        {id:'dept',label:'Department',value:r=>str(r.department)},
        {id:'state',label:'Stock posted',value:r=>r.inventory_changes_applied?'Posted':'Draft',render:r=><StatusPill status={r.inventory_changes_applied?'posted':'draft'}/>},
      ]}/>
      <section className="mc-dense-panel mc-form-panel">
        <header className="mc-panel-title">Department return documents & register</header>
        <label className="mc-field"><span>Return note</span><select value={printId} onChange={e=>setPrintId(e.target.value)}>
          <option value="">Select recorded return</option>{returns.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.return_no)} · {r.inventory_changes_applied?'Posted':'Draft'}</option>)}
        </select></label>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button type="button" className={btn} disabled={!printed||!printLines.length} onClick={onPrint}><Icon name="print" size={16}/> Print Department Return Note</button>
          <button type="button" className={btn} onClick={()=>exportReturnRegister('department',returns,data['store-return-items']||[],data.items||[],data.stores||[],data.departments||[])}><Icon name="download" size={16}/> Export Department Return Register</button>
          <button type="button" className={btn} onClick={()=>void verifyReturnLedger('department',app)}><Icon name="fact_check" size={16}/> Verify stock ledger</button>
        </div>
                <header className="mc-panel-title">1. Register a physical department return</header>
        <label className="mc-field"><span>Receiving store</span><select value={store} onChange={e=>setStore(e.target.value)}>
          <option value="">Select your assigned store</option>
          {(data.stores||[]).filter(r=>r.is_active).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}
        </select></label>
        <label className="mc-field"><span>Returning department</span><select value={department} onChange={e=>setDepartment(e.target.value)}>
          <option value="">Select department</option>
          {(data.departments||[]).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}
        </select></label>
        <label className="mc-field"><span>Reason and physical condition</span><textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why are the signed-out articles being returned?"/></label>
        <button className={primary} disabled={busy||!store||!department||!reason.trim()} onClick={()=>void create()}>Create return draft</button>
        <header className="mc-panel-title">2. Count returned articles</header>
        <label className="mc-field"><span>Draft return</span><select value={draftId} onChange={e=>{setDraftId(e.target.value);setArticle('');setQuantity('')}}>
          <option value="">Select draft</option>
          {returns.filter(r=>!r.inventory_changes_applied).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.return_no)}</option>)}
        </select></label>
        <label className="mc-field"><span>Returned article</span><select value={article} onChange={e=>setArticle(e.target.value)}>
          <option value="">Select article</option>
          {(data.items||[]).filter(r=>!lines.some(x=>str(x.item)===str(r.id))).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}
        </select></label>
        <label className="mc-field"><span>Quantity in base units (4 decimals)</span><input type="number" min="0" step="0.0001" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        <label className="mc-field"><span>Condition / inspection note</span><textarea rows={2} value={conditionNote} onChange={e=>setConditionNote(e.target.value)}/></label>
        <button className={primary} disabled={busy||!draft||!article||!validQuantity} onClick={()=>void addLine()}>Add return line</button>
        <div className="mc-alert mc-muted">{lines.length} line(s) on selected draft. Quantities exceeding signed, unreturned issues will be rejected by the server.</div>
        <ConfirmTransaction title="Post department return to stock?"
          description="This action increases store stock once, records an immutable ledger entry, and locks the return. Verify physical articles and quantities first."
          confirmLabel="Post return" disabled={busy||!draft||!lines.length} busy={busy}
          onConfirm={()=>execute(()=>runBackendAction('store-returns',draftId,'apply'),'Department return posted to stock ledger')}>
          Post accepted return
        </ConfirmTransaction>
      </section>
    </div>}
  </WorkspacePage>
}

export function EnterpriseSupplierReturn() {
  const {data,loading,error,reload}=useBackendRows([
    'grns','grn-items','purchase-orders','supplier-returns','supplier-return-items','stores','items',
  ])
  const {execute,busy,error:mutationError}=useWrite(reload)
  const app=useApp()
  const [printId,setPrintId]=useState('')
  const printRecord=(data['supplier-returns']||[]).find(r=>str(r.id)===printId)
  const printLines=(data['supplier-return-items']||[]).filter(r=>str(r.supplier_return)===printId)
  const onPrint=()=>{
    if(!printRecord)return
    const supplierName=app.data.suppliers.find(r=>str(r.id)===str(printRecord.supplier))?.name
    const grnNumber=(data.grns||[]).find(r=>str(r.id)===str(printRecord.goods_receipt))?.grn_number
    const ok=printReturnNote('supplier',{...printRecord,grn_number:grnNumber},printLines,data.items||[],data.stores||[],str(supplierName||'Supplier unavailable'),app.user.name)
    if(!ok)app.showWorkflowAlert('Unable to print Supplier Return Note','Select a return with recorded articles and allow pop-ups for this site.','warning')
  }
  const [grn,setGrn]=useState('')
  const [store,setStore]=useState('')
  const [reason,setReason]=useState('')
  const [draftId,setDraftId]=useState('')
  const [article,setArticle]=useState('')
  const [quantity,setQuantity]=useState('')
  const [representative,setRepresentative]=useState('')
  const [creditReference,setCreditReference]=useState('')
  const [replacementDate,setReplacementDate]=useState('')
  const postedGrns=(data.grns||[]).filter(r=>str(r.status)==='posted')
  const receipt=postedGrns.find(r=>str(r.id)===grn)
  const order=(data['purchase-orders']||[]).find(r=>str(r.id)===str(receipt?.purchase_order))
  const drafts=(data['supplier-returns']||[]).filter(r=>str(r.status)==='draft')
  const selectedDraft=drafts.find(r=>str(r.id)===draftId)
  const returnLines=(data['supplier-return-items']||[]).filter(r=>str(r.supplier_return)===draftId)
  const postedReturn=(data['supplier-returns']||[]).filter(r=>str(r.status)==='posted'&&!r.supplier_acknowledged_at)
  const selectedReceiptLines=(data['grn-items']||[]).filter(r=>
    str(r.goods_receipt)===str(selectedDraft?.goods_receipt) && r.inventory_changes_applied===true
  )
  const articleIds=new Set(selectedReceiptLines.map(r=>str(r.item)))
  const eligibleArticles=(data.items||[]).filter(r=>articleIds.has(str(r.id)))
  const validQty=/^\\d+(?:\\.\\d{1,4})?$/.test(quantity.trim())&&Number(quantity)>0
  const [ackId,setAckId]=useState('')
  const submit=async()=>{
    if(!receipt||!store||!reason.trim()||!order?.supplier)return
    const ok=await execute(()=>createBackendRecord('supplier-returns',{
      supplier:order.supplier,goods_receipt:grn,store,reason:reason.trim(),
    }),'Supplier return draft created')
    if(ok){setGrn('');setStore('');setReason('')}
  }
  const addLine=async()=>{
    if(!draftId||!articleIds.has(article)||!validQty)return
    const ok=await execute(()=>createBackendRecord('supplier-return-items',{
      supplier_return:draftId,item:article,quantity,reason:reason.trim()||'Supplier return',
    }),'Return article added')
    if(ok){setArticle('');setQuantity('')}
  }
  return <WorkspacePage section="Stores / Supplier returns" title="Return to supplier"
    subtitle="The assigned Storekeeper returns stock from a posted GRN. Finance separately manages supplier credit approval.">
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<OperationalSummary label="Supplier return workload" metrics={[
      {label:'Draft returns',value:drafts.length,description:'Require recorded article quantities',tone:drafts.length?'attention':'neutral'},
      {label:'Awaiting acknowledgement',value:postedReturn.length,description:'Posted dispatches not yet acknowledged',tone:postedReturn.length?'attention':'neutral'},
      {label:'Posted GRNs',value:postedGrns.length,description:'Potential eligible source receipts'},
    ]} nextAction={selectedDraft?'Add verified return lines, post with confirmation, then record supplier acknowledgement.':'Select a posted GRN to prepare a supplier return. Stock changes only when the return is posted.'}/>}
    {selectedDraft&&<WorkflowPrerequisite domain="supplier_return" record={selectedDraft} action="apply"/>}
    {selectedDraft&&returnLines.length===0&&<div className="mc-workflow-prerequisite" role="status"><Icon name="info" size={17}/><div><strong>No articles to dispatch</strong><p>This supplier return has no recorded article quantities.</p><small>Next: Add accepted GRN articles and confirm available stock.</small></div></div>}
    {!loading&&!error&&<div className="mc-split mc-admin-split">
      <EnterpriseTable<ApiRow> label="Supplier returns" rows={data['supplier-returns']||[]} columns={[
        {id:'return',label:'Return reference',value:r=>str(r.return_no)},
        {id:'grn',label:'Linked GRN',value:r=>str(r.goods_receipt)},
        {id:'reason',label:'Reason',value:r=>str(r.reason)},
        {id:'status',label:'Status',value:r=>str(r.status),render:r=><StatusPill status={r.status}/>},
        {id:'credit',label:'Credit note',value:r=>str(r.credit_note_number)},
      ]}/>
      <section className="mc-dense-panel mc-form-panel">
        <header className="mc-panel-title">Supplier return documents & register</header>
        <label className="mc-field"><span>Return note</span><select value={printId} onChange={e=>setPrintId(e.target.value)}>
          <option value="">Select recorded return</option>{(data['supplier-returns']||[]).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.return_no)} · {str(r.status)}</option>)}
        </select></label>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button type="button" className={btn} disabled={!printRecord||!printLines.length} onClick={onPrint}><Icon name="print" size={16}/> Print Supplier Return Note</button>
          <button type="button" className={btn} onClick={()=>exportReturnRegister('supplier',data['supplier-returns']||[],data['supplier-return-items']||[],data.items||[],data.stores||[],app.data.suppliers)}><Icon name="download" size={16}/> Export Supplier Return Register</button>
          <button type="button" className={btn} onClick={()=>void verifyReturnLedger('supplier',app)}><Icon name="fact_check" size={16}/> Verify stock ledger</button>
        </div>
                <header className="mc-panel-title">1. Create supplier return</header>
        <label className="mc-field"><span>Posted GRN</span><select value={grn} onChange={e=>{setGrn(e.target.value);setStore('')}}>
          <option value="">Select posted GRN</option>{postedGrns.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.grn_number)}</option>)}</select></label>
        <label className="mc-field"><span>Return source store</span><select value={store} onChange={e=>setStore(e.target.value)}>
          <option value="">Select assigned store</option>{(data.stores||[]).filter(r=>!receipt||str(r.id)===str(order?.store)).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
        <label className="mc-field"><span>Reason for return</span><textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2}/></label>
        <button className={primary} disabled={busy||!receipt||!store||!reason.trim()||!order?.supplier} onClick={()=>void submit()}>Create draft</button>
        <header className="mc-panel-title">2. Record return articles</header>
        <label className="mc-field"><span>Draft return</span><select value={draftId} onChange={e=>{setDraftId(e.target.value);setArticle('');setQuantity('')}}>
          <option value="">Select draft</option>{drafts.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.return_no)}</option>)}</select></label>
        <label className="mc-field"><span>Article received on GRN</span><select value={article} onChange={e=>setArticle(e.target.value)}>
          <option value="">Select article</option>{eligibleArticles.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
        <label className="mc-field"><span>Return quantity (base units)</span><input type="number" min="0" step="0.0001" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        <div className="mc-alert mc-muted">{returnLines.length} line(s) on this draft. The server verifies the remaining accepted GRN quantity and physical stock again when posting.</div>
        <button className={primary} disabled={busy||!draftId||!articleIds.has(article)||!validQty} onClick={()=>void addLine()}>Add return line</button>
        <ConfirmTransaction title="Dispatch goods back to supplier?" description="Posting reduces store stock once and records an immutable stock movement. Confirm the articles and quantities before dispatch." confirmLabel="Post supplier return" disabled={busy||!draftId||returnLines.length===0} busy={busy} onConfirm={()=>execute(()=>runBackendAction('supplier-returns',draftId,'apply'),'Supplier return posted to stock ledger')}>Post return to supplier</ConfirmTransaction>
        <header className="mc-panel-title">3. Supplier acknowledgement</header>
        <label className="mc-field"><span>Dispatched return</span><select value={ackId} onChange={e=>setAckId(e.target.value)}>
          <option value="">Select posted return</option>{postedReturn.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.return_no)}</option>)}</select></label>
        <label className="mc-field"><span>Supplier representative</span><input value={representative} onChange={e=>setRepresentative(e.target.value)}/></label>
        <label className="mc-field"><span>Supplier credit note reference (optional)</span><input value={creditReference} onChange={e=>setCreditReference(e.target.value)}/></label>
        <label className="mc-field"><span>Replacement expected (optional)</span><input type="date" value={replacementDate} onChange={e=>setReplacementDate(e.target.value)}/></label>
        <button className={primary} disabled={busy||!ackId||!representative.trim()} onClick={()=>void execute(()=>runBackendAction('supplier-returns',ackId,'acknowledge',{
          acknowledged_by:representative.trim(),credit_note_number:creditReference.trim(),replacement_expected_date:replacementDate||null,
        }),'Supplier acknowledgement recorded')}>Record acknowledgement</button>
      </section>
    </div>}
  </WorkspacePage>
}

export function EnterpriseWasteLogger() {
  const {data,loading,error,reload}=useBackendRows(['stores','items','units','waste-records'])
  const {execute,busy,error:mutationError}=useWrite(reload)
  const [store,setStore]=useState('')
  const [article,setArticle]=useState('')
  const [unit,setUnit]=useState('')
  const [quantity,setQuantity]=useState('1')
  const [reason,setReason]=useState('broken_service')
  const [note,setNote]=useState('')
  const submit=async()=>{
    if(!store||!article||!(Number(quantity)>0)||!reason)return
    const ok=await execute(async()=>{
      const waste=await createBackendRecord('waste-records',{
        outlet:store,item:article,unit:unit||null,quantity,reason_code:reason,note,
      })
      await runBackendAction('waste-records',str(waste.id),'submit')
    },'Waste recorded and stock updated')
    if(ok){setArticle('');setQuantity('1');setNote('')}
  }
  return <WorkspacePage section="Outlet / Loss control" title="Waste & spoilage"
    subtitle="Fast operational loss logging with mandatory reason codes and controlled stock deduction.">
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<div className="mc-split mc-admin-split">
      <EnterpriseTable<ApiRow> label="Waste records" rows={data['waste-records']||[]} columns={[
        {id:'item',label:'Article',value:r=>str(r.item_name||r.item)},
        {id:'outlet',label:'Outlet',value:r=>str(r.outlet_name||r.outlet)},
        {id:'qty',label:'Base quantity',value:r=>dec(r.base_quantity),numeric:true},
        {id:'reason',label:'Reason',value:r=>str(r.reason_code)},
        {id:'status',label:'Status',value:r=>str(r.status),render:r=><StatusPill status={r.status}/>},
      ]}/>
      <section className="mc-dense-panel mc-form-panel"><header className="mc-panel-title">Report physical waste</header>
        <label className="mc-field"><span>Outlet / Store</span><select value={store} onChange={e=>setStore(e.target.value)}>
          <option value="">Choose outlet</option>{(data.stores||[]).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
        <label className="mc-field"><span>Article</span><select value={article} onChange={e=>setArticle(e.target.value)}>
          <option value="">Choose Article</option>{(data.items||[]).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
        <div className="mc-field-pair"><FormField label="Waste quantity" type="number" value={quantity} onChange={setQuantity}/>
          <label className="mc-field"><span>Unit</span><select value={unit} onChange={e=>setUnit(e.target.value)}>
            <option value="">Base unit</option>{(data.units||[]).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.abbreviation||r.name)}</option>)}</select></label></div>
        <label className="mc-field"><span>Reason code (required)</span><select value={reason} onChange={e=>setReason(e.target.value)}>
          <option value="broken_service">Broken</option><option value="expired">Expired</option>
          <option value="prep_spoilage">Prep Spoilage</option><option value="vip_complimentary">VIP Comp</option>
          <option value="other">Other</option></select></label>
        <label className="mc-field"><span>Incident note</span><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)}/></label>
        <ConfirmTransaction title="Post waste to inventory?" description="The Django waste service deducts the recorded quantity from available stock and creates an immutable ledger posting."
          confirmLabel="Post waste" className={primary} disabled={busy||!store||!article||!(Number(quantity)>0)||(reason==='other'&&!note.trim())}
          busy={busy} onConfirm={submit}>Record & post waste</ConfirmTransaction>
      </section>
    </div>}
  </WorkspacePage>
}

export function EnterpriseStocktakeVariance() {
  const {data,loading,error,reload}=useBackendRows(['stock-counts','stock-count-items','items','stock-ledger'])
  const pathId=typeof window==='undefined'?'':window.location.pathname.split('/').filter(Boolean).at(-2)||''
  const [chosenId,setChosenId]=useState('')
  const id=chosenId||pathId
  const count=(data['stock-counts']||[]).find(r=>str(r.id)===id)
  const lines=(data['stock-count-items']||[]).filter(r=>str(r.stock_count)===id)
  const [selectedItem,setSelectedItem]=useState('')
  const ledger=(data['stock-ledger']||[]).filter(r=>str(r.item)===selectedItem)
  const cols:EnterpriseColumn<ApiRow>[]=[
    {id:'item',label:'Article',value:r=>str(r.item_name||r.item)},
    {id:'system',label:'Theoretical SOH',value:r=>dec(r.system_quantity),numeric:true},
    {id:'physical',label:'Actual count',value:r=>dec(r.physical_quantity),numeric:true},
    {id:'variance',label:'Variance Qty',value:r=>dec(r.physical_quantity)-dec(r.system_quantity),numeric:true,
      render:r=><span className={dec(r.physical_quantity)-dec(r.system_quantity)<0?'mc-cost-over':'mc-cost-ok'}>{amount(dec(r.physical_quantity)-dec(r.system_quantity))}</span>},
    {id:'valued',label:'Variance Value',value:r=>dec(r.variance_value),numeric:true},
  ]
  const countLines=lines.length
  return <WorkspacePage section="F&B Cost Control / Stocktake" title={'Actual vs. theoretical · '+str(count?.count_no||'')}
    subtitle="Audit physical stock counts against the frozen theoretical snapshot and trace ledger movements."
    actions={<button className={btn} onClick={()=>void reload()}><Icon name="refresh" size={15}/> Refresh</button>}>
    <StateMessage loading={loading} error={error}/>
    {!loading&&!error&&<label className="mc-field mc-picker"><span>Stocktake session</span><select value={id} onChange={e=>setChosenId(e.target.value)}>
      <option value="">Choose count session</option>{(data['stock-counts']||[]).map(row=><option value={str(row.id)} key={str(row.id)}>{str(row.count_no)} · {str(row.store_name||row.store)}</option>)}
    </select></label>}
    {!loading&&!error&&<>
      <div className="mc-compact-metrics"><div><span>Counted Articles</span><strong>{countLines}</strong></div>
        <div><span>Negative variances</span><strong>{lines.filter(r=>dec(r.physical_quantity)<dec(r.system_quantity)).length}</strong></div>
        <div><span>Positive variances</span><strong>{lines.filter(r=>dec(r.physical_quantity)>dec(r.system_quantity)).length}</strong></div></div>
      <EnterpriseTable<ApiRow> label="Stocktake audit matrix" rows={lines} columns={cols}
        onOpen={row=>setSelectedItem(str(row.item))}/>
      {selectedItem&&<section className="mc-dense-panel mc-footer-panel">
        <header className="mc-panel-title">Related immutable stock movements <span>{ledger.length} entries</span></header>
        <div className="mc-detail-lines"><table><thead><tr><th>Movement date</th><th>Reference</th><th>Movement type</th><th className="mc-num">Quantity IN</th><th className="mc-num">Quantity OUT</th></tr></thead>
          <tbody>{ledger.map(row=><tr key={str(row.id)}><td>{dateStr(row.created_at)}</td>
            <td><DocumentReference reference={str(row.reference_id)} record={row}/></td><td>{str(row.reference_type)}</td>
            <td className="mc-num">{amount(row.quantity_in)}</td><td className="mc-num">{amount(row.quantity_out)}</td></tr>)}</tbody></table></div>
      </section>}
      <div className="mc-alert mc-muted">Variance values and audit trails are read from Django. The stock ledger remains the authoritative transaction source; this view does not apply adjustments without approval.</div>
    </>}
  </WorkspacePage>
}

type EngineGroup = 'Stars' | 'Plowhorses' | 'Puzzles' | 'Dogs'
const engineeringGroups: EngineGroup[] = ['Stars', 'Plowhorses', 'Puzzles', 'Dogs']
type MenuCategory = 'Star' | 'Plowhorse' | 'Puzzle' | 'Dog' | 'Unclassified'
type MenuSale = {
  sku: string
  article: string
  quantity: number
  sales: number
  margin: number | null
  profit: number | null
  contribution: number | null
  classification: MenuCategory
}
const categoryNames: Record<Exclude<MenuCategory, 'Unclassified'>, EngineGroup> = {
  Star: 'Stars', Plowhorse: 'Plowhorses', Puzzle: 'Puzzles', Dog: 'Dogs',
}

export function EnterpriseMenuEngineering() {
  const [report, setReport] = useState<ApiRow[]>([])
  const [subtitle, setSubtitle] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const reload = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await fetchOperationalReport('menuEngineering', {})
      setReport(Array.isArray(result.results) ? result.results as ApiRow[] : [])
      setSubtitle(str(result.subtitle || ''))
      setNotice(str(result.notice || ''))
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void reload() }, [])

  // The Django report classifies recipes once, using transaction-date COGS.
  // Never silently reclassify the same figures with browser-only median/margin
  // rules; that would contradict financial evidence and downloaded reports.
  const positions: MenuSale[] = report.map((row) => ({
    sku: str(row.sku),
    article: str(row.article),
    quantity: dec(row.quantity),
    sales: dec(row.sales),
    profit: row.profit == null ? null : dec(row.profit),
    margin: row.margin_percent == null ? null : dec(row.margin_percent),
    contribution: row.unit_contribution == null ? null : dec(row.unit_contribution),
    classification: (['Star', 'Plowhorse', 'Puzzle', 'Dog'].includes(str(row.classification))
      ? str(row.classification) : 'Unclassified') as MenuCategory,
  }))
  const valid = positions.filter((r) =>
    r.classification !== 'Unclassified' && r.contribution !== null
  )
  const popularityThreshold = valid.length
    ? valid.reduce((sum, row) => sum + row.quantity, 0) / valid.length : 0
  const contributionThreshold = valid.length
    ? valid.reduce((sum, row) => sum + (row.contribution ?? 0), 0) / valid.length : 0
  const maxQuantity = Math.max(1, popularityThreshold, ...valid.map((r) => r.quantity))
  const minContribution = Math.min(0, contributionThreshold, ...valid.map((r) => r.contribution ?? 0))
  const maxContribution = Math.max(1, contributionThreshold, ...valid.map((r) => r.contribution ?? 0))
  const position = (value: number, threshold: number, min: number, max: number, low: number, middle: number, high: number) => {
    if (value < threshold) return low + (value - min) / Math.max(0.0001, threshold - min) * (middle - low)
    return middle + (value - threshold) / Math.max(0.0001, max - threshold) * (high - middle)
  }
  const point = (row: MenuSale) => ({
    x: position(row.quantity, popularityThreshold, 0, maxQuantity, 8, 49, 91),
    y: 100 - position(row.contribution ?? 0, contributionThreshold, minContribution, maxContribution, 10, 50, 90),
  })
  const unclassified = positions.filter((row) => row.classification === 'Unclassified')

  return <WorkspacePage section="F&B / Management analysis" title="Menu engineering"
    subtitle="Posted POS sales, immutable recipe cost snapshots and authoritative four-quadrant classification."
    actions={<button className={btn} onClick={() => void reload()} disabled={busy}><Icon name="refresh" size={16}/> Refresh</button>}>
    <StateMessage loading={busy} error={error}/>
    {!busy && !error && <>
      <div className="mc-compact-metrics">
        {engineeringGroups.map((group) =>
          <div key={group}><span>{group}</span><strong>
            {valid.filter((row) => categoryNames[row.classification as Exclude<MenuCategory, 'Unclassified'>] === group).length}
          </strong></div>
        )}
      </div>
      <section className="mc-dense-panel mc-menu-engineering">
        <header className="mc-panel-title">
          Popularity × Contribution per portion
          <span>{valid.length} fully costed recipes · {unclassified.length} unclassified</span>
        </header>
        <div className="mc-menu-chart">
          <svg viewBox="0 0 100 100" role="img"
            aria-label="Menu engineering quadrants using Django classified sold quantities and contribution per portion">
            <rect x="8" y="10" width="41" height="40" fill="#e6f2ed"/>
            <rect x="49" y="10" width="42" height="40" fill="#e8f3f5"/>
            <rect x="8" y="50" width="41" height="40" fill="#f7eeeb"/>
            <rect x="49" y="50" width="42" height="40" fill="#fff0db"/>
            <line x1="49" x2="49" y1="10" y2="90" stroke="#99afb6" strokeWidth=".3" strokeDasharray="1.5,1.5"/>
            <line x1="8" x2="91" y1="50" y2="50" stroke="#99afb6" strokeWidth=".3" strokeDasharray="1.5,1.5"/>
            <text x="11" y="14" fontSize="3.5" fill="#466b59">Puzzles</text>
            <text x="70" y="14" fontSize="3.5" fill="#376779">Stars</text>
            <text x="11" y="87" fontSize="3.5" fill="#915f58">Dogs</text>
            <text x="64" y="87" fontSize="3.5" fill="#9b722e">Plowhorses</text>
            {valid.map((row) => {
              const dot = point(row)
              return <circle key={row.sku} cx={dot.x} cy={dot.y}
                r="1.7" fill="#125f71" stroke="#fff" strokeWidth=".4">
                <title>{row.article} · {row.classification} · {row.quantity} portions · {row.contribution?.toFixed(2)} contribution / portion</title>
              </circle>
            })}
            <text x="49" y="97" fontSize="3" textAnchor="middle" fill="#5b747e">Popularity · portions sold</text>
            <text transform="translate(3,50) rotate(-90)" fontSize="3" textAnchor="middle" fill="#5b747e">Historical unit contribution</text>
          </svg>
        </div>
        <div className="mc-alert mc-muted">
          {subtitle || 'Each quadrant is based on priced POS quantities and frozen historical recipe COGS.'}
          {' '}No estimates from current WAC are used for missing historic costs.
        </div>
        {notice && <div className="mc-alert" role="status">{notice}</div>}
      </section>
      <EnterpriseTable<ApiRow> label="Menu engineering classifications"
        rows={report.map((row) => ({ ...row, id: str(row.sku) }))}
        columns={[
          {id:'article',label:'Menu article',value:row=>str(row.article)},
          {id:'classification',label:'Classification',value:row=>str(row.classification),render:row=><StatusPill status={str(row.classification)}/>},
          {id:'quantity',label:'Sold quantity',value:row=>dec(row.quantity),numeric:true},
          {id:'unit_contribution',label:'Contribution / portion',value:row=>dec(row.unit_contribution),render:row=><span className="mc-num">{row.unit_contribution == null ? 'Unknown' : amount(row.unit_contribution)}</span>,numeric:true},
          {id:'sales',label:'Sales UGX',value:row=>dec(row.sales),render:row=><span className="mc-num">{amount(row.sales)}</span>,numeric:true},
          {id:'profit',label:'Historical gross profit',value:row=>dec(row.profit),render:row=><span className={row.profit != null && dec(row.profit)<0 ? 'mc-cost-over':'mc-cost-ok'}>{row.profit == null ? 'Unknown' : amount(row.profit)}</span>,numeric:true},
          {id:'margin_percent',label:'Historical margin %',value:row=>dec(row.margin_percent),render:row=><span className="mc-num">{row.margin_percent == null ? 'Unknown' : dec(row.margin_percent).toFixed(1) + '%'}</span>,numeric:true},
        ]}/>
      {valid.length === 0 && <div className="mc-alert">Menu classification requires priced POS sales and frozen recipe COGS. Missing values are not inferred.</div>}
    </>}
  </WorkspacePage>
}
