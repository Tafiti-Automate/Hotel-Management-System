import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import EnterpriseTable, { type EnterpriseColumn } from '../../components/EnterpriseTable'
import ConfirmTransaction from '../../components/ConfirmTransaction'
import {
  createBackendRecord, errorMessage, readBackendPayload, runBackendAction, updateBackendRecord,
  downloadControlledPurchaseOrder, downloadGLExport,
} from '../../lib/api'
import { useApp } from '../../state/AppContext'
import {
  amount, dateStr, dec, DocumentReference, FormField, StateMessage, StatusPill,
  str, useBackendRows, WorkspacePage, type ApiRow,
} from './workspaceKit'

const APPROVALS = ['approvals','requisitions','requisition-items','cost-center-budgets'] as const
const LPO_APPROVALS = ['purchase-orders/approval-inbox','purchase-order-items','cost-center-budgets','budget-overrides'] as const
const BUYER = ['requisitions','requisition-items','supplier-item-prices','suppliers','purchase-orders'] as const
const QUOTES = ['supplier-item-prices','supplier-price-quotes','suppliers','items','units'] as const
const FINANCE = ['supplier-invoices','supplier-invoice-items','supplier-credit-notes','supplier-payments','supplier-payment-reconciliations','purchase-orders','purchase-order-items','grns','grn-items','supplier-returns'] as const
const BUDGETS = ['cost-center-budgets','budget-overrides','branches','departments'] as const
const CLOSE = ['fiscal-periods','gl-exports'] as const
const btn = 'mc-action'
const affirmative = 'mc-action mc-action-primary'

function useOperation(reload: () => Promise<void>) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return false
    setBusy(true); setError('')
    try {
      await action()
      await reload()
      await app.refreshData()
      app.showToast(message)
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally { setBusy(false) }
  }
  return { run, busy, error, setError }
}

function InfoLine({ label, value }: { label: string; value: unknown }) {
  return <div className="mc-info-row"><span>{label}</span><strong>{str(value) || '—'}</strong></div>
}

function Impact({ current, newAmount, cap }: { current: number; newAmount: number; cap: number }) {
  if (cap <= 0) return <div className="mc-alert mc-muted">No active budget was returned for this cost center.</div>
  const before = Math.min(100, (current / cap) * 100)
  const after = Math.min(100, ((current + newAmount) / cap) * 100)
  return <div className="mc-impact">
    <div className="mc-impact-top"><span>Monthly budget impact</span><strong>UGX {amount(cap)}</strong></div>
    <div className="mc-impact-track" aria-label="Spend before and after approval">
      <span style={{ width: before + '%' }} />
      <em style={{ width: Math.max(0, after - before) + '%', left: before + '%' }} />
    </div>
    <div className="mc-impact-summary">
      <span>Before <b>{amount(current)}</b></span>
      <span>After <b>{amount(current + newAmount)}</b></span>
      <span className={current + newAmount > cap ? 'mc-cost-over' : ''}>Remaining <b>{amount(cap - current - newAmount)}</b></span>
    </div>
  </div>
}

export function EnterpriseApprovalInbox() {
  const app = useApp()
  const role = app.user.role.trim().toLowerCase()
  const head = role === 'department head'
  const { data, loading, error, reload } = useBackendRows(head ? APPROVALS : LPO_APPROVALS)
  const { busy, run, error: mutationError } = useOperation(reload)
  const [id, setId] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const raw = head ? data.approvals || [] : data['purchase-orders/approval-inbox'] || []
  const queue = raw.filter(row => head ? str(row.status) === 'pending' : true)
  const selected = queue.find(row => str(row.id) === id)
  const requisition = head ? (data.requisitions || []).find(row => str(row.id) === str(selected?.requisition)) : selected
  const impact = dec(requisition?.estimated_total || requisition?.total_amount)
  const deptId = str(requisition?.department)
  const branchId = str(requisition?.branch)
  const budget = (data['cost-center-budgets'] || []).find(row =>
    str(row.department) === deptId && (!branchId || str(row.branch) === branchId))
  const lines = head ? (data['requisition-items'] || []).filter(row => str(row.requisition) === str(requisition?.id))
    : (data['purchase-order-items'] || []).filter(row => str(row.purchase_order) === id)

  const decide = async (approved: boolean) => {
    if (!selected) return
    const message = approved ? note : reason
    if (!approved && !message.trim()) return
    const type = head ? 'approvals' : 'purchase-orders'
    const action = approved ? 'approve' : 'reject'
    const ok = await run(() => runBackendAction(type, id, action, { comments: message }), approved ? 'Approval recorded' : 'Rejection recorded')
    if (ok) { setNote(''); setReason(''); setId('') }
  }
  const expectedLevel = head ? 'Level 1 · Department Head'
    : role === 'financial manager' ? 'Level 2 · Financial Controller' : 'Level 3 · General Manager'

  return <WorkspacePage section="Approvals / Authorisation" title="Approval inbox" subtitle={expectedLevel + ' · Assigned pending documents, with independent budget context'}
    actions={<button className={btn} onClick={() => void reload()}><Icon name="refresh" size={15}/> Refresh</button>}>
    <StateMessage loading={loading} error={error || mutationError} />
    {!loading && !error && <div className="mc-split mc-approval-split">
      <div className="mc-dense-panel mc-master-list">
        <header className="mc-panel-title">Pending approval queue <span>{queue.length}</span></header>
        {queue.map(row => <button type="button" key={str(row.id)} className={'mc-master-row' + (str(row.id) === id ? ' is-active' : '')}
          onClick={() => { setId(str(row.id)); setNote(''); setReason('') }}>
          <span><strong>{str(row.requisition_number || row.lpo_number || row.id)}</strong><StatusPill status={row.status} /></span>
          <small>{str(row.stage_name || row.supplier_name || row.document_type || 'Authorisation')} · {dateStr(row.created_at)}</small>
          <strong className="mc-num">UGX {amount(row.total_amount || row.estimated_total || 0)}</strong>
        </button>)}
        {!queue.length && <div className="mc-empty-state">No documents currently assigned to this approval level.</div>}
      </div>
      <div className="mc-dense-panel mc-detail-panel">
        {!selected ? <div className="mc-empty-state">Select a document to examine its lines, authorisation level and budget impact.</div> : <>
          <div className="mc-panel-title"><span>Document review</span><StatusPill status={selected.status}/></div>
          <div className="mc-detail-meta">
            <InfoLine label="Reference" value={requisition?.requisition_number || selected.lpo_number || selected.id}/>
            <InfoLine label="Approval stage" value={selected.stage_name || expectedLevel}/>
            <InfoLine label="Cost center" value={requisition?.department_name || budget?.department_name || deptId}/>
            <InfoLine label="Document value" value={'UGX ' + amount(impact)}/>
          </div>
          <div className="mc-detail-lines"><table><thead><tr><th>Article / line</th><th className="mc-num">Quantity</th><th className="mc-num">Unit price</th></tr></thead>
            <tbody>{lines.map(row => <tr key={str(row.id)}><td>{str(row.item_name || row.description || row.item)}</td><td className="mc-num">{str(row.approved_quantity || row.quantity)}</td><td className="mc-num">{amount(row.unit_cost || row.estimated_unit_cost)}</td></tr>)}
              {!lines.length && <tr><td colSpan={3}>No line details returned for this document.</td></tr>}</tbody></table></div>
          <Impact current={dec(budget?.committed_spend)} newAmount={impact} cap={dec(budget?.spending_cap)}/>
          <FormField label="Approval remarks (optional)" value={note} onChange={setNote} placeholder="Supporting decision note"/>
          <FormField label="Rejection reason (required)" value={reason} onChange={setReason} placeholder="Explain what must be corrected"/>
          <div className="mc-decision-bar">
            <ConfirmTransaction title="Approve assigned document?" description={'Authorise this document at ' + expectedLevel + '. The backend validates your assigned stage.'}
              confirmLabel="Approve" className={affirmative} busy={busy} disabled={busy} onConfirm={() => decide(true)}>
              <Icon name="check" size={15}/> Approve ({head ? 'L1' : role === 'financial manager' ? 'L2' : 'L3'})
            </ConfirmTransaction>
            <ConfirmTransaction title="Reject assigned document?" description="A rejection decision is recorded with your reason in the approval trail."
              confirmLabel="Reject" className={btn + ' mc-danger-action'} busy={busy}
              disabled={busy || !reason.trim()} onConfirm={() => decide(false)}>
              <Icon name="close" size={15}/> Reject
            </ConfirmTransaction>
          </div>
        </>}
      </div>
    </div>}
  </WorkspacePage>
}

