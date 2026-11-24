import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { canViewReport } from '../lib/access'
import { fetchOperationalReport, type OperationalReportId } from '../lib/api'
import { calendarDateInKampala, recordedNumber } from '../lib/operationalSignals'
import { money } from '../lib/theme'
import type { Row } from '../lib/data'

const specs: {id:OperationalReportId;title:string;group:string;fields:{key:string;label:string}[];note:string}[]=[
 {id:'monthlyStoreBalance',title:'Booked closing inventory trend',group:'date',fields:[{key:'closing_value',label:'Closing inventory'}],note:'Booked physical snapshots only; missing months are not zero. Each point is a cutoff balance, not a movement.'},
 {id:'consumptionInventory',title:'Booked departmental consumption',group:'department',fields:[{key:'value',label:'Net recorded cost'}],note:'Includes return reversals; not an additional expense posting.'},
 {id:'costOfSalesLocation',title:'Recorded POS recipe cost of sales',group:'store',fields:[{key:'sales',label:'Net sales'},{key:'cogs',label:'Recipe COGS'}],note:'Not complete hotel cost of sales. Missing cost evidence is not treated as zero.'},
 {id:'fbBudget',title:'Purchasing budget vs commitments',group:'department',fields:[{key:'budget',label:'Configured cap'},{key:'committed',label:'Purchase commitments'}],note:'Configured purchasing caps, not actual expenditure or a P&L budget.'},
 {id:'monthlyReport',title:'Recorded monthly sales and collections',group:'month',fields:[{key:'sales',label:'Sales'},{key:'collected',label:'Collected'}],note:'Recorded sales only; not total hotel revenue or profitability.'},
]
const colors=['#169b62','#0e7490']
type Result={rows:Row[];error:string}
export default function FinancialOverview(){
 const app=useApp()
 const role=app.user.role.trim().toLowerCase()
 const allowed=specs.filter(s=>canViewReport(app.user,s.id)&& (s.id!=='fbBudget'||role!=='cost controller'))
 const ids=allowed.map(s=>s.id).join(',')
 const branch=String(app.data.branches.find(r=>r.name===app.currentBranch)?.id||app.user.branchId||'')
 const scope=JSON.stringify([app.user.id,role,branch,app.currentBranch])
 const today=calendarDateInKampala()
 const [period,setPeriod]=useState(6)
 const [refresh,setRefresh]=useState(0)
 const [state,setState]=useState<{key:string;results:Record<string,Result>}>({key:'',results:{}})
 const start=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-period,1)).toISOString().slice(0,10)
 const requestKey=JSON.stringify([scope,ids,start,today,refresh])
 useEffect(()=>{
  if(!ids||!branch||app.apiStatus!=='live')return
  let active=true
  Promise.all(ids.split(',').map(async id=>{
   try{const payload=await fetchOperationalReport(id as OperationalReportId,{branch,dateFrom:start,dateTo:today});return [id,{rows:Array.isArray(payload.results)?payload.results:[],error:Array.isArray(payload.results)?'':'Unexpected report format'}] as const}
   catch{return [id,{rows:[],error:'Report unavailable or access restricted'}] as const}
  })).then(results=>{if(active)setState({key:requestKey,results:Object.fromEntries(results)})})
  return()=>{active=false}
 },[ids,branch,start,today,requestKey,app.apiStatus])
 if(!allowed.length)return null
 return <section style={{margin:'16px 0',color:'var(--text)'}}>
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}><div><h2 style={{fontSize:17,margin:0}}>Financial & cost performance</h2><small style={{color:'var(--text-muted)'}}>Official report evidence · {start} to {today} · UGX</small></div><div><select aria-label="Financial analytics period" value={period} onChange={e=>setPeriod(Number(e.target.value))}><option value={1}>This month</option><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option></select> <button type="button" className="mc-secondary" onClick={()=>setRefresh(v=>v+1)}>Refresh charts</button></div></div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,340px),1fr))',gap:12,marginTop:12}}>
  {allowed.map(spec=><ReportChart key={spec.id} spec={spec} result={state.key===requestKey?state.results[spec.id]:undefined} available={Boolean(branch)&&app.apiStatus==='live'}/>)}
  </div>
 </section>
}
function ReportChart({spec,result,available}:{spec:typeof specs[number];result:Result|undefined;available:boolean}){
 const panel={padding:16,border:'1px solid var(--border)',borderRadius:13,background:'var(--surface)',minWidth:0}
 const muted={fontSize:11,color:'var(--text-muted)'}
 const grouped=new Map<string,{sums:number[];missing:number[]}>()
 for(const row of result?.rows||[]){
  const label=String(row[spec.group]||'Unknown')
  const bucket=grouped.get(label)||{sums:spec.fields.map(()=>0),missing:spec.fields.map(()=>0)}
  spec.fields.forEach((f,i)=>{const n=recordedNumber(row[f.key]);if(n===null)bucket.missing[i]++;else bucket.sums[i]+=n})
  grouped.set(label,bucket)
 }
 const chronological=['date','month'].includes(spec.group)
 const points=[...grouped].sort((a,b)=>chronological?a[0].localeCompare(b[0]):Math.abs(b[1].sums[0])-Math.abs(a[1].sums[0]))
 const max=Math.max(1,...points.flatMap(([,v])=>v.sums.map(Math.abs)))
 const [selected,setSelected]=useState('')
 return <article style={panel}><strong>{spec.title}</strong><p style={muted}>{spec.note}</p>
 {!available?<p style={muted}>Property or connection unavailable.</p>:!result?<p role="status" style={muted}>Loading report evidence…</p>:result.error?<p role="alert" style={muted}>{result.error}</p>:!points.length?<p style={muted}>No matching report records in this period.</p>:<>
 {chronological&&points.length>1&&<svg viewBox="0 0 340 145" width="100%" role="img" aria-label={spec.title}>
 {[0,1,2,3,4].map(i=><line key={i} x1="20" x2="320" y1={12+i*27} y2={12+i*27} stroke="var(--border)"/>)}
 {spec.fields.map((f,j)=><g key={f.key}>{points.map((p,i)=>i>0&&!p[1].missing[j]&&!points[i-1][1].missing[j]?<line key={i} x1={20+(i-1)*300/(points.length-1)} x2={20+i*300/(points.length-1)} y1={66-points[i-1][1].sums[j]/max*54} y2={66-p[1].sums[j]/max*54} stroke={colors[j]} strokeWidth="2.5"/>:null)}{points.map((p,i)=>!p[1].missing[j]&&<circle key={i} cx={20+i*300/(points.length-1)} cy={66-p[1].sums[j]/max*54} r="3" fill={colors[j]}><title>{p[0]} · {f.label}: {money(p[1].sums[j])}</title></circle>)}</g>)}
 {points.map((p,i)=>(i===0||i===points.length-1||points.length<=6)&&<text key={p[0]} x={20+i*300/(points.length-1)} y="140" textAnchor="middle" fontSize="9" fill="var(--text-muted)">{p[0].slice(0,7)}</text>)}
 </svg>}
 <div style={{display:'grid',gap:8,maxHeight:290,overflow:'auto'}}>{points.map(([label,v])=><button key={label} type="button" onClick={()=>setSelected(selected===label?'':label)} aria-pressed={selected===label} style={{display:'grid',gap:4,textAlign:'left',background:'transparent',border:0,color:'var(--text)',padding:4,cursor:'pointer'}}><strong style={{fontSize:12}}>{label}</strong>{spec.fields.map((f,i)=><div key={f.key}><div style={{display:'flex',justifyContent:'space-between',gap:6,fontSize:11}}><span>{f.label}</span><b>{v.missing[i]?'Incomplete · '+v.missing[i]+' missing':money(v.sums[i])}</b></div>{!v.missing[i]&&<div style={{height:8,background:'var(--surface-2)',borderRadius:4}}><div style={{height:8,width:Math.abs(v.sums[i])/max*100+'%',background:v.sums[i]<0?'#dc5262':colors[i],borderRadius:4}}/></div>}</div>)}</button>)}</div>
 {selected&&<div style={{marginTop:10}}><strong style={{fontSize:12}}>{selected} · report records</strong> <button type="button" className="mc-secondary" onClick={()=>setSelected('')}>Clear</button><div style={{maxHeight:180,overflow:'auto'}}>{result.rows.filter(r=>String(r[spec.group]||'Unknown')===selected).map((r,i)=><div key={i} style={{borderBottom:'1px solid var(--border)',padding:'6px 0',fontSize:11}}>{String(r.article||r.store||r.department||r.month||selected)} · {spec.fields.map(f=>f.label+': '+(recordedNumber(r[f.key])===null?'Unavailable':money(Number(r[f.key])))).join(' · ')}</div>)}</div></div>}
 </>}
 </article>
}
