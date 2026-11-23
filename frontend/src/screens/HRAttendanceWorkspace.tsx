import { useState } from 'react'
import ConfirmTransaction from '../components/ConfirmTransaction'
import { createBackendRecord, runBackendAction } from '../lib/api'
import { useApp } from '../state/AppContext'
import { HRAlerts, HREmployeeOptions, HRMetric, HRPage, HRStatus,
  currency, dateLabel, number, text, today, useHRAction, useHRData, type HRRow } from './HRWorkspaceKit'

const statuses: [string,string][] = [
  ['present','Present / worked'],
  ['rest','Paid scheduled rest day'],
  ['public_holiday','Paid public holiday'],
  ['paid_leave','Approved paid leave'],
  ['unpaid_leave','Approved unpaid leave'],
  ['absent','Unpaid absence'],
]

function isManager(role:string):boolean { return role.toLowerCase().trim()==='hr manager' }

export function HRAttendanceWorkspace(){
  const app=useApp()
  const [day,setDay]=useState(today())
  const resource=`attendance-records?work_date=${day}`
  const {data,loading,error,reload}=useHRData([resource,'employees','hr-shifts'])
  const {busy,error:mutationError,message,run}=useHRAction(reload)
  const employees=data.employees||[],shifts=data['hr-shifts']||[],rows=data[resource]||[]
  const [employee,setEmployee]=useState(''),[status,setStatus]=useState('present'),[shift,setShift]=useState('')
  const [hours,setHours]=useState('8'),[overtimeHours,setOvertimeHours]=useState('0'),[overtimePay,setOvertimePay]=useState('0'),[note,setNote]=useState('')
  const isPresent=status==='present'
  const employeeRecord=employees.find(e=>text(e.id)===employee)
  const eligibleShifts=shifts.filter(s=>s.is_active!==false&&text(s.branch)===text(employeeRecord?.branch))
  const approved=rows.filter(r=>Boolean(r.approved_at)).length
  const create=async()=>{
    if(!employee||!day||day>today()||!statuses.some(([key])=>key===status)){
      app.showWorkflowAlert('Attendance incomplete','Select an employee, a valid past or current day, and the correct attendance status.','warning');return
    }
    const normal=Number(hours),otHours=Number(overtimeHours),otPay=Number(overtimePay)
    if(isPresent&&(!Number.isFinite(normal)||normal<0||!Number.isFinite(otHours)||otHours<0||!Number.isFinite(otPay)||otPay<0||(otHours>0)!==(otPay>0))){
      app.showWorkflowAlert('Overtime validation','Hours must be non-negative. Approved overtime hours and overtime pay must both be positive or both zero.','warning');return
    }
    const succeeded=await run(()=>createBackendRecord('attendance-records',{
      employee,work_date:day,shift:shift||null,status,
      worked_hours:isPresent?hours:'0',overtime_hours:isPresent?overtimeHours:'0',
      overtime_pay:isPresent?overtimePay:'0',note:note.trim(),
    }),'Attendance recorded for independent approval')
    if(succeeded){setEmployee('');setShift('');setOvertimeHours('0');setOvertimePay('0');setNote('')}
  }
  const approve=async(row:HRRow)=>{
    await run(()=>runBackendAction('attendance-records',text(row.id),'approve'),'Daily attendance approved')
  }
  return <HRPage eyebrow="Human resources / Time & attendance" title="Daily attendance"
    description="Record hotel work, rest, holiday, leave and absences. A separate HR Manager must approve each day before payroll."
    right={<button className="hr-btn" type="button" onClick={()=>void reload()}>Refresh register</button>}>
    <HRAlerts loading={loading} error={error||mutationError} message={message} retry={()=>void reload()}/>
    <section className="hr-panel">
      <header><h2>Attendance date</h2><label className="hr-search">Work date
        <input type="date" value={day} max={today()} onChange={e=>setDay(e.target.value)}/>
      </label></header>
      <p className="hr-muted">A record is required for every calendar day from the employee's joining date, including paid rest days and unpaid absences. Approved leave must exist before marking leave status. Only independently approved records count towards payroll.</p>
    </section>
    {!loading&&!error&&<>
      <section className="hr-metrics">
        <HRMetric label="Recorded for selected day" value={String(rows.length)}/>
        <HRMetric label="Approved records" value={String(approved)}/>
        <HRMetric label="Pending review" value={String(rows.length-approved)}/>
        <HRMetric label="Overtime approved (UGX)" value={currency(rows.filter(r=>Boolean(r.approved_at)).reduce((sum,r)=>sum+number(r.overtime_pay),0))}/>
      </section>
      <section className="hr-panel"><header><h2>New daily attendance</h2><span>Draft · independent review required</span></header>
        <div className="hr-inline-form">
          <label>Employee<select value={employee} onChange={e=>{setEmployee(e.target.value);setShift('')}}><HREmployeeOptions employees={employees}/></select></label>
          <label>Attendance status<select value={status} onChange={e=>setStatus(e.target.value)}>{statuses.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label>Shift (optional)<select value={shift} onChange={e=>setShift(e.target.value)}><option value="">No shift assigned</option>{eligibleShifts.map(s=><option key={text(s.id)} value={text(s.id)}>{text(s.name)} · {text(s.starts_at).slice(0,5)}–{text(s.ends_at).slice(0,5)}</option>)}</select></label>
          {isPresent&&<>
            <label>Hours worked<input type="number" min="0" step="0.25" value={hours} onChange={e=>setHours(e.target.value)}/></label>
            <label>Overtime hours<input type="number" min="0" step="0.25" value={overtimeHours} onChange={e=>setOvertimeHours(e.target.value)}/></label>
            <label>Approved overtime gross (UGX)<input type="number" min="0" step="0.01" value={overtimePay} onChange={e=>setOvertimePay(e.target.value)}/></label>
          </>}
          <label>Evidence / remarks<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Supervisor log, leave reference or policy basis"/></label>
          <button type="button" className="hr-btn primary" disabled={busy||!employee||!day} onClick={()=>void create()}>Record attendance</button>
        </div>
        <p className="hr-muted">Overtime pay must follow a verified contract or approved hotel policy, including applicable holiday premiums. This screen does not automatically calculate a statutory overtime rate.</p>
      </section>
      <section className="hr-panel"><header><h2>Daily approval register</h2><span>{rows.length} records</span></header>
        <div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>Employee</th><th>Status / shift</th><th className="num">Hours</th><th className="num">OT hours</th><th className="num">OT gross (UGX)</th><th>Approval</th><th>Action</th></tr></thead>
          <tbody>{rows.map(row=><tr key={text(row.id)}>
            <td><strong>{text(row.employee_name)}</strong><small>{text(row.employee_code)} · {text(row.department_name)}</small></td>
            <td><strong>{statuses.find(([v])=>v===text(row.status))?.[1]||text(row.status)}</strong><small>{text(row.shift_name)||'Unassigned shift'}</small></td>
            <td className="num">{text(row.worked_hours)}</td>
            <td className="num">{text(row.overtime_hours)}</td>
            <td className="num">{currency(row.overtime_pay)}</td>
            <td>{row.approved_at?<HRStatus value="approved"/>:<HRStatus value="pending"/>}<small>{text(row.reviewed_by_name)}</small></td>
            <td>{isManager(app.user.role)&&!row.approved_at?
              <ConfirmTransaction title="Approve attendance evidence?" description="Verify the employee, shift, day classification, supported leave and any overtime amount. You cannot approve a record you entered yourself." confirmLabel="Approve attendance" disabled={busy} busy={busy} className="hr-btn" onConfirm={()=>approve(row)}>Approve</ConfirmTransaction>:'—'}</td>
          </tr>)}
          {!rows.length&&<tr><td colSpan={7} className="hr-empty">No attendance recorded for {dateLabel(day)}. Enter all paid and unpaid days for employees before payroll.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>}
  </HRPage>
}

export function HRShiftsWorkspace(){
  const app=useApp()
  const {data,loading,error,reload}=useHRData(['hr-shifts','branches'])
  const {busy,error:mutationError,message,run}=useHRAction(reload)
  const [branch,setBranch]=useState(app.user.branchId),[name,setName]=useState(''),[starts,setStarts]=useState('08:00'),[ends,setEnds]=useState('17:00'),[breakMins,setBreakMins]=useState('60')
  const shifts=data['hr-shifts']||[]
  const create=async()=>{
    if(!branch||!name.trim()||!starts||!ends||Number(breakMins)<0||!Number.isInteger(Number(breakMins))){
      app.showWorkflowAlert('Shift incomplete','Provide a property, name, valid start/end and break minutes.','warning');return
    }
    const ok=await run(()=>createBackendRecord('hr-shifts',{
      branch,name:name.trim(),starts_at:starts,ends_at:ends,unpaid_break_minutes:Number(breakMins),is_active:true,
    }),'Shift template saved')
    if(ok)setName('')
  }
  return <HRPage eyebrow="Human resources / Time & attendance" title="Shift templates"
    description="Define property-specific hotel shifts, including shifts crossing midnight. Historical shifts used in approved records cannot be edited."
    right={<button className="hr-btn" type="button" onClick={()=>void reload()}>Refresh</button>}>
    <HRAlerts loading={loading} error={error||mutationError} message={message} retry={()=>void reload()}/>
    {!loading&&!error&&<>
      <section className="hr-panel"><header><h2>New shift</h2><span>24-hour local property time</span></header>
        <div className="hr-inline-form">
          <label>Property<select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Select property</option>{(data.branches||[]).map(b=><option key={text(b.id)} value={text(b.id)}>{text(b.name)}</option>)}</select></label>
          <label>Shift name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Morning / Night shift"/></label>
          <label>Start time<input type="time" value={starts} onChange={e=>setStarts(e.target.value)}/></label>
          <label>End time<input type="time" value={ends} onChange={e=>setEnds(e.target.value)}/></label>
          <label>Unpaid break (minutes)<input type="number" min="0" step="1" value={breakMins} onChange={e=>setBreakMins(e.target.value)}/></label>
          <button className="hr-btn primary" type="button" disabled={busy} onClick={()=>void create()}>Create shift</button>
        </div>
      </section>
      <section className="hr-panel"><header><h2>Shift register</h2><span>{shifts.length} templates</span></header>
        <div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>Property</th><th>Shift</th><th>Start</th><th>End</th><th>Unpaid break</th><th>Status</th></tr></thead>
          <tbody>{shifts.map(s=><tr key={text(s.id)}><td>{text(s.branch_name)}</td><td><strong>{text(s.name)}</strong></td><td>{text(s.starts_at).slice(0,5)}</td><td>{text(s.ends_at).slice(0,5)}</td><td>{text(s.unpaid_break_minutes)} minutes</td><td><HRStatus value={s.is_active?'active':'inactive'}/></td></tr>)}
            {!shifts.length&&<tr><td colSpan={6} className="hr-empty">No shifts yet. Create a property shift above.</td></tr>}
          </tbody></table></div>
      </section>
    </>}
  </HRPage>
}