export function EnterpriseQuoteMatrix() {
  const app=useApp()
  const role=app.user.role.trim().toLowerCase()
  const buyer=role==='procurement officer'||role==='procurement manager'||role==='purchasing officer'
  const controller=role==='cost controller'
  const {data,loading,error,reload}=useBackendRows(QUOTES)
  const {busy,error:mutationError,run}=useOperation(reload)
  const [selection,setSelection]=useState('')
  const [proposalId,setProposalId]=useState('')
  const [creating,setCreating]=useState(false)
  const [draft,setDraft]=useState<Record<string,string>>({})
  const [reviewNote,setReviewNote]=useState('')
  const prices=data['supplier-item-prices']||[]
  const proposals=data['supplier-price-quotes']||[]
  const price=prices.find(row=>str(row.id)===selection)
  const proposal=proposals.find(row=>str(row.id)===proposalId)
  const source=proposal||price
  const get=(key:string,fallback='')=>{
    const row=source as ApiRow|undefined
    const mapped=key==='fixed_order_quantity'?'minimum_order_quantity':key==='valid_from'?'effective_from':key==='valid_to'?'quotation_valid_until':key
    return (draft[key]??(creating?'':str(row?.[key]??row?.[mapped])))||fallback
  }
  const set=(key:string,value:string)=>setDraft(old=>({...old,[key]:value}))
  const reset=()=>{setSelection('');setProposalId('');setCreating(false);setDraft({});setReviewNote('')}
  const save=async()=>{
    const fields={
      supplier:get('supplier'),item:get('item'),unit:get('unit')||null,
      unit_price:get('unit_price'),discount_percent:get('discount_percent','0'),
      currency:get('currency','UGX'),quotation_reference:get('quotation_reference'),
      is_preferred:get('is_preferred')==='true',
    }
    if(!fields.supplier||!fields.item||!(Number(fields.unit_price)>0)||Number(fields.discount_percent)>=100)return
    const ok=await run(async()=>{
      if(buyer){
        const payload={...fields,fixed_order_quantity:get('fixed_order_quantity','1.00'),
          valid_from:get('valid_from',new Date().toISOString().slice(0,10)),
          valid_to:get('valid_to')||null}
        if(proposal && ['draft','rejected'].includes(str(proposal.status)))
          await updateBackendRecord('supplier-price-quotes',proposalId,payload)
        else
          await createBackendRecord('supplier-price-quotes',payload)
      }else if(controller){
        const payload={...fields,minimum_order_quantity:get('fixed_order_quantity','1.00'),
          effective_from:get('valid_from',new Date().toISOString().slice(0,10)),
          quotation_valid_until:get('valid_to')||null,is_active:true}
        if(price) await updateBackendRecord('supplier-item-prices',selection,payload)
        else await createBackendRecord('supplier-item-prices',payload)
      }
    },buyer?'Draft quotation saved for Cost Control':'Approved supplier price updated')
    if(ok)reset()
  }
  const action=async(id:string,verb:'submit'|'approve'|'reject')=>{
    const ok=await run(()=>runBackendAction('supplier-price-quotes',id,verb,{note:reviewNote}),
      verb==='submit'?'Quote submitted for Cost Control':verb==='approve'?'Quote published to approved price catalogue':'Quote rejected with note')
    if(ok)reset()
  }
  const priceColumns:EnterpriseColumn<ApiRow>[]=[
    {id:'item',label:'Article / SKU',value:r=>str(r.item_name||r.item_sku),render:r=><strong>{str(r.item_name||r.item)}</strong>},
    {id:'supplier',label:'Supplier',value:r=>str(r.supplier_name||r.supplier)},
    {id:'base',label:'Price / BU',value:r=>dec(r.base_unit_price),render:r=><span className="mc-num">{amount(r.base_unit_price)}</span>,numeric:true},
    {id:'qty',label:'Fixed QTY',value:r=>dec(r.minimum_order_quantity),numeric:true},
    {id:'discount',label:'Discount %',value:r=>dec(r.discount_percent),numeric:true},
    {id:'currency',label:'Currency',value:r=>str(r.currency)},
    {id:'from',label:'Valid from',value:r=>dateStr(r.effective_from)},
    {id:'to',label:'Valid to',value:r=>dateStr(r.quotation_valid_until)},
    {id:'preferred',label:'Preferred',value:r=>r.is_preferred?'Yes':'No',render:r=><StatusPill status={r.is_preferred?'preferred':'alternative'}/>},
  ]
  const proposalColumns:EnterpriseColumn<ApiRow>[]=[
    {id:'article',label:'Article',value:r=>str(r.item_name||r.item)},
    {id:'supplier',label:'Supplier',value:r=>str(r.supplier_name||r.supplier)},
    {id:'ref',label:'Vendor quote',value:r=>str(r.quotation_reference)},
    {id:'price',label:'Quoted unit price',value:r=>dec(r.unit_price),numeric:true},
    {id:'discount',label:'Discount %',value:r=>dec(r.discount_percent),numeric:true},
    {id:'currency',label:'Currency',value:r=>str(r.currency)},
    {id:'expiry',label:'Valid to',value:r=>dateStr(r.valid_to)},
    {id:'status',label:'Review',value:r=>str(r.status),render:r=><StatusPill status={r.status}/>},
  ]
  const editing=creating||Boolean(price)||Boolean(proposal)
  const editable=creating||(buyer&&Boolean(proposal)&&['draft','rejected'].includes(str(proposal?.status)))||(controller&&Boolean(price))
  return <WorkspacePage section="Purchasing / Vendor contracts" title="Supplier price quote matrix"
    subtitle="Purchasing proposes vendor quotes; Cost Control controls publication of contracted rates and discount history."
    actions={<button className={affirmative} disabled={!buyer&&!controller} onClick={()=>{reset();setCreating(true)}}><Icon name="add" size={15}/> New quotation</button>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<>
      <EnterpriseTable<ApiRow> label="Approved supplier price catalogue" rows={prices} columns={priceColumns}
        onOpen={r=>{reset();setSelection(str(r.id))}}/>
      <div className="mc-split mc-quote-split mc-footer-panel">
        <section>
          <EnterpriseTable<ApiRow> label="Vendor quotes awaiting approval" rows={proposals} columns={proposalColumns}
            onOpen={r=>{reset();setProposalId(str(r.id))}}/>
        </section>
        {editing&&<aside className="mc-dense-panel mc-form-panel">
          <header className="mc-panel-title">{creating?'New vendor quote':proposal?'Quote for review':'Published contract rate'}</header>
          <label className="mc-field"><span>Supplier</span><select value={get('supplier')} disabled={!editable} onChange={e=>set('supplier',e.target.value)}>
            <option value="">Choose supplier</option>{(data.suppliers||[]).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
          <label className="mc-field"><span>Article</span><select value={get('item')} disabled={!editable} onChange={e=>set('item',e.target.value)}>
            <option value="">Choose Article</option>{(data.items||[]).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.name)}</option>)}</select></label>
          <label className="mc-field"><span>Unit</span><select value={get('unit')} disabled={!editable} onChange={e=>set('unit',e.target.value)}>
            <option value="">Base unit</option>{(data.units||[]).map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.abbreviation||r.name)}</option>)}</select></label>
          <div className="mc-field-pair">
            <FormField label="Quoted unit price" type="number" value={get('unit_price')} disabled={!editable} onChange={v=>set('unit_price',v)}/>
            <FormField label="Fixed order QTY" type="number" value={get('fixed_order_quantity','1.00')} disabled={!editable} onChange={v=>set('fixed_order_quantity',v)}/>
          </div>
          <div className="mc-field-pair">
            <FormField label="Discount %" type="number" value={get('discount_percent','0')} disabled={!editable} onChange={v=>set('discount_percent',v)}/>
            <FormField label="Currency" value={get('currency','UGX')} disabled={!editable} onChange={v=>set('currency',v)}/>
          </div>
          <div className="mc-field-pair"><FormField label="Quote reference" value={get('quotation_reference')} disabled={!editable} onChange={v=>set('quotation_reference',v)}/>
            <FormField label="Valid from" type="date" value={get('valid_from',new Date().toISOString().slice(0,10))} disabled={!editable} onChange={v=>set('valid_from',v)}/></div>
          <FormField label="Valid to" type="date" value={get('valid_to')} disabled={!editable} onChange={v=>set('valid_to',v)}/>
          <label className="mc-check"><input type="checkbox" disabled={!editable} checked={get('is_preferred')==='true'}
            onChange={e=>set('is_preferred',String(e.target.checked))}/> Preferred supplier</label>
          {proposal&&<div className="mc-alert mc-muted">Status: {str(proposal.status)} · Submitted quotations cannot be modified until Cost Control decides.</div>}
          {proposal&&controller&&str(proposal.status)==='submitted'&&<FormField label="Approval / rejection note" value={reviewNote} onChange={setReviewNote}/>}
          <div className="mc-decision-bar">
            <button className={btn} onClick={reset}>Close</button>
            {editable&&<button className={affirmative} disabled={busy||!get('supplier')||!get('item')||!(Number(get('unit_price'))>0)}
              onClick={()=>void save()}>Save quotation</button>}
            {buyer&&proposal&&['draft','rejected'].includes(str(proposal.status))&&<button className={affirmative} disabled={busy}
              onClick={()=>void action(proposalId,'submit')}>Submit for Cost Control</button>}
            {controller&&proposal&&str(proposal.status)==='submitted'&&<>
              <button className={affirmative} disabled={busy} onClick={()=>void action(proposalId,'approve')}>Approve & publish</button>
              <button className={btn+' mc-danger-action'} disabled={busy||!reviewNote.trim()} onClick={()=>void action(proposalId,'reject')}>Reject with reason</button>
            </>}
          </div>
        </aside>}
      </div>
    </>}
  </WorkspacePage>
}

