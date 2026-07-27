import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import { canAccessModule } from '../lib/access'

const upcoming = [
  { title: 'Finance & Accounting', desc: 'Supplier invoices, payments, budgets and financial reporting.', icon: 'account_balance' },
  { title: 'Front Office', desc: 'Reservations, arrivals, departures and guest profiles.', icon: 'concierge' },
  { title: 'Restaurant & POS', desc: 'Menus, orders, billing and table operations.', icon: 'restaurant' },
  { title: 'Maintenance', desc: 'Assets, work orders and preventive maintenance.', icon: 'build' },
]

export default function Launchpad() {
  const app = useApp()
  const modules = [
    { module: 'operations' as const, title: 'Hotel Operations', desc: 'Procurement, inventory, stores, suppliers and operational reports.', icon: 'inventory_2', action: app.enterApp },
    { module: 'hr' as const, title: 'Human Resources', desc: 'Employees, departments and workforce administration.', icon: 'groups', action: app.enterHR },
  ].filter((module) => canAccessModule(app.user, module.module))
  const initials = app.user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="launchpad" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{ height: 64, display: 'flex', alignItems: 'center', padding: '0 30px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--accent)' }}><Icon name="hotel" size={20} color="#fff" fill /></div>
        <div style={{ marginLeft: 11 }}><div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 700 }}>Hotel Management ERP</div><div style={{ color: 'var(--text-faint)', fontSize: 10.5, marginTop: 1 }}>Enterprise operations platform</div></div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: 7, display: 'grid', placeItems: 'center', color: '#1D4ED8', background: '#E8EEF9', fontSize: 11, fontWeight: 700 }}>{initials}</div>
          <div className="launchpad-user"><div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 600 }}>{app.user.name}</div><div style={{ color: 'var(--text-faint)', fontSize: 10.5, marginTop: 1 }}>{app.user.role}</div></div>
          <button onClick={app.logout} title="Sign out" style={{ width: 36, height: 36, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--text-muted)', marginLeft: 8 }}><Icon name="logout" size={18} /></button>
        </div>
      </header>

      <main style={{ width: 'min(1120px,calc(100% - 40px))', margin: '0 auto', padding: '56px 0 70px' }}>
        <div style={{ maxWidth: 650, marginBottom: 30 }}>
          <div style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>Welcome back, {app.user.name.split(' ')[0]}</div>
          <h1 style={{ color: 'var(--text)', fontSize: 30, fontWeight: 700, letterSpacing: '-.035em', margin: '7px 0 8px' }}>Select your workspace</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55, margin: 0 }}>Open a business area to continue. Your access and available actions depend on your assigned role.</p>
        </div>

        <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>Available now</div>
        <div className="launchpad-active-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(260px,1fr))', gap: 14 }}>
          {modules.map((module) => (
            <button key={module.title} onClick={module.action} className="module-card hover-card" style={{ minHeight: 172, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: 21, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', textAlign: 'left', font: 'inherit', transition: 'border-color .15s ease,box-shadow .15s ease,transform .15s ease' }}>
              <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between' }}><span style={{ width: 39, height: 39, display: 'grid', placeItems: 'center', borderRadius: 8, background: '#EAF0FC' }}><Icon name={module.icon} size={22} color="var(--accent)" /></span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--good)', fontSize: 10.5, fontWeight: 600 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--good)' }} />Active</span></div>
              <div style={{ color: 'var(--text)', fontSize: 16, fontWeight: 650, marginTop: 19 }}>{module.title}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.5, marginTop: 5 }}>{module.desc}</div>
              <div style={{ marginTop: 'auto', paddingTop: 13, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>Open workspace <Icon name="arrow_forward" size={17} /></div>
            </button>
          ))}
        </div>

        <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', margin: '30px 0 10px' }}>Planned workspaces</div>
        <div className="launchpad-upcoming-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(180px,1fr))', gap: 12 }}>
          {upcoming.map((module) => (
            <div key={module.title} style={{ minHeight: 145, padding: 17, border: '1px solid var(--border)', borderRadius: 9, background: 'rgba(255,255,255,.58)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><Icon name={module.icon} size={21} color="var(--text-faint)" /><span style={{ color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 650, textTransform: 'uppercase' }}>Planned</span></div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, marginTop: 18 }}>{module.title}</div>
              <div style={{ color: 'var(--text-faint)', fontSize: 11.5, lineHeight: 1.45, marginTop: 5 }}>{module.desc}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
