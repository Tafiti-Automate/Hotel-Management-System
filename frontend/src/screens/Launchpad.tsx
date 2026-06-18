import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'

interface ModuleDef {
  title: string
  desc: string
  icon: string
}

const comingSoon: ModuleDef[] = [
  { title: 'Human Resources', desc: 'Employees, departments, payroll & attendance.', icon: 'groups' },
  { title: 'Finance & Accounting', desc: 'Ledgers, invoices, budgets & financial reports.', icon: 'payments' },
  { title: 'Front Office', desc: 'Reservations, check-in / out & guest profiles.', icon: 'concierge' },
  { title: 'Restaurant & POS', desc: 'Menus, orders, billing & table management.', icon: 'restaurant' },
  { title: 'Maintenance', desc: 'Work orders, assets & preventive schedules.', icon: 'build' },
]

export default function Launchpad() {
  const { user, enterApp, logout } = useApp()
  const initials = user.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(1100px 520px at 80% -10%,var(--accent-soft),transparent 60%),var(--bg)' }}>
      <header style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 30px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,var(--accent),var(--accent-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="hotel" size={20} color="#fff" fill />
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Hotel Management Software</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 6px 5px 12px', border: '1px solid var(--border)', borderRadius: 30, background: 'var(--surface)' }}>
            <div style={{ lineHeight: 1.2, textAlign: 'right' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{user.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600 }}>{user.role}</div>
            </div>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: 'var(--accent)' }}>{initials}</div>
          </div>
          <button onClick={logout} title="Sign out" style={{ width: 38, height: 38, border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="logout" size={19} />
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 30px' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Welcome back, {user.name.split(' ')[0]}</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.025em' }}>Choose a module</h1>
          <p style={{ margin: '7px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>Select the area of the hotel you want to manage. More modules are rolling out soon.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(252px,1fr))', gap: 18 }}>
          <button onClick={enterApp} className="hover-lift" style={{ position: 'relative', textAlign: 'left', cursor: 'pointer', background: 'var(--surface)', border: '1.5px solid var(--accent)', borderRadius: 18, padding: 22, boxShadow: 'var(--shadow)', transition: 'transform .15s ease,box-shadow .15s ease' }}>
            <span style={{ position: 'absolute', top: 16, right: 16, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: 'var(--good)', background: 'var(--good-soft)', padding: '3px 9px', borderRadius: 20 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--good)' }} />Active
            </span>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 34 }}>
              <Icon name="inventory_2" size={25} color="var(--accent)" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em' }}>Stock Management</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>Inventory, procurement, requisitions, suppliers &amp; reports.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Open module<Icon name="arrow_forward" size={18} /></div>
          </button>

          {comingSoon.map((m) => (
            <div key={m.title} style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: 22, opacity: 0.72 }}>
              <span style={{ position: 'absolute', top: 16, right: 16, fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '3px 9px', borderRadius: 20 }}>SOON</span>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 34 }}>
                <Icon name={m.icon} size={25} color="var(--text-faint)" />
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{m.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>{m.desc}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