export function EnterprisePurchasingWorkbench() {
  const {data,loading,error,reload}=useBackendRows(BUYER)
  const {busy,error:mutationError,run}=useOperation(reload)
  const [selected,setSelected]=useState<ApiRow[]>([])
  const requisitions=data.requisitions||[]
  const lines=(data['requisition-items']||[]).filter(line=>{
    const parent=requisitions.find(req=>str(req.id)===str(line.requisition))
    return parent && ['approved','partially_ordered'].includes(str(parent.status))
  })
  const groups=useMemo(()=>{
    const grouped=new Map<string,{name:string;lines:ApiRow[];total:number}>()
    for(const line of selected){
      const supplier=str(line.procurement_supplier||'unallocated')
      const requisition=requisitions.find(r=>str(r.id)===str(line.requisition))
      const curr=str(requisition?.currency||'UGX')
      const key=supplier+'|'+curr
      const current=grouped.get(key)||{name:supplier==='unallocated'?'Supplier not allocated':str(line.procurement_supplier_name||supplier)+' · '+curr,lines:[],total:0}
      current.lines.push(line)
      current.total+=dec(line.procurement_quantity)*dec(line.procurement_unit_cost)
      grouped.set(key,current)
    }
    return Array.from(grouped.values())
  },[selected,requisitions])
  const canGenerate=selected.length>0&&selected.every(line=>Boolean(
    line.procurement_supplier&&line.procurement_supplier_price&&line.procurement_unit
    &&dec(line.procurement_quantity)>0&&dec(line.procurement_unit_cost)>0
  ))
  const generate=async()=>{
    if(!canGenerate)return
    const ok=await run(
      ()=>createBackendRecord('purchase-orders/consolidate-approved',{
        requisition_item_ids:selected.map(line=>str(line.id)),
      }),
      'Supplier purchase orders created from selected PR lines',
    )
    if(ok)setSelected([])
  }
  const cols:EnterpriseColumn<ApiRow>[]=[
    {id:'request',label:'Approved PR',value:r=>str(requisitions.find(p=>str(p.id)===str(r.requisition))?.requisition_number||r.requisition)},
    {id:'article',label:'Article',value:r=>str(r.item_name||r.item)},
    {id:'department',label:'Cost center',value:r=>str(requisitions.find(p=>str(p.id)===str(r.requisition))?.department_name||'')},
    {id:'qty',label:'Qty approved',value:r=>dec(r.approved_quantity||r.quantity),numeric:true},
    {id:'supplier',label:'Allocated supplier',value:r=>str(r.procurement_supplier_name||r.procurement_supplier||'Not allocated')},
    {id:'contract',label:'Quote locked',value:r=>r.procurement_supplier_price?'Yes':'No',render:r=><StatusPill status={r.procurement_supplier_price?'allocated':'unallocated'}/>},
    {id:'destination',label:'Destination store',value:r=>str(r.destination_store||r.destination_type)},
  ]
  return <WorkspacePage section="Purchase / Order proposal" title="PR-to-PO workbench"
    subtitle="Consolidate approved PR lines from several departments into one draft LPO per supplier and currency."
    actions={<button className={btn} onClick={()=>void reload()}><Icon name="refresh" size={16}/> Refresh</button>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<>
      <div className="mc-compact-metrics"><div><span>Approved PR lines</span><strong>{lines.length}</strong></div>
        <div><span>Selected lines</span><strong>{selected.length}</strong></div><div><span>Supplier groups</span><strong>{groups.length}</strong></div></div>
      <EnterpriseTable<ApiRow> label="Approved requisition lines" rows={lines} columns={cols} onSelectionChange={setSelected}/>
      <section className="mc-dense-panel mc-footer-panel"><header className="mc-panel-title">Proposed supplier batches</header>
        <div className="mc-batch-groups">{groups.map(group=><div key={group.name}><strong>{group.name}</strong><span>{group.lines.length} lines</span><b className="mc-num">UGX {amount(group.total)}</b></div>)}</div>
        <div className="mc-alert mc-muted">Each Article retains its originating PR, department, destination and approved quantity. The backend revalidates supplier quotes and rejects duplicated commitments inside a single transaction.</div>
        <div className="mc-decision-bar">
          <ConfirmTransaction title="Consolidate approved purchase requisitions?" description="One draft LPO will be created per supplier and currency, retaining every original requisition line for approval, receiving and audit."
            confirmLabel="Generate LPOs" className={affirmative} busy={busy} disabled={!canGenerate||busy} onConfirm={generate}>
            <Icon name="receipt_long" size={15}/> Consolidate PRs by supplier
          </ConfirmTransaction>
        </div>
      </section>
    </>}
  </WorkspacePage>
}

