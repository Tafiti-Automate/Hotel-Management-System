import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { canAccessRoute } from '../../lib/access.ts'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root),'utf8')
const sidebar = read('components/Sidebar.tsx')
const shell = read('screens/AppShell.tsx')
const payroll = read('screens/HRPayrollWorkspace.tsx')
const leave = read('screens/HRLeaveWorkspace.tsx')
const views = read('../../hotel_erp_backend/apps/employees/payroll_views.py')

test('Kalibu-style HR navigation has the five management sections', () => {
  for (const route of ['hr-payroll','hr-affectors','hr-advances','hr-leave','hr-calendar','hr-documents']) {
    assert.ok(sidebar.includes(`route: '${route}'`),route)
    assert.ok(shell.includes(`route === '${route}'`),route)
  }
  assert.match(sidebar,/Employee management/)
  assert.match(sidebar,/Payroll management/)
  assert.match(sidebar,/Leave management/)
  assert.match(sidebar,/Leave calendar/)
  assert.match(sidebar,/Documents/)
})

test('HR routes are isolated from operational and unauthorized roles', () => {
  const role = name => ({role:name, isSuperuser:false, permissions:['employees.view_employee','employees.view_payrollperiod']})
  assert.equal(canAccessRoute(role('HR Manager'),'hr-payroll'),true)
  assert.equal(canAccessRoute(role('Payroll Officer'),'hr-affectors'),true)
  assert.equal(canAccessRoute(role('HR Manager'),'hr-leave'),true)
  assert.equal(canAccessRoute(role('Financial Manager'),'hr-payroll'),true)
  assert.equal(canAccessRoute(role('Financial Manager'),'hr-affectors'),false)
  assert.equal(canAccessRoute(role('Financial Manager'),'hr-documents'),false)
  assert.equal(canAccessRoute(role('Store Keeper'),'hr-payroll'),false)
  assert.equal(canAccessRoute(role('Receiving Clerk'),'hr-leave'),false)
  assert.equal(canAccessRoute(role('Cost Controller'),'hr-documents'),false)
})

test('payroll has independent approval and posted payslip conditions', () => {
  assert.match(payroll,/Finance approve/)
  assert.match(payroll,/Submit to Finance/)
  assert.match(payroll,/Post payroll/)
  assert.match(payroll,/text\(period\?\.status\)==='posted'/)
  assert.match(payroll,/PayrollPayslip/)
  assert.match(payroll,/bank-schedule.csv/)
  assert.match(views,/Only posted payroll can be exported to the bank/)
  assert.match(views,/Only Finance can export salary payment schedules/)
  assert.match(views,/created_by_id == request.user.pk/)
})

test('leave and files are connected to actual Django APIs', () => {
  assert.match(leave,/createBackendRecord\('leave-requests'/)
  assert.match(leave,/runBackendAction\('leave-requests'/)
  assert.match(leave,/status\)==='approved'/)
  assert.match(leave,/employee-documents\//)
  assert.match(leave,/getToken\(\)/)
  assert.match(views,/FileResponse\(/)
})

test('shift and daily attendance routes are HR-only and connected to Django', () => {
  const attendance = read('screens/HRAttendanceWorkspace.tsx')
  const services = read('../../hotel_erp_backend/apps/employees/payroll_services.py')
  const routeMap = read('lib/navigation.ts')
  const role = name => ({role:name,isSuperuser:false,permissions:['employees.view_employee','employees.view_attendancerecord']})
  for (const route of ['hr-shifts','hr-attendance']) {
    assert.ok(sidebar.includes(`route: '${route}'`))
    assert.ok(shell.includes(`route === '${route}'`))
    assert.ok(routeMap.includes(`'${route}'`))
    assert.equal(canAccessRoute(role('HR Manager'),route),true)
    assert.equal(canAccessRoute(role('Payroll Officer'),route),true)
    assert.equal(canAccessRoute(role('Financial Manager'),route),false)
    assert.equal(canAccessRoute(role('Store Keeper'),route),false)
  }
  assert.match(attendance,/createBackendRecord\('attendance-records'/)
  assert.match(attendance,/runBackendAction\('attendance-records'/)
  assert.match(attendance,/createBackendRecord\('hr-shifts'/)
  assert.match(services,/Approved attendance is incomplete/)
  assert.match(services,/overtime_pay/)
  assert.match(payroll,/Attendance readiness/)
  assert.match(payroll,/coverage\?\.ready===true/)
  assert.match(payroll,/Overtime \(UGX\)/)
})

test('payroll PAYE uses LST-deducted income and documented statutory version', () => {
  const services = read('../../hotel_erp_backend/apps/employees/payroll_services.py')
  assert.match(services,/gross - local_service_tax/)
  assert.match(services,/PAYE_RULE_VERSION = "UG-FY2026-27"/)
  assert.match(services,/NSSF_EMPLOYEE_RATE = Decimal\("0\.05"\)/)
  assert.match(services,/NSSF_EMPLOYER_RATE = Decimal\("0\.10"\)/)
})
