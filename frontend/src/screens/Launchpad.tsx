import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import { canAccessModule } from '../lib/access'

export default function Launchpad() {
  const app = useApp()
  const modules = [
    { module: 'operations' as const, title: 'Hotel Operations', desc: 'Procurement, stores, inventory, suppliers and operational reporting.', icon: 'inventory_2', action: app.enterApp },
    { module: 'hr' as const, title: 'Human Resources', desc: 'Employee records, departments and workforce administration.', icon: 'groups', action: app.enterHR },
  ].filter((module) => canAccessModule(app.user, module.module))
  const initials = app.user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="launchpad">
      <header className="launchpad-header">
        <div className="launchpad-brand">
          <span className="launchpad-brand-mark"><Icon name="hotel" size={20} color="#fff" fill /></span>
          <span><strong>Hotel ERP</strong><small>Operations & administration</small></span>
        </div>
        <div className="launchpad-account">
          <span className="launchpad-avatar">{initials}</span>
          <span className="launchpad-user"><strong>{app.user.name}</strong><small>{app.user.role}</small></span>
          <button onClick={app.logout} title="Sign out" aria-label="Sign out" className="launchpad-signout"><Icon name="logout" size={18} /></button>
        </div>
      </header>

      <main className="launchpad-main">
        <div className="launchpad-heading">
          <span className="launchpad-eyebrow">Workspace</span>
          <h1>Choose a business area</h1>
          <p>Select a workspace to continue.</p>
        </div>

        <div className="launchpad-active-grid">
          {modules.map((module) => (
            <button key={module.title} onClick={module.action} className="module-card">
              <span className="module-card-icon"><Icon name={module.icon} size={22} /></span>
              <span className="module-card-copy"><strong>{module.title}</strong><small>{module.desc}</small></span>
              <span className="module-card-action">Open <Icon name="arrow_forward" size={17} /></span>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}