export function EnterpriseInvoiceMatching() {
  const {user}=useApp()
  const canProcessInvoice = user.role.trim().toLowerCase() === 'accounts payable clerk' && !user.isSuperuser
  const canApproveCredit = user.role.trim().toLowerCase() === 'financial manager' && !user.isSuperuser
  const [creditReturnId,setCreditReturnId]=useState('')
  const [creditSubtotal,setCreditSubtotal]=useState('')
  const [creditTax,setCreditTax]=useState('0')
  const [reconciliationPayment,setReconciliationPayment]=useState('')
  const [bankEntryId,setBankEntryId]=useState('')
  const [reconciliationNote,setReconciliationNote]=useState('')

  const {data,loading,error,reload}=useBackendRows(FINANCE)
  const {busy,error:mutationError,run}=useOperation(reload)
  const [id,setId]=useState('')
  const invoices=data['supplier-invoices']||[]
  const invoice=invoices.find(row=>str(row.id)===id)
  const po=(data['purchase-orders']||[]).find(row=>str(row.id)===str(invoice?.purchase_order))
  const poLines=(data['purchase-order-items']||[]).filter(row=>str(row.purchase_order)===str(po?.id))
  const invoicesLines=(data['supplier-invoice-items']||[]).filter(row=>str(row.invoice)===id)
  const grnIds=(data.grns||[]).filter(row=>str(row.purchase_order)===str(po?.id)&&str(row.status)==='posted').map(row=>str(row.id))
  const accepted=(data['grn-items']||[]).filter(row=>grnIds.includes(str(row.goods_receipt)))
  const returns=(data['supplier-returns']||[]).filter(row=>grnIds.includes(str(row.goods_receipt)))
  const credits=(data['supplier-credit-notes']||[]).filter(row=>str(row.invoice)===id)
  const postedPayments=(data['supplier-payments']||[]).filter(row=>str(row.invoice)===id&&str(row.status)==='posted')
  const invoicePaymentIds=new Set(postedPayments.map(row=>str(row.id)))
  const bankMatches=(data['supplier-payment-reconciliations']||[]).filter(row=>invoicePaymentIds.has(str(row.payment)))
  const availablePayments=postedPayments.filter(row=>!bankMatches.some(match=>str(match.payment)===str(row.id)))
  const prepareBankMatch=async()=>{
    if(!reconciliationPayment||!bankEntryId.trim())return
    const ok=await run(()=>createBackendRecord('supplier-payment-reconciliations',{
      payment:reconciliationPayment,bank_transaction:bankEntryId.trim()
    }),'Bank entry matched for Finance review')
    if(ok){setReconciliationPayment('');setBankEntryId('')}
  }
  const confirmBankMatch=async(matchId:string)=>{
    if(!reconciliationNote.trim())return
    const ok=await run(()=>runBackendAction('supplier-payment-reconciliations',matchId,'confirm',{
      note:reconciliationNote
    }),'Bank reconciliation confirmed')
    if(ok)setReconciliationNote('')
  }

  const eligibleReturns=returns.filter(row=>str(row.status)==='posted' && !!str(row.credit_note_number) &&
    !!str(row.supplier_acknowledged_at) && !(data['supplier-credit-notes']||[]).some(c=>str(c.supplier_return)===str(row.id)))
  const makeCredit=async()=>{
    if(!id||!creditReturnId||!(Number(creditSubtotal)>0)||Number(creditTax)<0)return
    const ok=await run(()=>createBackendRecord('supplier-credit-notes',{
      invoice:id,supplier_return:creditReturnId,subtotal:Number(creditSubtotal),tax_amount:Number(creditTax),
    }),'Supplier credit prepared for Finance review')
    if(ok){setCreditReturnId('');setCreditSubtotal('');setCreditTax('0')}
  }
  const creditAction=async(creditId:string,action:'approve'|'post')=>{
    await run(()=>runBackendAction('supplier-credit-notes',creditId,action),
      action==='approve'?'Supplier credit approved':'Supplier credit posted to AP')
  }
  const invoiceQty=invoiceLineQty(invoicesLines)
  const receiptQty=accepted.reduce((sum,row)=>sum+dec(row.base_quantity),0)
  const match=async()=>{if(!id)return;await run(()=>runBackendAction('supplier-invoices',id,'match'),'3-way matching completed')}
  const approve=async()=>{if(!id)return;await run(()=>runBackendAction('supplier-invoices',id,'approve-for-payment'),'Invoice approved for payment')}
  const cols:EnterpriseColumn<ApiRow>[]=[
    {id:'number',label:'Supplier invoice',value:r=>str(r.invoice_number||r.id)},
    {id:'po',label:'Purchase order',value:r=>str(r.purchase_order)},
    {id:'date',label:'Invoice date',value:r=>dateStr(r.invoice_date)},
    {id:'amount',label:'Invoice value',value:r=>dec(r.total_amount),render:r=><span className="mc-num">{amount(r.total_amount)}</span>,numeric:true},
    {id:'variance',label:'Match variance',value:r=>dec(r.amount_variance),render:r=><span className={'mc-num '+(dec(r.amount_variance)===0?'mc-cost-ok':'mc-cost-over')}>{amount(r.amount_variance)}</span>,numeric:true},
    {id:'status',label:'Status',value:r=>str(r.status),render:r=><StatusPill status={r.status}/>},
  ]
  return <WorkspacePage section="Finance / Invoice control" title="3-way invoice matching"
    subtitle="Compare the commercial purchase order, posted GRN receipts and supplier invoice before releasing payment."
    actions={<button className={btn} onClick={()=>void reload()}><Icon name="refresh" size={16}/> Refresh</button>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<div className="mc-split mc-invoice-layout">
      <EnterpriseTable<ApiRow> label="Supplier invoice register" rows={invoices} columns={cols}
        onOpen={row=>setId(str(row.id))}/>
      <section className="mc-dense-panel mc-invoice-detail">
        {!invoice?<div className="mc-empty-state">Select an invoice to open its 3-way control matrix.</div>:<>
          <header className="mc-panel-title"><span>Invoice {str(invoice.invoice_number)}</span><StatusPill status={invoice.status}/></header>
          <div className="mc-detail-meta">
            <InfoLine label="Supplier" value={invoice.supplier_name||invoice.supplier}/>
            <InfoLine label="PO" value={po?.lpo_number||po?.po_number}/>
            <InfoLine label="Invoice total" value={'UGX '+amount(invoice.total_amount)}/>
            <InfoLine label="Unresolved amount" value={'UGX '+amount(invoice.amount_variance)}/>
          </div>
          <div className="mc-three-way">
            <div><header><strong>01 / Purchase Order</strong><small>Contracted</small></header>
              {poLines.map(line=><div className="mc-match-row" key={str(line.id)}>
                <b>{str(line.item_name||line.item)}</b><span>{amount(line.approved_quantity||line.quantity)} @ {amount(line.unit_cost)}</span>
              </div>)}{!poLines.length&&<p>No PO lines returned.</p>}
              <footer>PO total <strong>{amount(po?.total_amount)}</strong></footer></div>
            <div><header><strong>02 / Posted GRN + Debit notes</strong><small>Accepted</small></header>
              {accepted.map(line=><div className="mc-match-row" key={str(line.id)}><b>{str(line.item_name||line.item)}</b><span>Received {amount(line.base_quantity)}</span></div>)}
              {!accepted.length&&<p>No posted GRN lines.</p>}
              {returns.map(line=><div className="mc-match-row" key={str(line.id)}><b>Return {str(line.return_number||line.id)}</b><span>Debit note</span></div>)}
              <footer>Posted base units <strong>{amount(receiptQty)}</strong></footer></div>
            <div><header><strong>03 / Supplier invoice</strong><small>Claimed</small></header>
              {invoicesLines.map(line=><div className="mc-match-row" key={str(line.id)}>
                <b>{str(line.item_name||line.item)}</b><span>{amount(line.base_quantity||line.quantity)} @ {amount(line.unit_price)}</span>
              </div>)}{!invoicesLines.length&&<p>No invoice lines.</p>}
              <footer>Invoiced base units <strong>{amount(invoiceQty)}</strong></footer></div>
          </div>
          {str(invoice.match_notes)&&<div className="mc-alert">{str(invoice.match_notes)}</div>}
          <div className="mc-dense-panel">
            <header className="mc-panel-title">Supplier credit notes <span>{credits.length}</span></header>
            <div className="mc-detail-meta">
              <InfoLine label="Posted credits" value={'UGX '+amount(invoice.credited_amount)}/>
              <InfoLine label="Open payable" value={'UGX '+amount(invoice.balance_due)}/>
            </div>
            {credits.map(credit=><div className="mc-match-row" key={str(credit.id)}>
              <b>{str(credit.credit_reference||credit.id)} · UGX {amount(credit.total_amount)}</b>
              <StatusPill status={credit.status}/>
              {canApproveCredit && str(credit.status)==='draft' &&
                <button type="button" className={affirmative} disabled={busy}
                  onClick={()=>void creditAction(str(credit.id),'approve')}>Approve credit</button>}
              {canProcessInvoice && str(credit.status)==='approved' &&
                <button type="button" className={affirmative} disabled={busy}
                  onClick={()=>void creditAction(str(credit.id),'post')}>Post approved credit</button>}
            </div>)}
            {!credits.length&&<p className="mc-muted">No financial supplier credits allocated to this invoice.</p>}
            {canProcessInvoice && eligibleReturns.length>0 && <div className="mc-form-panel">
              <label className="mc-field"><span>Acknowledged supplier return</span>
                <select value={creditReturnId} onChange={e=>setCreditReturnId(e.target.value)}>
                  <option value="">Select acknowledged return</option>
                  {eligibleReturns.map(row=><option key={str(row.id)} value={str(row.id)}>
                    {str(row.return_no||row.id)} · {str(row.credit_note_number)}
                  </option>)}
                </select>
              </label>
              <FormField label="Credit subtotal (UGX)" value={creditSubtotal} onChange={setCreditSubtotal} type="number" placeholder="Valued at returned LPO cost"/>
              <FormField label="Credit VAT (UGX)" value={creditTax} onChange={setCreditTax} type="number"/>
              <button type="button" className={affirmative}
                disabled={busy||!creditReturnId||!(Number(creditSubtotal)>0)||Number(creditTax)<0}
                onClick={()=>void makeCredit()}>Prepare supplier credit</button>
            </div>}
          </div>
          <div className="mc-dense-panel">
            <header className="mc-panel-title">Bank reconciliation <span>{bankMatches.length}/{postedPayments.length}</span></header>
            {postedPayments.map(payment=>{
              const match=bankMatches.find(row=>str(row.payment)===str(payment.id))
              return <div className="mc-match-row" key={str(payment.id)}>
                <b>{str(payment.reference)} · UGX {amount(payment.amount)}</b>
                <StatusPill status={match?.status||'unmatched'}/>
                {match&&<small>Bank ref: {str(match.bank_reference||match.bank_transaction)}</small>}
                {match&&str(match.status)==='pending'&&canApproveCredit&&
                  <button className={affirmative} type="button" disabled={busy||!reconciliationNote.trim()}
                    onClick={()=>void confirmBankMatch(str(match.id))}>Confirm bank match</button>}
              </div>
            })}
            {canApproveCredit&&bankMatches.some(row=>str(row.status)==='pending')&&
              <FormField label="Bank evidence review note" value={reconciliationNote}
                onChange={setReconciliationNote} placeholder="Document how statement evidence was checked"/>}
            {canProcessInvoice&&availablePayments.length>0&&<div className="mc-form-panel">
              <label className="mc-field"><span>Posted payment</span>
                <select value={reconciliationPayment} onChange={e=>setReconciliationPayment(e.target.value)}>
                  <option value="">Choose payment for matching</option>
                  {availablePayments.map(row=><option key={str(row.id)} value={str(row.id)}>
                    {str(row.reference)} · UGX {amount(row.amount)}
                  </option>)}
                </select>
              </label>
              <FormField label="Recorded bank transaction ID" value={bankEntryId}
                onChange={setBankEntryId} placeholder="Copy the transaction UUID from the bank register"/>
              <button className={affirmative} type="button" disabled={busy||!reconciliationPayment||!bankEntryId.trim()}
                onClick={()=>void prepareBankMatch()}>Prepare reconciliation</button>
            </div>}
            {!postedPayments.length&&<p className="mc-muted">No posted supplier payments for this invoice.</p>}
            <p className="mc-muted">Matching a recorded bank entry does not independently verify external bank settlement.</p>
          </div>
          {canProcessInvoice ? <div className="mc-decision-bar">
            <ConfirmTransaction title="Run 3-way match?" description="Django compares invoice quantities, GRN receipts, pricing and supplier credits before recording a match decision."
              confirmLabel="Run matching" className={btn} disabled={busy||!['draft','exception'].includes(str(invoice.status))} busy={busy} onConfirm={match}>
              <Icon name="fact_check" size={16}/> Validate match
            </ConfirmTransaction>
            <ConfirmTransaction title="Approve matched invoice?" description="Only a successfully matched invoice can proceed to payment approval. The Django backend verifies authorization."
              confirmLabel="Approve for payment" className={affirmative} disabled={busy||str(invoice.status)!=='matched'} busy={busy} onConfirm={approve}>
              <Icon name="verified" size={16}/> Approve for payment
            </ConfirmTransaction>
          </div> : <div className="mc-alert mc-muted">Read-only financial review. Accounts Payable handles matching and payment approval under its assigned permissions.</div>}
        </>}
      </section>
    </div>}
  </WorkspacePage>
}
function invoiceLineQty(lines:ApiRow[]):number {
  return lines.reduce((sum,line)=>sum+dec(line.base_quantity||line.quantity),0)
}

