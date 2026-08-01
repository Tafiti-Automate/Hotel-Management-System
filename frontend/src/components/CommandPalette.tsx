import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { cfg, type EntityKey } from '../lib/data'
import { canAccessRoute } from '../lib/access'
import { Icon } from './Icon'

const routeItems = [
  ['dashboard','Dashboard','space_dashboard'],['workflow-stores','Stores workspace','warehouse'],['workflow-procure','Procurement workspace','shopping_cart_checkout'],
  ['workflow-pay','Finance workspace','payments'],['approvals','Approval queue','approval'],['storeRequisitions','Store requisitions','assignment'],
  ['requisitions','Purchase requisitions','request_quote'],['orders','Purchase orders','receipt_long'],['grns','Goods receipts','move_to_inbox'],
  ['balances','Stock balances','equalizer'],['ledgers','Stock ledger','menu_book'],['items','Article catalogue','inventory_2'],
  ['suppliers','Suppliers','local_shipping'],['employees','Employees','badge'],['reports','Reports','bar_chart'],['audit-log','Audit log','history'],
] as const

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp()
  const [query,setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(()=>{ if(open){ setQuery(''); setTimeout(()=>input.current?.focus(),0) } },[open])
  useEffect(()=>{ if(!open)return; const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()}; window.addEventListener('keydown',fn); return()=>window.removeEventListener('keydown',fn)},[open,onClose])

  const results = useMemo(()=>{
    const q=query.trim().toLowerCase()
    const routes=routeItems.filter(([route,label])=>canAccessRoute(app.user,route) && (!q || label.toLowerCase().includes(q))).slice(0,7)
    const records: {entity:EntityKey; id:string; title:string; meta:string}[]=[]
    if(q.length>=2){
      Object.entries(app.data).forEach(([entity,rows])=>{
        if(!cfg[entity] || !canAccessRoute(app.user,entity)) return
        ;(rows||[]).forEach((row:any)=>{
          const text=Object.values(row).filter(v=>typeof v==='string'||typeof v==='number').join(' ').toLowerCase()
          if(text.includes(q) && records.length<12) records.push({entity:entity as EntityKey,id:String(row.id),title:String(row.name||row.reference||row.number||row.id),meta:cfg[entity].title})
        })
      })
    }
    return {routes,records}
  },[query,app.data,app.user])
  if(!open)return null
  const go=(route:string,label:string)=>{app.navTo(route,label);onClose()}
  return <div className="command-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Global search">
      <div className="command-input"><Icon name="search" size={21}/><input ref={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search pages, references, suppliers, employees…" aria-label="Search system"/><kbd>Esc</kbd></div>
      <div className="command-body">
        <div className="command-section-title">Pages and workspaces</div>
        {results.routes.map(([route,label,icon])=><button key={route} className="command-result" onClick={()=>go(route,label)}><span><Icon name={icon} size={18}/></span><div><b>{label}</b><small>Open workspace</small></div><Icon name="arrow_forward" size={16}/></button>)}
        {results.records.length>0 && <><div className="command-section-title">Records</div>{results.records.map(r=><button key={`${r.entity}-${r.id}`} className="command-result" onClick={()=>{app.openDetail(r.entity,r.id,r.entity);onClose()}}><span><Icon name={cfg[r.entity].icon} size={18}/></span><div><b>{r.title}</b><small>{r.meta}</small></div><Icon name="open_in_new" size={16}/></button>)}</>}
        {!results.routes.length&&!results.records.length&&<div className="command-empty"><Icon name="search_off" size={25}/><b>No results found</b><small>Try a reference, supplier, employee, article or page name.</small></div>}
      </div>
      <footer className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span>Search respects your role permissions</span></footer>
    </section>
  </div>
}
