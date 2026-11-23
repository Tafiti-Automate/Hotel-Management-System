import { useMemo, useState, type ChangeEvent } from 'react'
import ConfirmTransaction from '../components/ConfirmTransaction'
import { createBackendRecord, getToken, runBackendAction } from '../lib/api'
import { useApp } from '../state/AppContext'
import { dateLabel, HRAlerts, HREmployeeOptions, HRMetric, HRPage, HRStatus,
  number, text, today, useHRAction, useHRData, year, type HRRow } from './HRWorkspaceKit'

const leaveTypes = [
  ['annual','Annual leave'],['sick','Sick leave'],['maternity','Maternity leave'],
  ['paternity','Paternity leave'],['compassionate','Compassionate leave'],['unpaid','Unpaid leave'],
]
const documentCategories = [
  ['contract','Employment contract'],['identification','Identification'],
  ['appointment','Appointment letter'],['qualification','Qualification'],
  ['tax','Tax / statutory'],['disciplinary','Disciplinary'],['other','Other'],
]
const isManager = (role:string):boolean => role.trim().toLowerCase()==='hr manager'

export function LeaveWorkspace() {
  const app=useApp()
  const {data,loading,error,reload}=useHRData(['leave-requests','employees'])
  const {busy,error:mutationError,message,run}=useHRAction(reload)
  const [employee,setEmployee]=useState(''),[type,setType]=useState('annual'),[start,setStart]=useState(today()),[end,setEnd]=useState(today()),[days,setDays]=useState('1'),[reason,setReason]=useState('')
  const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({})
  const [filter,setFilter]=useState('all')
  const rows=(data['leave-requests']||[]).filter(r=>filter==='all'||text(r.status)===filter)
  const pending=(data['leave-requests']||[]).filter(r=>text(r.status)==='pending').length
  const submit=async()=>{
    if(!employee||!start||!end||end<start||number(days)<=0||!Number.isFinite(Number(days))) {
      app.showWorkflowAlert('Leave request incomplete','Select the employee, leave dates and a positive number of approved-count days.','warning');return
    }
    const ok=await run(()=>createBackendRecord('leave-requests',{
      employee,leave_type:type,start_date:start,end_date:end,days,reason:reason.trim(),
    }),'Leave request recorded')
    if(ok){setEmployee('');setDays('1');setReason('')}
  }
  const review=async(r:HRRow,decision:'approve'|'reject')=>{
    const note=(reviewNotes[text(r.id)]||'').trim()
    if(decision==='reject'&&!note){app.showWorkflowAlert('Reason required','Explain why the leave request is rejected.','warning');return}
    await run(()=>runBackendAction('leave-requests',text(r.id),decision,{note}),`Leave request ${decision==='approve'?'approved':'rejected'}`)
  }
  return <HRPage eyebrow="Human resources / Leave" title="Leave management"
    description="Record employee leave, review pending requests and maintain a traceable approval register."
    right={<button type="button" className="hr-btn" onClick={()=>void reload()}>Refresh</button>}>
    <HRAlerts loading={loading} error={error||mutationError} message={message} retry={()=>void reload()}/>
    {!loading&&!error&&<>
      <section className="hr-metrics"><HRMetric label="Awaiting HR decision" value={String(pending)}/><HRMetric label="Recorded leave requests" value={String((data['leave-requests']||[]).length)} /></section>
      <section className="hr-panel"><header><h2>Record leave request</h2><span>Working-day entitlement and holiday rules require HR validation</span></header>
        <div className="hr-inline-form">
          <label>Employee<select value={employee} onChange={e=>setEmployee(e.target.value)}><HREmployeeOptions employees={data.employees||[]}/></select></label>
          <label>Leave type<select value={type} onChange={e=>setType(e.target.value)}>{leaveTypes.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label>Start date<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
          <label>End date<input type="date" min={start} value={end} onChange={e=>setEnd(e.target.value)}/></label>
          <label>Chargeable leave days<input min="0.5" step="0.5" type="number" value={days} onChange={e=>setDays(e.target.value)}/></label>
          <label>Reason<input value={reason} onChange={e=>setReason(e.target.value)}/></label>
          <button type="button" className="hr-btn primary" disabled={busy} onClick={()=>void submit()}>Record leave</button>
        </div>
      </section>
      <section className="hr-panel"><header><h2>Leave approval register</h2>
        <label className="hr-search">Status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label></header>
        <div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>Employee</th><th>Leave type</th><th>Dates</th><th className="num">Days</th><th>Status</th><th>HR decision</th></tr></thead>
          <tbody>{rows.map(r=><tr key={text(r.id)}><td><strong>{text(r.employee_name)}</strong><small>{text(r.department_name)}</small></td><td>{text(r.leave_type_label||r.leave_type)}</td><td>{dateLabel(r.start_date)} – {dateLabel(r.end_date)}</td><td className="num">{text(r.days)}</td><td><HRStatus value={r.status}/>{Boolean(r.review_note)&&<small>{text(r.review_note)}</small>}</td><td>{isManager(app.user.role)&&text(r.status)==='pending'?<div className="hr-review"><input aria-label={`Review note for ${text(r.employee_name)}`} placeholder="Approval / rejection note" value={reviewNotes[text(r.id)]||''} onChange={e=>setReviewNotes(p=>({...p,[text(r.id)]:e.target.value}))}/>
             <ConfirmTransaction title="Approve leave?" description="Verify dates, entitlement, overlapping leave and coverage arrangements." confirmLabel="Approve" className="hr-btn" disabled={busy} busy={busy} onConfirm={()=>review(r,'approve')}>Approve</ConfirmTransaction>
             <ConfirmTransaction title="Reject leave?" description="The HR review note is required and will be retained in the register." confirmLabel="Reject" className="hr-btn" disabled={busy||!(reviewNotes[text(r.id)]||'').trim()} busy={busy} onConfirm={()=>review(r,'reject')}>Reject</ConfirmTransaction>
           </div>:'—'}</td></tr>)}
          {!rows.length&&<tr><td colSpan={6} className="hr-empty">No leave requests match this filter.</td></tr>}</tbody></table></div>
      </section>
    </>}
  </HRPage>
}

export function LeaveCalendarWorkspace() {
  const {data,loading,error,reload}=useHRData(['leave-requests'])
  const [month,setMonth]=useState(new Date().getMonth())
  const [currentYear,setCurrentYear]=useState(year())
  const [selection,setSelection]=useState('')
  const approved=(data['leave-requests']||[]).filter(r=>text(r.status)==='approved')
  const firstDay=new Date(currentYear,month,1).getDay()
  const offset=(firstDay+6)%7
  const days=new Date(currentYear,month+1,0).getDate()
  const byDay=useMemo(()=>{
    const result:Record<number,HRRow[]>={}
    for(let day=1;day<=days;day++){
      const date=`${currentYear}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
      result[day]=approved.filter(row=>text(row.start_date).slice(0,10)<=date&&text(row.end_date).slice(0,10)>=date)
    }
    return result
  },[approved,days,currentYear,month])
  const shift=(delta:number)=>{const d=new Date(currentYear,month+delta,1);setCurrentYear(d.getFullYear());setMonth(d.getMonth());setSelection('')}
  const selectedDay=Number(selection.slice(-2))
  return <HRPage eyebrow="Human resources / Leave" title="Leave calendar" description="Approved leave plotted by date for staffing and department coverage planning."
    right={<div className="hr-page-switch"><button type="button" onClick={()=>shift(-1)}>Previous</button><strong>{new Date(currentYear,month,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</strong><button type="button" onClick={()=>shift(1)}>Next</button><button type="button" onClick={()=>void reload()}>Refresh</button></div>}>
    <HRAlerts loading={loading} error={error} retry={()=>void reload()}/>
    {!loading&&!error&&<div className="hr-columns">
      <section className="hr-panel hr-calendar-panel"><div className="hr-calendar-grid">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><div key={d} className="hr-calendar-label">{d}</div>)}
        {Array.from({length:offset},(_,i)=><div key={`blank-${i}`} className="hr-calendar-empty"/>)}
        {Array.from({length:days},(_,i)=>{
          const day=i+1,items=byDay[day]||[]
          return <button key={day} type="button" aria-label={`${day} ${new Date(currentYear,month,1).toLocaleDateString('en-GB',{month:'long'})}: ${items.length} people on approved leave`} className={`hr-calendar-day ${items.length?'is-leave':''}`} aria-pressed={selectedDay===day} onClick={()=>setSelection(`${currentYear}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`)}>
            <strong>{day}</strong>{items.length>0&&<small>{items.length} on leave</small>}
          </button>
        })}
      </div></section>
      <section className="hr-panel"><header><h2>{selection?dateLabel(selection):'Monthly approved leave'}</h2></header>
        {selection?(byDay[selectedDay]||[]).map(r=><div className="hr-list-line" key={text(r.id)}><strong>{text(r.employee_name)}</strong><span>{text(r.department_name)} · {text(r.leave_type_label||r.leave_type)}</span></div>)
          :approved.filter(r=>text(r.start_date).slice(0,7)<=`${currentYear}-${String(month+1).padStart(2,'0')}`&&text(r.end_date).slice(0,7)>=`${currentYear}-${String(month+1).padStart(2,'0')}`).map(r=><div className="hr-list-line" key={text(r.id)}><strong>{text(r.employee_name)}</strong><span>{dateLabel(r.start_date)} – {dateLabel(r.end_date)}</span></div>)}
        {!approved.length&&<p className="hr-empty">No approved leave records yet.</p>}
      </section>
    </div>}
  </HRPage>
}

async function postDocument(form:FormData):Promise<void>{
  const token=getToken()
  if(!token) throw new Error('Your session expired. Sign in again.')
  const base=(process.env.NEXT_PUBLIC_API_BASE_URL||'/api/v1').replace(/\/+$/,'')
  const res=await fetch(`${base}/employee-documents/`,{method:'POST',headers:{Authorization:`Token ${token}`},body:form})
  if(!res.ok){const body=await res.json().catch(()=>({})) as Record<string,unknown>;throw new Error(text(body.detail)||JSON.stringify(body)||`Upload rejected (${res.status})`)}
}

async function downloadDocument(id:string,filename:string):Promise<void>{
  const token=getToken()
  if(!token) throw new Error('Your session expired. Sign in again.')
  const base=(process.env.NEXT_PUBLIC_API_BASE_URL||'/api/v1').replace(/\/+$/,'')
  const response=await fetch(`${base}/employee-documents/${encodeURIComponent(id)}/download/`,{headers:{Authorization:`Token ${token}`}})
  if(!response.ok) throw new Error(`Authorized document download failed (${response.status}).`)
  const blob=await response.blob(),url=URL.createObjectURL(blob)
  const anchor=document.createElement('a');anchor.href=url;anchor.download=filename||'employee-document';document.body.appendChild(anchor);anchor.click();anchor.remove()
  setTimeout(()=>URL.revokeObjectURL(url),3000)
}

export function HRDocumentsWorkspace() {
  const app=useApp()
  const {data,loading,error,reload}=useHRData(['employee-documents','employees'])
  const {busy,error:mutationError,message,run}=useHRAction(reload)
  const [employee,setEmployee]=useState(''),[category,setCategory]=useState('contract'),[title,setTitle]=useState(''),[expiry,setExpiry]=useState(''),[note,setNote]=useState(''),[file,setFile]=useState<File|null>(null),[filter,setFilter]=useState('')
  const rows=(data['employee-documents']||[]).filter(d=>[d.employee_name,d.employee_code,d.title,d.category].some(v=>text(v).toLowerCase().includes(filter.toLowerCase())))
  const upload=async()=>{
    if(!employee||!title.trim()||!file){app.showWorkflowAlert('Document incomplete','Choose an employee, a title and a file.','warning');return}
    if(file.size>8*1024*1024){app.showWorkflowAlert('File too large','Use an employee document smaller than 8 MB.','warning');return}
    const form=new FormData();form.append('employee',employee);form.append('category',category);form.append('title',title.trim());form.append('file',file);if(expiry)form.append('expiry_date',expiry);if(note)form.append('note',note)
    const ok=await run(()=>postDocument(form),'Employee document uploaded')
    if(ok){setTitle('');setFile(null);setNote('');setExpiry('')}
  }
  const onFileChange=(e:ChangeEvent<HTMLInputElement>)=>setFile(e.target.files?.[0]||null)
  return <HRPage eyebrow="Human resources / Personnel files" title="Employee documents" description="Authorized personnel files with category, expiry tracking and protected download actions."
    right={<button type="button" className="hr-btn" onClick={()=>void reload()}>Refresh</button>}>
    <HRAlerts loading={loading} error={error||mutationError} message={message} retry={()=>void reload()}/>
    {!loading&&!error&&<>
      <section className="hr-panel"><header><h2>Upload employee document</h2><span>PDF, Word or image · up to 8 MB</span></header>
        <div className="hr-inline-form">
          <label>Employee<select value={employee} onChange={e=>setEmployee(e.target.value)}><HREmployeeOptions employees={data.employees||[]}/></select></label>
          <label>Category<select value={category} onChange={e=>setCategory(e.target.value)}>{documentCategories.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label>Document title<input value={title} onChange={e=>setTitle(e.target.value)}/></label>
          <label>Expiry (optional)<input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
          <label className="hr-file">Document file<input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={onFileChange}/></label>
          <label>Notes<input value={note} onChange={e=>setNote(e.target.value)}/></label>
          <button type="button" className="hr-btn primary" disabled={busy||!file} onClick={()=>void upload()}>Upload to personnel file</button>
        </div>
      </section>
      <section className="hr-panel"><header><h2>Personnel document register</h2><label className="hr-search">Find document<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Employee or document"/></label></header>
        <div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>Employee</th><th>Document</th><th>Category</th><th>Expires</th><th>Action</th></tr></thead><tbody>
          {rows.map(r=><tr key={text(r.id)}><td><strong>{text(r.employee_name)}</strong><small>{text(r.employee_code)}</small></td><td>{text(r.title)}</td><td>{text(r.category)}</td><td>{dateLabel(r.expiry_date)}</td><td><button type="button" className="hr-link" disabled={busy} onClick={()=>void run(()=>downloadDocument(text(r.id),text(r.original_name)||'employee-document'),'Employee document downloaded')}>Download</button></td></tr>)}
          {!rows.length&&<tr><td colSpan={5} className="hr-empty">No personnel documents match this search.</td></tr>}
        </tbody></table></div>
      </section>
    </>}
  </HRPage>
}