export function EnterpriseBudgetMatrix() {
  const {data,loading,error,reload}=useBackendRows(BUDGETS)
  const {busy,error:mutationError,run}=useOperation(reload)
  const [month,setMonth]=useState(new Date().toISOString().slice(0,7))
  const budgets=(data['cost-center-budgets']||[]).filter(row=>!month||str(row.period_month).startsWith(month))
  const overrides=data['budget-overrides']||[]
  const [note,setNote]=useState('')
  const [decision,setDecision]=useState('')
  const [selected,setSelected]=useState('')
  const toggle=async(row:ApiRow)=>run(()=>updateBackendRecord('cost-center-budgets',str(row.id),{
    enforce_hard_block:!row.enforce_hard_block,
  }), 'Budget enforcement updated')
  const cols:EnterpriseColumn<ApiRow>[]=[
    {id:'cost',label:'Cost center / department',value:r=>str(r.department_name||r.department)},
    {id:'property',label:'Property',value:r=>str(r.branch_name||r.branch)},
    {id:'cap',label:'Monthly budget UGX',value:r=>dec(r.spending_cap),render:r=><span className="mc-num">{amount(r.spending_cap)}</span>,numeric:true},
    {id:'committed',label:'PO commitments',value:r=>dec(r.committed_spend),render:r=><span className="mc-num">{amount(r.committed_spend)}</span>,numeric:true},
    {id:'remaining',label:'Remaining',value:r=>dec(r.remaining_amount),render:r=><span className={dec(r.remaining_amount)<0?'mc-num mc-cost-over':'mc-num mc-cost-ok'}>{amount(r.remaining_amount)}</span>,numeric:true},
    {id:'util',label:'Utilisation',value:r=>dec(r.spending_cap)>0?dec(r.committed_spend)/dec(r.spending_cap):0,render:r=><div className="mc-mini-meter"><span style={{width:Math.min(100,dec(r.spending_cap)>0?dec(r.committed_spend)/dec(r.spending_cap)*100:0)+'%'}}/></div>},
    {id:'hard',label:'Hard budget block',value:r=>r.enforce_hard_block?'On':'Off',render:r=><label className="mc-toggle"><input aria-label={'Hard budget block for '+str(r.department_name)} type="checkbox" disabled={busy} checked={Boolean(r.enforce_hard_block)} onChange={()=>void toggle(r)}/><span>{r.enforce_hard_block?'Enforced':'Advisory'}</span></label>},
  ]
  const decide=async(approve:boolean)=>{
    if(!selected||!note.trim())return
    const ok=await run(()=>runBackendAction('budget-overrides',selected,'decide',{
      decision:approve?'approve':'reject',note,
    }), 'Budget override decision recorded')
    if(ok){setSelected('');setNote('');setDecision('')}
  }
  return <WorkspacePage section="Finance / Budget control" title="Monthly cost center budgets"
    subtitle="Control monthly spending caps, committed PO amounts, overrides and hard-budget blocking."
    actions={<label className="mc-field mc-month-filter"><span>Month</span><input type="month" value={month} onChange={event=>setMonth(event.target.value)}/></label>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<>
      <EnterpriseTable<ApiRow> label="Cost center budget matrix" rows={budgets} columns={cols}/>
      <section className="mc-dense-panel mc-footer-panel">
        <header className="mc-panel-title">Pending exceptional budget requests <span>{overrides.filter(row=>str(row.status)==='pending').length}</span></header>
        <div className="mc-override-grid">
          <div>{overrides.filter(row=>str(row.status)==='pending').map(row=><button type="button" key={str(row.id)}
            className={'mc-master-row'+(selected===str(row.id)?' is-active':'')} onClick={()=>{setSelected(str(row.id));setNote('')}}>
            <strong>{str(row.requisition_number)}</strong><small>{str(row.department_name)} · Over UGX {amount(row.overage_amount)}</small></button>)}</div>
          <div>{selected&&<><InfoLine label="Decision" value="Financial Controller · exceptional budget"/>
            <FormField label="Mandatory decision note" value={note} onChange={setNote}/>
            <div className="mc-decision-bar">
              <button className={affirmative} disabled={busy||!note.trim()} onClick={()=>{setDecision('approve');void decide(true)}}>Approve override</button>
              <button className={btn+' mc-danger-action'} disabled={busy||!note.trim()} onClick={()=>{setDecision('reject');void decide(false)}}>Reject override</button>
            </div><span className="mc-muted">{decision&&'Processing '+decision}</span></>}</div>
        </div>
      </section>
    </>}
  </WorkspacePage>
}

