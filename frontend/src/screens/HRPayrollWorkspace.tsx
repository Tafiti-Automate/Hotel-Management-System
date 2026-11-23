import { useMemo, useState } from 'react'
import ConfirmTransaction from '../components/ConfirmTransaction'
import { useApp } from '../state/AppContext'
import { createBackendRecord, getToken, runBackendAction, updateBackendRecord } from '../lib/api'
import { currency, dateLabel, HRAlerts, HREmployeeOptions, HRMetric, HRPage, HRStatus,
  month, number, text, today, useHRAction, useHRData, year, type HRRow } from './HRWorkspaceKit'

const earnCategories = [
  ['basic_increment','Basic increment'], ['merit_increment','Merit increment'],
  ['arrears','Arrears'], ['leave_transport','Leave transport'],
  ['baggage_allowance','Baggage allowance'], ['service_charge','Service charge / breakages'],
  ['housing_allowance','Housing allowance'], ['other_earning','Other earning'],
]
const deductionCategories = [['union_dues','Union dues'],['staff_debtor','Staff debtor'],['other_deduction','Other deduction']]
const isHR = (role: string): boolean => ['hr manager','payroll officer'].includes(role.toLowerCase())
const isFinance = (role: string): boolean => ['financial manager','financial controller'].includes(role.toLowerCase())

