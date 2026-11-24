import { useState } from 'react'
import type { Row } from '../lib/data'
import { operationalStatus } from '../lib/operationalSignals'

type Group = { label:string; rows:Row[] }
type Entry = { label:string; status:string; date:string; detail:string }
const palette=['#169b62','#0e7490','#d97706','#7c3aed','#dc5262','#64748b','#2563eb','#a16207']
const format=(n:number)=>n.toLocaleString('en-UG')
const text=(v:unknown)=>String(v??'').trim()
function month(value:unknown) {
  const v=text(value)
  if(!/^\d{4}-\d{2}/.test(v))return ''
  const d=new Date(v)
  return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala',year:'numeric',month:'2-digit'}).format(d):''
}
function groupCount(values:string[]) {
  const map=new Map<string,number>()
  values.forEach(v=>map.set(v,(map.get(v)||0)+1))
  return [...map].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label))
}
export default function OverviewAnalytics({groups,ready,title='Operational analytics',dateLabel='Recorded date',scope=''}:{groups:Group[];ready:boolean;title?:string;dateLabel?:string;scope?:string}) {
  const [period,setPeriod]=useState(6)
  const [filter,setFilter]=useState<{scope:string;kind:'label'|'status'|'month';value:string}|null>(null)
  const selected=filter?.scope===scope?filter:null
  const entries:Entry[]=groups.flatMap(group=>group.rows.map(row=>({
    label:group.label,status:operationalStatus(row.statusCode||row.status||'Unknown').label,
    date:month(row.analytics_date||row.created_at||row.createdAt||row.date||row.dateJoined),
    detail:text(row.lpo_number||row.grn_number||row.reference||row.requisition_no||row.name||row.number||row.id)||'Record',
  })))
  const now=new Date()
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala',year:'numeric',month:'2-digit'}).formatToParts(now)
  const year=Number(parts.find(p=>p.type==='year')?.value), m=Number(parts.find(p=>p.type==='month')?.value)
  const months=Array.from({length:period},(_,i)=>{const d=new Date(Date.UTC(year,m-period+i,1));return {key:d.toISOString().slice(0,7),label:d.toLocaleString('en-GB',{month:'short',timeZone:'UTC'})}})
  const trend=months.map(p=>({...p,value:entries.filter(e=>e.date===p.key).length}))
  const dated=entries.filter(e=>e.date).length
  const kinds=groupCount(entries.map(e=>e.label))
  const rawStatuses=groupCount(entries.map(e=>e.status))
  const statuses=rawStatuses.length>7?[...rawStatuses.slice(0,7),{label:'Other statuses',value:rawStatuses.slice(7).reduce((s,x)=>s+x.value,0)}]:rawStatuses
  const matches=selected?entries.filter(e=>selected.kind==='status'&&selected.value==='Other statuses'?rawStatuses.slice(7).some(s=>s.label===e.status):e[selected.kind==='month'?'date':selected.kind]===selected.value):[]
  const max=Math.max(1,...trend.map(p=>p.value))
  const x=(i:number)=>38+i*292/Math.max(1,trend.length-1)
  const y=(n:number)=>128-n/max*104
  const panel={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,padding:16,minWidth:0}
  const muted={color:'var(--text-muted)',fontSize:11}
  const choose=(kind:'label'|'status'|'month',value:string)=>setFilter({scope,kind,value})
  if(!ready)return <section style={panel}><strong>{title}</strong><p style={muted}>Analytics unavailable while records are loading or inaccessible.</p></section>
  if(!entries.length)return <section style={panel}><strong>{title}</strong><p style={muted}>No accessible records to chart.</p></section>
  let offset=0
  return <section aria-label={title} style={{display:'grid',gap:12,margin:'12px 0',color:'var(--text)'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}><div><h2 style={{margin:0,fontSize:17}}>{title}</h2><small style={muted}>Record counts · current access scope</small></div><label style={muted}>Trend period <select value={period} onChange={e=>{setPeriod(Number(e.target.value));setFilter(null)}}><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option></select></label></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,280px),1fr))',gap:12}}>
      <article style={panel}><strong>Monthly activity</strong><p style={muted}>{dateLabel} · {format(entries.length-dated)} records without usable dates</p>
        {dated? <svg viewBox="0 0 360 155" width="100%" role="img" aria-label="Monthly record counts">
          {[0,1,2,3,4].map(i=><g key={i}><line x1="38" x2="330" y1={y(max*i/4)} y2={y(max*i/4)} stroke="var(--border)"/><text x="32" y={y(max*i/4)+3} textAnchor="end" fontSize="9" fill="var(--text-muted)">{Math.round(max*i/4)}</text></g>)}
          <path d={'M '+trend.map((p,i)=>x(i)+' '+y(p.value)).join(' L ')+' L 330 128 L 38 128 Z'} fill="#169b62" opacity=".12"/>
          <polyline points={trend.map((p,i)=>x(i)+','+y(p.value)).join(' ')} stroke="#169b62" strokeWidth="2.6" strokeLinejoin="round" fill="none"/>
          {trend.map((p,i)=><g key={p.key}><circle cx={x(i)} cy={y(p.value)} r="3.5" fill="#169b62"><title>{p.key}: {p.value} records</title></circle>{(period===6||i%2===0||i===period-1)&&<text x={x(i)} y="145" textAnchor="middle" fontSize="9" fill="var(--text-muted)">{p.label}</text>}</g>)}
        </svg>:<p style={muted}>No dated records available for a historical trend.</p>}
        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>{trend.filter(p=>p.value>0).map(p=><button type="button" className="mc-secondary" key={p.key} onClick={()=>choose('month',p.key)} style={{fontSize:10}}>{p.label} {p.key.slice(0,4)} · {p.value}</button>)}</div>
      </article>
      <article style={panel}><strong>Record volumes</strong><p style={muted}>Records by type</p>
        {kinds.map((p,i)=><button type="button" key={p.label} onClick={()=>choose('label',p.label)} style={{display:'grid',gap:5,width:'100%',textAlign:'left',padding:'8px 0',border:0,background:'transparent',color:'var(--text)',cursor:'pointer',font:'inherit'}}><span style={{display:'flex',justifyContent:'space-between',fontSize:12}}>{p.label}<b>{format(p.value)}</b></span><span style={{height:10,background:'var(--surface-2)',borderRadius:5,overflow:'hidden'}}><span style={{display:'block',height:'100%',width:p.value/Math.max(1,kinds[0]?.value||0)*100+'%',background:palette[i%palette.length],borderRadius:5}}/></span></button>)}
      </article>
      <article style={panel}><strong>Status distribution</strong><p style={muted}>Records by status</p>
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}><svg viewBox="0 0 128 128" width="125" role="img" aria-label="Record status distribution">
          {statuses.map((p,i)=>{const length=p.value/entries.length*314.159;const start=offset;offset+=length;return <circle key={p.label} cx="64" cy="64" r="50" fill="none" stroke={palette[i]} strokeWidth="17" strokeDasharray={length+' '+(314.159-length)} strokeDashoffset={-start} transform="rotate(-90 64 64)"><title>{p.label}: {p.value}</title></circle>})}
          <text x="64" y="63" textAnchor="middle" fontWeight="700" fontSize="18" fill="var(--text)">{format(entries.length)}</text><text x="64" y="77" textAnchor="middle" fontSize="9" fill="var(--text-muted)">Records</text>
        </svg><div style={{flex:'1 1 105px'}}>{statuses.map((p,i)=><button type="button" key={p.label} onClick={()=>choose('status',p.label)} style={{display:'flex',alignItems:'center',gap:6,width:'100%',border:0,background:'transparent',color:'var(--text)',padding:'5px 0',textAlign:'left',cursor:'pointer',fontSize:11}}><i style={{width:9,height:9,borderRadius:2,background:palette[i],flexShrink:0}}/><span style={{flex:1}}>{p.label}</span><b>{p.value}</b></button>)}</div></div>
      </article>
    </div>
    {selected&&<article style={panel}><div style={{display:'flex',justifyContent:'space-between',gap:8}}><strong>{selected.value} · {matches.length} records</strong><button type="button" className="mc-secondary" onClick={()=>setFilter(null)}>Clear selection</button></div><div style={{maxHeight:240,overflow:'auto'}}>{matches.map((e,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'9px 0',borderBottom:'1px solid var(--border)',fontSize:12}}><span>{e.detail} · {e.label}</span><span style={muted}>{e.status}</span></div>)}</div></article>}
  </section>
}