type GrniReview = {
  as_of_date: string
  order_count: number
  received_value: string
  matched_invoice_value: string
  unmatched_receipt_value: string
  requires_manual_review: boolean
  posted: boolean
  note: string
  orders: Array<{
    purchase_order_id: string
    lpo_number: string
    supplier: string
    department: string
    posted_receipt_value: string
    matched_invoice_value: string
    unmatched_receipt_value: string
    requires_review: boolean
    warnings: string[]
  }>
}

export function EnterprisePeriodClose() {
  const {data,loading,error,reload}=useBackendRows(CLOSE)
  const {busy,error:mutationError,run}=useOperation(reload)
  const [selected,setSelected]=useState('')
  const [note,setNote]=useState('')
  const [grniRevision, setGrniRevision] = useState(0)
  const [grni, setGrni] = useState<GrniReview | null>(null)
  const [grniLoading, setGrniLoading] = useState(false)
  const [grniError, setGrniError] = useState('')
  useEffect(() => {
    if (!selected) { setGrni(null); return }
    let active = true
    setGrni(null)
    setGrniLoading(true)
    setGrniError('')
    void readBackendPayload('fiscal-periods/' + encodeURIComponent(selected) + '/grni-reconciliation/')
      .then((payload) => { if (active) setGrni(payload as unknown as GrniReview) })
      .catch((cause) => { if (active) setGrniError(errorMessage(cause)) })
      .finally(() => { if (active) setGrniLoading(false) })
    return () => { active = false }
  }, [selected, grniRevision])
  const periods=data['fiscal-periods']||[]
  const period=periods.find(row=>str(row.id)===selected)
  const checklist=(period?.checklist||{}) as Record<string,unknown>
  const checks=[
    ['Unposted GRNs', 'open_grns'],['In-transit transfers','open_transfers'],
    ['Internal issue transit','open_issue_transits'],['Open stocktakes','open_stock_counts'],
    ['Unmatched invoices','unresolved_invoices'],['Unprocessed POS imports','unresolved_pos_imports'],
  ] as const
  const canClose=Boolean(checklist.can_close)&&str(period?.status)==='open'&&note.trim().length>0
  const close=async()=>{ const ok=await run(()=>runBackendAction('fiscal-periods',selected,'close',{note}),'Fiscal period closed and locked'); if(ok) setGrniRevision(x=>x+1) }
  const generate=async()=>run(()=>runBackendAction('fiscal-periods',selected,'generate-gl-export'),'GL journal exported')
  const exports=(data['gl-exports']||[]).filter(row=>str(row.period)===selected)
  return <WorkspacePage section="Finance / Fiscal control" title="Month-end closing wizard"
    subtitle="Validate outstanding operational documents before locking the accounting period and generating GL journals."
    actions={<button className={btn} onClick={()=>void reload()}><Icon name="refresh" size={16}/> Refresh</button>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<div className="mc-split mc-period-split">
      <aside className="mc-dense-panel mc-master-list"><header className="mc-panel-title">Accounting periods</header>
        {periods.map(row=><button type="button" key={str(row.id)} className={'mc-master-row'+(str(row.id)===selected?' is-active':'')} onClick={()=>{setSelected(str(row.id));setNote('')}}>
          <span><strong>{str(row.name)}</strong><StatusPill status={row.status}/></span><small>{dateStr(row.start_date)} — {dateStr(row.end_date)}</small></button>)}
      </aside>
      <section className="mc-dense-panel mc-detail-panel">{!period?<div className="mc-empty-state">Choose an accounting period to begin pre-close checks.</div>:<>
        <header className="mc-panel-title">Step 1 · Operational readiness <StatusPill status={period.status}/></header>
        <div className="mc-checklist">{checks.map(([label,key])=><div key={key} className={dec(checklist[key])>0?'mc-check-bad':'mc-check-ok'}>
          <Icon name={dec(checklist[key])>0?'warning':'check_circle'} size={18}/>
          <span>{label}</span><strong>{str(checklist[key]??'—')}</strong></div>)}</div>
        <div className="mc-alert mc-muted">{str(checklist.blockers)|| (Array.isArray(checklist.blockers)?checklist.blockers.join(' · '):'') || 'Checklist is read directly from Django fiscal-period controls.'}</div>
        <header className="mc-panel-title">Step 2 · Goods Received Not Invoiced reconciliation</header>
        <div className="mc-alert mc-muted">
          Finance-only documentary comparison against posted GRNs and matched supplier invoices.
          This is not an accounting journal or confirmation of an external GL posting.
        </div>
        {grniLoading && <div className="mc-alert mc-muted" role="status">Retrieving GRNI reconciliation…</div>}
        {grniError && <div className="mc-alert" role="alert">{grniError}</div>}
        {grni && <>
          <div className="mc-compact-metrics">
            <div><span>GRNs valued</span><strong>{amount(grni.received_value)}</strong></div>
            <div><span>Matched invoices</span><strong>{amount(grni.matched_invoice_value)}</strong></div>
            <div><span>Unmatched GRNI exposure</span><strong>{amount(grni.unmatched_receipt_value)}</strong></div>
          </div>
          {grni.requires_manual_review && <div className="mc-alert" role="alert">
            Finance must resolve supplier return, invoice allocation or historical posting exceptions before treating these values as complete.
          </div>}
          <div className="mc-detail-lines"><table>
            <thead><tr><th>LPO</th><th>Supplier / Cost Center</th><th className="mc-num">Received</th><th className="mc-num">Matched</th><th className="mc-num">Unmatched</th></tr></thead>
            <tbody>{grni.orders.map(row=><tr key={row.purchase_order_id}>
              <td>{row.lpo_number}</td><td>{row.supplier}<small style={{display:'block'}}>{row.department}</small>
                {row.warnings.length>0&&<small role="status" style={{display:'block'}}>{row.warnings.join('; ')}</small>}
              </td>
              <td className="mc-num">{amount(row.posted_receipt_value)}</td>
              <td className="mc-num">{amount(row.matched_invoice_value)}</td>
              <td className="mc-num">{amount(row.unmatched_receipt_value)}</td>
            </tr>)}</tbody>
          </table></div>
          {!grni.orders.length && <div className="mc-empty-state">No posted GRNs fall in this period.</div>}
          <div className="mc-alert mc-muted">{grni.note}</div>
        </>}
        <header className="mc-panel-title">Step 3 · Lock fiscal month</header>
        <FormField label="Mandatory closing note" value={note} onChange={setNote} placeholder="Close-out reference and financial signoff"/>
        <ConfirmTransaction title={'Close '+str(period.name)+'?'} description="Closing locks the accounting period. Django independently checks every blocker again."
          confirmLabel="Lock fiscal period" className={affirmative} busy={busy} disabled={!canClose||busy} onConfirm={close}>
          <Icon name="lock" size={16}/> Close fiscal period
        </ConfirmTransaction>
        <header className="mc-panel-title">Step 4 · General ledger export</header>
        <div className="mc-decision-bar"><button className={btn} disabled={busy||str(period.status)!=='closed'} onClick={()=>void generate()}>
          <Icon name="file_download" size={16}/> Generate GL CSV</button>
          {exports.map(row=><button className={btn} key={str(row.id)} onClick={()=>void downloadGLExport(str(row.id))}>
            <Icon name="download" size={15}/> Download GL journal · {dateStr(row.generated_at)}</button>)}</div>
      </>}</section>
    </div>}
  </WorkspacePage>
}

