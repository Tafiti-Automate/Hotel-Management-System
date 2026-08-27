import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'

export default function HRDashboard() {
  const app = useApp()
  const employees = app.data.employees
  const departments = app.data.departments
  const active = employees.filter((employee) => employee.status === 'Active').length
  const inactive = employees.length - active
  const datedEmployees = employees
    .filter((employee) => employee.dateJoined)
    .sort((a, b) => String(b.dateJoined).localeCompare(String(a.dateJoined)))
    .slice(0, 6)

  const cards = [
    { label: 'Total employees', value: employees.length, icon: 'groups', tone: 'var(--accent)', bg: 'var(--accent-soft)' },
    { label: 'Active employees', value: active, icon: 'verified_user', tone: 'var(--good)', bg: 'var(--good-soft)' },
    { label: 'Departments', value: departments.length, icon: 'account_tree', tone: '#0e7490', bg: '#ecfeff' },
    { label: 'Inactive profiles', value: inactive, icon: 'person_off', tone: 'var(--text-muted)', bg: 'var(--surface-2)' },
  ]

  return (
    <div className="hr-dashboard" style={{ maxWidth: 1380, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, letterSpacing: '.02em' }}>Human resources</div>
          <h1 style={{ fontSize: 25, margin: '5px 0', color: 'var(--text)', letterSpacing: '-.025em' }}>People & departments</h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>Employee records, departments and workforce status.</p>
        </div>
        <button onClick={() => app.openCreate('employees', 'Employees')} className="hover-accent" style={{ height: 42, display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 11, padding: '0 16px', background: 'var(--accent)', color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 800 }}>
          <Icon name="person_add" size={19} color="#fff" />Register employee
        </button>
      </div>

      <div className="hr-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(160px,1fr))', gap: 14 }}>
        {cards.map((card) => (
          <div key={card.label} style={{ padding: 17, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 15, boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: card.bg }}><Icon name={card.icon} size={20} color={card.tone} /></div>
            <div style={{ fontSize: 25, fontWeight: 850, color: 'var(--text)', marginTop: 14 }}>{card.value}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{card.label}</div>
          </div>
        ))}
      </div>

      <div className="hr-main-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(280px,.7fr)', gap: 16, marginTop: 16 }}>
        <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 15, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 17px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div><div style={{ fontSize: 13, fontWeight: 850, color: 'var(--text)' }}>Employee directory</div><div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 2 }}>Recent employee records</div></div>
            <button onClick={() => app.navTo('employees', 'Employees')} style={{ border: 0, background: 'transparent', color: 'var(--accent)', cursor: 'pointer', font: 'inherit', fontSize: 11.5, fontWeight: 800 }}>View all</button>
          </div>
          {(datedEmployees.length ? datedEmployees : employees.slice(0, 6)).map((employee) => (
            <button key={employee.id} onClick={() => { app.navTo('employees', 'Employees'); app.openEdit(employee.id) }} className="hover-surface2" style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)', background: 'transparent', padding: '11px 17px', display: 'grid', gridTemplateColumns: '38px minmax(130px,1.5fr) minmax(110px,1fr) auto', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11.5, fontWeight: 850 }}>{String(employee.name).split(' ').map((part: string) => part[0]).join('').slice(0, 2)}</span>
              <span><span style={{ display: 'block', color: 'var(--text)', fontSize: 12.5, fontWeight: 800 }}>{employee.name}</span><span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 10.5, marginTop: 2 }}>{employee.employeeCode || 'Employee profile'}</span></span>
              <span><span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11.5 }}>{employee.department || 'Unassigned'}</span><span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>{employee.designation || 'No job title'}</span></span>
              <span style={{ color: employee.status === 'Active' ? 'var(--good)' : 'var(--text-faint)', background: employee.status === 'Active' ? 'var(--good-soft)' : 'var(--surface-2)', borderRadius: 20, padding: '4px 8px', fontSize: 10, fontWeight: 800 }}>{employee.status}</span>
            </button>
          ))}
          {!employees.length && <div style={{ borderTop: '1px solid var(--border)', padding: 34, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No employees registered yet.</div>}
        </section>

        <aside style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 15, boxShadow: 'var(--shadow-sm)', padding: 17 }}>
          <div style={{ fontSize: 13, fontWeight: 850, color: 'var(--text)' }}>Quick actions</div>
          {[
            ['person_add', 'Register employee', 'Add an employee record', () => app.openCreate('employees', 'Employees')],
            ['account_tree', 'Add department', 'Add a department', () => app.openCreate('departments', 'Departments')],
            ['badge', 'Employee directory', 'Browse employee records', () => app.navTo('employees', 'Employees')],
          ].map(([icon, title, description, action]) => (
            <button key={String(title)} onClick={action as () => void} className="hover-surface2" style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', border: 0, background: 'transparent', borderRadius: 10, padding: '11px 8px', marginTop: 5, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)' }}><Icon name={String(icon)} size={18} color="var(--accent)" /></span>
              <span><span style={{ display: 'block', color: 'var(--text)', fontSize: 11.5, fontWeight: 800 }}>{String(title)}</span><span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 10.5, marginTop: 2 }}>{String(description)}</span></span>
            </button>
          ))}
        </aside>
      </div>
    </div>
  )
}