function PayrollPayslip({ entry, period, onClose }: { entry: HRRow; period: HRRow; onClose: () => void }) {
  const rows: [string,string][] = [
    ['Basic pay',currency(entry.eligible_basic_pay)],['Arrears',currency(entry.arrears)],
    ['Leave transport',currency(entry.leave_transport)],['Baggage allowance',currency(entry.baggage_allowance)],
    ['Service charge',currency(entry.service_charge)],['Housing allowance',currency(entry.housing_allowance)],
    ['Other earnings',currency(entry.other_earnings)],
  ]
  const deductions: [string,string][] = [
    ['NSSF (employee)',currency(entry.nssf_employee)],['PAYE',currency(entry.paye)],
    ['Local service tax',currency(entry.local_service_tax)],['Union dues',currency(entry.union_dues)],
    ['Staff debtors',currency(entry.staff_debtors)],['Salary advance',currency(entry.salary_advance)],
    ['Other deductions',currency(entry.other_deductions)],
  ]
  return <div className="hr-overlay" role="presentation" onMouseDown={e => { if(e.currentTarget===e.target) onClose() }}>
    <section className="hr-payslip-modal" role="dialog" aria-modal="true" aria-label="Employee payslip">
      <div className="hr-payslip-actions"><strong>Posted payslip</strong><button type="button" onClick={() => window.print()}>Print / Save PDF</button><button type="button" onClick={onClose}>Close</button></div>
      <div className="hr-payslip-print">
        <header><strong>HOTEL ERP · PAYSLIP</strong><span>Confidential employee copy</span></header>
        <h2>{text(entry.employee_name)}</h2>
        <p>Employee code: {text(entry.employee_code)} · Department: {text(entry.department_name)}</p>
        <p>Payroll period: {text(period.year)}-{text(period.month).padStart(2,'0')} · Property: {text(period.branch_name)}</p>
        <div className="hr-payslip-grid">
          <div><h3>Earnings (UGX)</h3>{rows.map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>
          <div><h3>Deductions (UGX)</h3>{deductions.map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>
        </div>
        <div className="hr-payslip-totals"><div><span>Gross pay</span><strong>UGX {currency(entry.gross_pay)}</strong></div><div><span>Total deductions</span><strong>UGX {currency(entry.total_deductions)}</strong></div><div className="hr-payslip-net"><span>Net pay</span><strong>UGX {currency(entry.net_pay)}</strong></div></div>
        <footer>Generated from a posted payroll snapshot. This statement is not a payment confirmation.</footer>
      </div>
    </section>
  </div>
}

export async function downloadPayrollCsv(id: string, kind: 'register.csv'|'bank-schedule.csv'): Promise<void> {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1').replace(/\/+$/,'')
  const token = getToken()
  if (!token) throw new Error('Your session has expired. Sign in again.')
  const response = await fetch(`${base}/payroll-periods/${encodeURIComponent(id)}/${kind}/`, {
    headers: { Accept:'text/csv', Authorization:`Token ${token}` },
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as Record<string,unknown>
    throw new Error(text(data.detail) || `Payroll export was rejected (${response.status}).`)
  }
  const blob = await response.blob()
  const filename = kind === 'register.csv' ? `payroll-register-${id}.csv` : `bank-schedule-${id}.csv`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href=url; anchor.download=filename; document.body.appendChild(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

export function PayrollWorkspace() {
  const app=useApp()
  const role=app.user.role.trim().toLowerCase()
  const hr=isHR(role), finance=isFinance(role)
  const { data, loading, error, reload }=useHRData(['payroll-periods','payroll-entries','payroll-profiles','employees','branches'])
  const { busy, error:mutationError, message, run }=useHRAction(reload)
  const periods=data['payroll-periods']||[], entries=data['payroll-entries']||[], profiles=data['payroll-profiles']||[]
  const employees=data.employees||[], branches=data.branches||[]
  const [selectedId,setSelectedId]=useState('')
  const [newBranch,setNewBranch]=useState(app.user.branchId)
  const [newYear,setNewYear]=useState(year())
  const [newMonth,setNewMonth]=useState(month())
  const [profileEmployee,setProfileEmployee]=useState('')
  const [basic,setBasic]=useState('')
  const [nssf,setNssf]=useState(true)
  const [resident,setResident]=useState(true)
  const [tin,setTin]=useState('')
  const [nssfNumber,setNssfNumber]=useState('')
  const [bankName,setBankName]=useState('')
  const [accountName,setAccountName]=useState('')
  const [accountNumber,setAccountNumber]=useState('')
  const [selectedPayslip,setSelectedPayslip]=useState<HRRow|null>(null)
  const [filter,setFilter]=useState('')
  const period=periods.find(p=>text(p.id)===selectedId)||periods[0]
  const currentId=text(period?.id)
  const periodEntries=entries.filter(e=>text(e.period)===currentId && [e.employee_name,e.employee_code,e.department_name].some(v=>text(v).toLowerCase().includes(filter.toLowerCase())))
  const currentProfile=profiles.find(p=>text(p.employee)===profileEmployee)
  const gross=periodEntries.reduce((total,e)=>total+number(e.gross_pay),0)
  const net=periodEntries.reduce((total,e)=>total+number(e.net_pay),0)
  const canCalculate=hr && ['draft','calculated'].includes(text(period?.status))
  const canSubmit=hr && text(period?.status)==='calculated'
  const canApprove=finance && text(period?.status)==='submitted'
  const canPost=finance && text(period?.status)==='approved'
  const openPeriod=async()=>{const result=await run(async()=> {
    if (!newBranch||!Number.isInteger(newYear)||newYear<2000||newYear>2100||newMonth<1||newMonth>12) throw new Error('Select a valid property, year and month.')
    await createBackendRecord('payroll-periods',{branch:newBranch,year:newYear,month:newMonth})
  },'Draft payroll period opened');return result}
  const saveProfile=async()=>{
    const amount=Number(basic)
    if (!profileEmployee||!Number.isFinite(amount)||amount<0) {app.showWorkflowAlert('Payroll profile incomplete','Select an employee and enter a valid non-negative monthly basic salary.','warning');return}
    const payload={
      employee:profileEmployee,basic_salary:basic,tax_resident:resident,nssf_applicable:nssf,
      tin_number:tin,nssf_number:nssfNumber,bank_name:bankName,
      bank_account_name:accountName,bank_account_number:accountNumber,
    }
    await run(()=> currentProfile
      ? updateBackendRecord('payroll-profiles',text(currentProfile.id),payload)
      : createBackendRecord('payroll-profiles',payload),'Payroll profile saved')
  }
  const doExport=async(kind:'register.csv'|'bank-schedule.csv')=> {
    if(!period) return
    await run(()=>downloadPayrollCsv(currentId,kind),'Payroll CSV downloaded')
  }
  const profileSelected=(id:string)=> {
    setProfileEmployee(id)
    const p=profiles.find(v=>text(v.employee)===id)
    setBasic(text(p?.basic_salary));setNssf(p?.nssf_applicable!==false);setResident(p?.tax_resident!==false)
    setTin(text(p?.tin_number));setNssfNumber(text(p?.nssf_number))
    setBankName(text(p?.bank_name));setAccountName(text(p?.bank_account_name));setAccountNumber(text(p?.bank_account_number))
  }
  return <HRPage eyebrow="Human resources / Payroll" title="Payroll management"
    description="Kalibu-style employee register, monthly calculations, independent Finance approval and posted payslips."
    right={<button type="button" className="hr-btn" onClick={()=>void reload()} disabled={busy||loading}>Refresh payroll</button>}>
    <HRAlerts loading={loading} error={error||mutationError} message={message} retry={()=>void reload()}/>
    {!loading&&!error&&<>
      <section className="hr-metrics">
        <HRMetric label="Payroll periods" value={String(periods.length)} help="By authorized properties"/>
        <HRMetric label="Salary profiles" value={String(profiles.length)} help="Active and inactive profiles"/>
        <HRMetric label="Selected gross payroll" value={`UGX ${currency(gross)}`} help="Employees shown below"/>
        <HRMetric label="Selected net payroll" value={`UGX ${currency(net)}`} help="Employees shown below"/>
      </section>
      <div className="hr-columns">
        <section className="hr-panel">
          <header><h2>Payroll periods</h2><span>{periods.length} records</span></header>
          {hr&&<div className="hr-inline-form">
            <label>Property<select value={newBranch} onChange={e=>setNewBranch(e.target.value)}><option value="">Select property</option>{branches.map(b=><option key={text(b.id)} value={text(b.id)}>{text(b.name)}</option>)}</select></label>
            <label>Year<input aria-label="Payroll year" type="number" min="2000" max="2100" value={newYear} onChange={e=>setNewYear(Number(e.target.value))}/></label>
            <label>Month<select value={newMonth} onChange={e=>setNewMonth(Number(e.target.value))}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{new Date(2026,i,1).toLocaleString('en-GB',{month:'long'})}</option>)}</select></label>
            <button type="button" className="hr-btn primary" disabled={busy||!newBranch} onClick={()=>void openPeriod()}>Open period</button>
          </div>}
          <div className="hr-scroll-list">{periods.map(p=><button type="button" className={`hr-period-row ${currentId===text(p.id)?'is-selected':''}`} key={text(p.id)} onClick={()=>setSelectedId(text(p.id))}>
            <strong>{text(p.branch_name)} · {text(p.year)}-{text(p.month).padStart(2,'0')}</strong>
            <span><HRStatus value={p.status}/><small>{text(p.employee_count)} employees</small></span>
          </button>)}
          {!periods.length&&<p className="hr-empty">No payroll period yet. Human Resources can open the first period above.</p>}</div>
        </section>
        <section className="hr-panel">
          <header><h2>Selected payroll</h2>{period&&<HRStatus value={period.status}/>}</header>
          {period?<div className="hr-summary">
            <h3>{text(period.branch_name)} · {text(period.year)}-{text(period.month).padStart(2,'0')}</h3>
            <dl><div><dt>Employees</dt><dd>{text(period.employee_count)}</dd></div>
              <div><dt>Gross</dt><dd>UGX {currency(period.gross_total)}</dd></div>
              <div><dt>Deductions</dt><dd>UGX {currency(period.deduction_total)}</dd></div>
              <div><dt>Net pay</dt><dd>UGX {currency(period.net_total)}</dd></div>
              <div><dt>Employer NSSF</dt><dd>UGX {currency(period.employer_nssf_total)}</dd></div>
              <div><dt>Rule version</dt><dd>{text(period.statutory_rule_version)}</dd></div></dl>
            <p className="hr-muted">Calculated amounts must be reconciled with approved timesheets, tax guidance and employee profiles before posting.</p>
            <div className="hr-actions">
              {canCalculate&&<ConfirmTransaction title="Recalculate this payroll?" description="This updates unposted employee snapshots. Verify salary profiles, approved affectors, advances and days worked first." confirmLabel="Calculate payroll" disabled={busy} busy={busy} className="hr-btn primary" onConfirm={()=>run(()=>runBackendAction('payroll-periods',currentId,'calculate'),'Payroll calculated')}>Calculate</ConfirmTransaction>}
              {canSubmit&&<ConfirmTransaction title="Submit payroll to Finance?" description="Calculated payroll will be locked for HR editing pending Finance approval." confirmLabel="Submit to Finance" disabled={busy} busy={busy} className="hr-btn primary" onConfirm={()=>run(()=>runBackendAction('payroll-periods',currentId,'submit'),'Submitted to Finance')}>Submit to Finance</ConfirmTransaction>}
              {canApprove&&<ConfirmTransaction title="Approve this payroll?" description="Approve only after independently verifying statutory deductions, attendance, affectors and the full payroll register." confirmLabel="Approve payroll" disabled={busy} busy={busy} className="hr-btn primary" onConfirm={()=>run(()=>runBackendAction('payroll-periods',currentId,'approve'),'Payroll approved')}>Finance approve</ConfirmTransaction>}
              {canPost&&<ConfirmTransaction title="Post approved payroll?" description="This finalizes the period and applies salary advance repayments. The posting is irreversible." confirmLabel="Post payroll" disabled={busy} busy={busy} className="hr-btn primary" onConfirm={()=>run(()=>runBackendAction('payroll-periods',currentId,'post'),'Payroll posted')}>Post payroll</ConfirmTransaction>}
              {text(period.status)!=='draft'&&<button type="button" className="hr-btn" disabled={busy} onClick={()=>void doExport('register.csv')}>Export register CSV</button>}
              {finance&&text(period.status)==='posted'&&<button type="button" className="hr-btn" disabled={busy} onClick={()=>void doExport('bank-schedule.csv')}>Bank schedule CSV</button>}
            </div>
          </div>:<p className="hr-empty">Select or open a payroll period.</p>}
        </section>
      </div>
      <section className="hr-panel">
        <header><h2>Employee payroll register</h2><label className="hr-search">Find employee<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Name, code or department"/></label></header>
        <div className="hr-table-scroll"><table className="hr-table">
          <thead><tr><th>Employee</th><th>Department</th><th>Days worked</th><th className="num">Gross (UGX)</th><th className="num">Deductions</th><th className="num">Net (UGX)</th><th>Document</th></tr></thead>
          <tbody>{periodEntries.map(e=><tr key={text(e.id)}><td><strong>{text(e.employee_name)}</strong><small>{text(e.employee_code)}</small></td><td>{text(e.department_name)}</td><td>{text(e.days_worked)} / {text(e.days_in_month)}</td><td className="num">{currency(e.gross_pay)}</td><td className="num">{currency(e.total_deductions)}</td><td className="num"><strong>{currency(e.net_pay)}</strong></td><td>{text(period?.status)==='posted'?<button type="button" className="hr-link" onClick={()=>setSelectedPayslip(e)}>Payslip</button>:<span className="hr-muted">Pending posting</span>}</td></tr>)}
            {!periodEntries.length&&<tr><td colSpan={7} className="hr-empty">No calculated employee lines for this period.</td></tr>}
          </tbody>
        </table></div>
      </section>
      {hr&&<section className="hr-panel">
        <header><h2>Employee salary profiles</h2><span>HR-only master data</span></header>
        <div className="hr-inline-form">
          <label>Employee<select value={profileEmployee} onChange={e=>profileSelected(e.target.value)}><HREmployeeOptions employees={employees}/></select></label>
          <label>Monthly basic salary (UGX)<input inputMode="decimal" type="number" min="0" step="0.01" value={basic} onChange={e=>setBasic(e.target.value)}/></label>
          <label>TIN<input value={tin} onChange={e=>setTin(e.target.value)} /></label>
          <label>NSSF number<input value={nssfNumber} onChange={e=>setNssfNumber(e.target.value)} /></label>
          <label>Bank name<input value={bankName} onChange={e=>setBankName(e.target.value)} /></label>
          <label>Bank account name<input value={accountName} onChange={e=>setAccountName(e.target.value)} /></label>
          <label>Bank account number<input autoComplete="off" value={accountNumber} onChange={e=>setAccountNumber(e.target.value)}/></label>
          <label className="hr-check"><input type="checkbox" checked={nssf} onChange={e=>setNssf(e.target.checked)}/> NSSF applicable</label>
          <label className="hr-check"><input type="checkbox" checked={resident} onChange={e=>setResident(e.target.checked)}/> Tax resident</label>
          <button className="hr-btn primary" type="button" disabled={busy||!profileEmployee||basic===''} onClick={()=>void saveProfile()}>{currentProfile?'Update profile':'Save profile'}</button>
        </div>
        <p className="hr-muted">Bank details are confidential. Existing account numbers are not listed in the payroll register.</p>
      </section>}
    </>}
    {selectedPayslip&&period&&<PayrollPayslip entry={selectedPayslip} period={period} onClose={()=>setSelectedPayslip(null)}/>}
  </HRPage>
}

export function PayrollAffectorWorkspace() {
  const app=useApp()
  const {data,loading,error,reload}=useHRData(['payroll-affectors','employees','departments','branches'])
  const {busy,error:mutationError,message,run}=useHRAction(reload)
  const [branch,setBranch]=useState(app.user.branchId)
  const [targetType,setTargetType]=useState<'employee'|'department'>('employee')
  const [employee,setEmployee]=useState('')
  const [department,setDepartment]=useState('')
  const [name,setName]=useState('')
  const [category,setCategory]=useState('service_charge')
  const [method,setMethod]=useState('fixed')
  const [amount,setAmount]=useState('')
  const [effective,setEffective]=useState(today())
  const [endDate,setEndDate]=useState('')
  const [recurring,setRecurring]=useState(false)
  const [taxable,setTaxable]=useState(true)
  const affectors=data['payroll-affectors']||[]
  const earnings=new Set(earnCategories.map(([key])=>key))
  const create=async()=>{
    const amountValue=Number(amount)
    if(!branch||!name.trim()||!effective||(targetType==='employee'&&!employee)||(targetType==='department'&&!department)||!Number.isFinite(amountValue)||amountValue<=0) {
      app.showWorkflowAlert('Affector incomplete','Choose the target, name, effective date and a positive amount.','warning');return
    }
    const saved=await run(()=>createBackendRecord('payroll-affectors',{
      branch,employee:targetType==='employee'?employee:null,
      department:targetType==='department'?department:null,
      name:name.trim(),category,affector_type:earnings.has(category)?'earning':'deduction',
      calculation_method:method,amount,effective_from:effective,effective_to:endDate||null,
      recurring,taxable,is_active:true,
    }),'Payroll affector submitted for HR approval')
    if(saved){setName('');setAmount('');setEmployee('');setDepartment('')}
  }
  const canApprove=app.user.role.toLowerCase()==='hr manager'
  return <HRPage eyebrow="Human resources / Payroll" title="Payroll affectors" description="Prepare and independently approve earnings, deductions and department-wide payroll adjustments.">
    <HRAlerts loading={loading} error={error||mutationError} message={message} retry={()=>void reload()}/>
    {!loading&&!error&&<>
      <section className="hr-panel"><header><h2>New payroll affector</h2><span>One employee or one department</span></header>
        <div className="hr-inline-form">
          <label>Property<select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Choose property</option>{(data.branches||[]).map(b=><option key={text(b.id)} value={text(b.id)}>{text(b.name)}</option>)}</select></label>
          <label>Target<select value={targetType} onChange={e=>{setTargetType(e.target.value as 'employee'|'department');setEmployee('');setDepartment('')}}><option value="employee">Individual employee</option><option value="department">Whole department</option></select></label>
          {targetType==='employee'?<label>Employee<select value={employee} onChange={e=>setEmployee(e.target.value)}><HREmployeeOptions employees={(data.employees||[]).filter(e=>text(e.branch)===branch)}/></select></label>
          :<label>Department<select value={department} onChange={e=>setDepartment(e.target.value)}><option value="">Select department</option>{(data.departments||[]).map(d=><option key={text(d.id)} value={text(d.id)}>{text(d.name)}</option>)}</select></label>}
          <label>Affector name<input value={name} onChange={e=>setName(e.target.value)}/></label>
          <label>Category<select value={category} onChange={e=>setCategory(e.target.value)}><optgroup label="Earnings">{earnCategories.map(([k,v])=><option key={k} value={k}>{v}</option>)}</optgroup><optgroup label="Deductions">{deductionCategories.map(([k,v])=><option key={k} value={k}>{v}</option>)}</optgroup></select></label>
          <label>Calculation<select value={method} onChange={e=>setMethod(e.target.value)}><option value="fixed">Fixed UGX</option><option value="percent_basic">Percent of basic pay</option></select></label>
          <label>{method==='fixed'?'Amount (UGX)':'Percentage (%)'}<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
          <label>Effective from<input type="date" value={effective} onChange={e=>setEffective(e.target.value)}/></label>
          <label>Effective to (optional)<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
          <label className="hr-check"><input type="checkbox" checked={recurring} onChange={e=>setRecurring(e.target.checked)}/> Recurring</label>
          <label className="hr-check"><input type="checkbox" checked={taxable} onChange={e=>setTaxable(e.target.checked)}/> Taxable earning</label>
          <button className="hr-btn primary" type="button" disabled={busy} onClick={()=>void create()}>Add affector</button>
        </div>
      </section>
      <section className="hr-panel"><header><h2>Affector approval register</h2><span>{affectors.length} records</span></header>
        <div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>Name / target</th><th>Category</th><th>Effective</th><th>Calculation</th><th className="num">Amount</th><th>Status</th><th>Approval</th></tr></thead>
          <tbody>{affectors.map(a=><tr key={text(a.id)}><td><strong>{text(a.name)}</strong><small>{text(a.employee_name||a.department_name)}</small></td><td>{text(a.category_label||a.category)}</td><td>{dateLabel(a.effective_from)}{a.effective_to?` – ${dateLabel(a.effective_to)}`:''}</td><td>{text(a.calculation_method)==='percent_basic'?'% of basic':'Fixed'}</td><td className="num">{currency(a.amount)}</td><td>{a.approved_at?<HRStatus value="approved"/>:<HRStatus value="pending"/>}</td><td>{!a.approved_at&&canApprove?<ConfirmTransaction className="hr-btn" title="Approve this payroll adjustment?" description="Verify the category, employee, amount, and effective date. You cannot approve an affector you created yourself." confirmLabel="Approve affector" disabled={busy} busy={busy} onConfirm={()=>run(()=>runBackendAction('payroll-affectors',text(a.id),'approve'),'Affector approved')}>Approve</ConfirmTransaction>:'—'}</td></tr>)}
            {!affectors.length&&<tr><td colSpan={7} className="hr-empty">No payroll affectors recorded.</td></tr>}</tbody></table></div>
      </section>
    </>}
  </HRPage>
}

export function SalaryAdvanceWorkspace() {
  const app=useApp()
  const role=app.user.role.trim().toLowerCase(),hr=isHR(role),finance=isFinance(role)
  const {data,loading,error,reload}=useHRData(['salary-advances','employees'])
  const {busy,error:mutationError,message,run}=useHRAction(reload)
  const [employee,setEmployee]=useState(''),[principal,setPrincipal]=useState(''),[installment,setInstallment]=useState(''),[reason,setReason]=useState('')
  const advances=data['salary-advances']||[]
  const total=useMemo(()=>advances.filter(a=>text(a.status)==='approved').reduce((sum,a)=>sum+number(a.balance),0),[advances])
  const create=async()=>{
    if(!employee||Number(principal)<=0||Number(installment)<=0||Number(installment)>Number(principal)||!reason.trim()) {app.showWorkflowAlert('Advance incomplete','Select the employee, enter a valid amount and instalment, and provide a reason.','warning');return}
    const ok=await run(()=>createBackendRecord('salary-advances',{employee,principal_amount:principal,monthly_installment:installment,request_date:today(),reason:reason.trim()}),'Salary advance recorded for approval')
    if(ok){setPrincipal('');setInstallment('');setReason('')}
  }
  return <HRPage eyebrow="Human resources / Payroll" title="Salary advances" description="Record, approve and track employee salary advances and repayments.">
    <HRAlerts loading={loading} error={error||mutationError} message={message} retry={()=>void reload()}/>
    {!loading&&!error&&<>
      <section className="hr-metrics"><HRMetric label="Outstanding approved advances" value={`UGX ${currency(total)}`}/><HRMetric label="Advance records" value={String(advances.length)}/></section>
      {hr&&<section className="hr-panel"><header><h2>New salary advance</h2></header><div className="hr-inline-form">
        <label>Employee<select value={employee} onChange={e=>setEmployee(e.target.value)}><HREmployeeOptions employees={data.employees||[]}/></select></label>
        <label>Principal (UGX)<input type="number" min="1" step="0.01" value={principal} onChange={e=>setPrincipal(e.target.value)}/></label>
        <label>Monthly instalment (UGX)<input type="number" min="1" step="0.01" value={installment} onChange={e=>setInstallment(e.target.value)}/></label>
        <label>Reason<input value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <button className="hr-btn primary" type="button" disabled={busy} onClick={()=>void create()}>Save advance draft</button>
      </div></section>}
      <section className="hr-panel"><header><h2>Salary advances register</h2><span>{advances.length} records</span></header>
        <div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>Employee</th><th>Request date</th><th className="num">Principal</th><th className="num">Balance</th><th className="num">Instalment</th><th>Status</th><th>Finance decision</th></tr></thead><tbody>
        {advances.map(a=><tr key={text(a.id)}><td>{text(a.employee_name)}</td><td>{dateLabel(a.request_date)}</td><td className="num">{currency(a.principal_amount)}</td><td className="num">{currency(a.balance)}</td><td className="num">{currency(a.monthly_installment)}</td><td><HRStatus value={a.status}/></td><td>{finance&&text(a.status)==='draft'?<ConfirmTransaction title="Approve salary advance?" description="Verify the employee's outstanding advances and monthly repayment capacity." confirmLabel="Approve advance" disabled={busy} busy={busy} className="hr-btn" onConfirm={()=>run(()=>runBackendAction('salary-advances',text(a.id),'approve'),'Salary advance approved')}>Approve</ConfirmTransaction>:'—'}</td></tr>)}
        {!advances.length&&<tr><td colSpan={7} className="hr-empty">No salary advances yet.</td></tr>}</tbody></table></div>
      </section>
    </>}
  </HRPage>
}