export function EnterprisePurchaseOrderDetail() {
  const {data,loading,error,reload}=useBackendRows(['purchase-orders','purchase-order-items','grns','requisitions'])
  const {busy,error:mutationError,run}=useOperation(reload)
  const pathId=typeof window==='undefined'?'':window.location.pathname.split('/').filter(Boolean).at(-1)||''
  const [chosenId,setChosenId]=useState('')
  const id=chosenId||pathId
  const order=(data['purchase-orders']||[]).find(row=>str(row.id)===id)
  const items=(data['purchase-order-items']||[]).filter(row=>str(row.purchase_order)===id)
  const receipts=(data.grns||[]).filter(row=>str(row.purchase_order)===id)
  const received=items.reduce((sum,row)=>sum+dec(row.quantity_received||row.received_quantity),0)
  const ordered=items.reduce((sum,row)=>sum+dec(row.approved_quantity||row.quantity),0)
  return <WorkspacePage section="Purchase / Orders" title={'Purchase order · '+str(order?.lpo_number||order?.po_number||id)}
    subtitle="Approved order lines, authorisation trail, fulfilment progress and document print controls."
    actions={<button className={btn} onClick={()=>void reload()}><Icon name="refresh" size={15}/> Refresh</button>}>
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<label className="mc-field mc-picker"><span>Purchase order</span><select value={id} onChange={e=>setChosenId(e.target.value)}>
      <option value="">Choose purchase order</option>{(data['purchase-orders']||[]).map(row=><option value={str(row.id)} key={str(row.id)}>{str(row.lpo_number||row.po_number)} · {str(row.status)}</option>)}
    </select></label>}
    {!loading&&!error&&(order?<>
      <div className="mc-compact-metrics"><div><span>Supplier</span><strong>{str(order.supplier_name||order.supplier)}</strong></div>
        <div><span>Value</span><strong>UGX {amount(order.total_amount)}</strong></div><div><span>Status</span><StatusPill status={order.status}/></div></div>
      <section className="mc-dense-panel"><header className="mc-panel-title">LPO line items</header>
        <div className="mc-detail-lines"><table><thead><tr><th>Article</th><th className="mc-num">Approved quantity</th><th className="mc-num">Unit cost</th><th className="mc-num">Line value</th></tr></thead>
        <tbody>{items.map(row=><tr key={str(row.id)}><td>{str(row.item_name||row.item)}</td><td className="mc-num">{amount(row.approved_quantity||row.quantity)}</td>
          <td className="mc-num">{amount(row.unit_cost)}</td><td className="mc-num">{amount(dec(row.approved_quantity||row.quantity)*dec(row.unit_cost))}</td></tr>)}</tbody></table></div>
        <div className="mc-impact"><div className="mc-impact-top">Delivery progress <strong>{ordered?Math.round(received/ordered*100):0}%</strong></div>
          <div className="mc-impact-track"><span style={{width:(ordered?Math.min(100,received/ordered*100):0)+'%'}}/></div></div>
        <div className="mc-decision-bar"><button className={btn} disabled={busy} onClick={()=>void run(()=>downloadControlledPurchaseOrder(id),'PO document downloaded')}>
          <Icon name="print" size={16}/> Print approved LPO PDF</button></div>
      </section>
      <section className="mc-dense-panel mc-footer-panel">
        <header className="mc-panel-title">Originating purchase requisitions</header>
        {Array.isArray(order.source_requisitions)&&order.source_requisitions.map(value=>{
          const reference=(data.requisitions||[]).find(r=>str(r.id)===str(value))
          return <div key={str(value)} className="mc-info-row">
            <DocumentReference kind="requisition" reference={str(reference?.requisition_number||value)}
              record={reference||undefined}/>
            <span>{str(reference?.department_name||reference?.department||'Department')}</span>
          </div>
        })}
        {!Array.isArray(order.source_requisitions)&&<div className="mc-empty-state">
          This legacy purchase order uses its primary requisition reference.
        </div>}
      </section>
      <section className="mc-dense-panel mc-footer-panel"><header className="mc-panel-title">Linked goods receipts</header>
        {receipts.map(row=><div className="mc-info-row" key={str(row.id)}><DocumentReference reference={str(row.grn_number)} kind="grn" record={row}/><StatusPill status={row.status}/></div>)}
        {!receipts.length&&<div className="mc-empty-state">No goods receipts recorded for this LPO.</div>}
      </section>
    </>:<StateMessage empty>Purchase order not found or inaccessible under your assigned property.</StateMessage>)}
  </WorkspacePage>
}

