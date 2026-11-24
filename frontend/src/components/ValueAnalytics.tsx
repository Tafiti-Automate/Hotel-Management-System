import { useState } from 'react'
import { recordedNumber } from '../lib/operationalSignals'
import { money } from '../lib/theme'

export type ValueRecord = {label:string;group:string;amount:unknown;date?:unknown}
export default function ValueAnalytics({title,description,records,ready=true,monetary=true,scope=''}:{title:string;description:string;records:ValueRecord[];ready?:boolean;monetary?:boolean;scope?:string}){
  const [filter,setFilter]=useState<{scope:string;group:string}|null>(null)
  const active=filter?.scope===scope?filter.group:''
  const valid=records.flatMap(r=>{const n=recordedNumber(r.amount);return n!==null&&n>=0?[{...r,amount:n}]:[]})
  const groups=new Map<string,number>()
  valid.forEach(r=>groups.set(r.group,(groups.get(r.group)||0)+r.amount))
  const ranked=[...groups].sort((a,b)=>b[1]-a[1])
  const top=ranked.slice(0,7)
  const total=valid.reduce((s,r)=>s+r.amount,0)
  const fmt=(n:number)=>monetary?money(n):n.toLocaleString('en-UG')
  const panel={padding:16,border:'1px solid var(--border)',borderRadius:13,background:'var(--surface)',minWidth:0}
  const muted={fontSize:11,color:'var(--text-muted)'}
  return <section style={{...panel,margin:'12px 0',color:'var(--text)'}} aria-label={title}>
    <h2 style={{margin:'0 0 5px',fontSize:17}}>{title}</h2><p style={muted}>{description}</p>
    {!ready?<p style={muted}>Data unavailable.</p>:!valid.length?<p style={muted}>No records with usable values.</p>:<>
      <div style={{fontSize:24,fontWeight:750,fontVariantNumeric:'tabular-nums'}}>{fmt(total)}</div>
      <p style={muted}>{valid.length} usable records · {records.length-valid.length} excluded for missing or invalid values</p>
      <div style={{display:'grid',gap:8}}>{top.map(([label,value])=><button type="button" key={label} aria-pressed={active===label} onClick={()=>setFilter(active===label?null:{scope,group:label})} style={{display:'grid',gap:4,textAlign:'left',border:0,background:'transparent',color:'var(--text)',cursor:'pointer',font:'inherit',padding:2}}>
        <span style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12}}><span>{label}</span><b>{fmt(value)}</b></span><span style={{height:10,background:'var(--surface-2)',borderRadius:5,overflow:'hidden'}}><span style={{display:'block',height:'100%',width:(value/Math.max(1,top[0][1])*100)+'%',background:'#169b62',borderRadius:5}}/></span>
      </button>)}</div>
      {ranked.length>7&&<p style={muted}>Showing the seven largest groups; total includes all groups.</p>}
      {active&&<div style={{marginTop:12,maxHeight:220,overflow:'auto'}}><strong>{active}</strong> <button type="button" className="mc-secondary" onClick={()=>setFilter(null)}>Clear</button>{valid.filter(r=>r.group===active).map((r,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'8px 0',borderBottom:'1px solid var(--border)',fontSize:12}}><span>{r.label}</span><b>{fmt(r.amount)}</b></div>)}</div>}
    </>}
  </section>
}