export function EnterprisePurchaseRequisitionBuilder() {
  const {data,loading,error,reload}=useBackendRows(['items','units'])
  const {busy,error:mutationError,run}=useOperation(reload)
  const [reason,setReason]=useState('')
  const [selectedItem,setSelectedItem]=useState('')
  const [quantity,setQuantity]=useState('1')
  const [lines,setLines]=useState<{item:string;name:string;unit:string;quantity:number;price:number;supplier:string}[]>([])
  const articles=data.items||[]
  const add=()=>{
    const item=articles.find(r=>str(r.id)===selectedItem)
    if(!item||!(Number(quantity)>0))return
    lines.length>=50?void 0:setLines(old=>[...old,{
      item:selectedItem,name:str(item.name),unit:str(item.base_unit),
      quantity:Number(quantity),price:0,supplier:'To be sourced by Purchasing',
    }])
    setSelectedItem('');setQuantity('1')
  }
  const save=async()=>{
    if(!reason.trim()||!lines.length)return
    await run(async()=>{
      const pr=await createBackendRecord('requisitions',{reason,request_type:'department'})
      for(const line of lines){
        await createBackendRecord('requisition-items',{
          requisition:pr.id,item:line.item,unit:line.unit||null,
          quantity:line.quantity,
        })
      }
    },'Purchase requisition and lines saved')
  }
  return <WorkspacePage section="Purchase / Requisitions" title="New purchase requisition"
    subtitle="Prepare a quantity-only department purchase requisition or daily market list; Purchasing manages supplier quotations and commercial rates.">
    <StateMessage loading={loading} error={error||mutationError}/>
    {!loading&&!error&&<div className="mc-split mc-new-pr">
      <section className="mc-dense-panel mc-form-panel"><header className="mc-panel-title">Requisition details</header>
        <FormField label="Purpose / market list name" value={reason} onChange={setReason} placeholder="Daily market requirements"/>
        <label className="mc-field"><span>Article</span><select value={selectedItem} onChange={event=>setSelectedItem(event.target.value)}>
          <option value="">Choose Article</option>{articles.map(r=><option key={str(r.id)} value={str(r.id)}>{str(r.sku)} · {str(r.name)}</option>)}</select></label>
        <FormField label="Requested quantity" value={quantity} onChange={setQuantity} type="number"/>
        <button className={btn} disabled={!selectedItem||!(Number(quantity)>0)} onClick={add}><Icon name="add" size={15}/> Add Article</button>
      </section>
      <section className="mc-dense-panel"><header className="mc-panel-title">Daily market list · {lines.length} lines</header>
        <table className="mc-simple-table"><thead><tr><th>Article</th><th>Supplier allocation</th><th className="mc-num">Qty</th><th></th></tr></thead>
        <tbody>{lines.map((line,i)=><tr key={i}><td>{line.name}</td><td>{line.supplier}</td><td className="mc-num">{line.quantity}</td>
          <td><button className="mc-link-button" onClick={()=>setLines(old=>old.filter((_,j)=>j!==i))} aria-label={'Remove '+line.name}><Icon name="close" size={15}/></button></td></tr>)}</tbody></table>
        <div className="mc-alert mc-muted">Purchasing assigns suppliers and prices later. Submitting a department request does not authorise a purchase order.</div>
        <div className="mc-decision-bar"><ConfirmTransaction title="Save purchase requisition?" description="Creates an external PR and its item lines in the existing backend; approval routing remains a separate step."
          confirmLabel="Save requisition" className={affirmative} busy={busy} disabled={busy||!reason.trim()||!lines.length} onConfirm={save}>
          <Icon name="save" size={15}/> Save PR
        </ConfirmTransaction></div>
      </section>
    </div>}
  </WorkspacePage>
}
