import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/Avatar'
import { canAccessModule } from '../lib/access'

export default function Launchpad() {
  const app = useApp()
  const modules = [
    { module: 'operations' as const, eyebrow: 'Operations', title: 'Hotel Operations', desc: 'Procurement, stores, inventory, suppliers and operational reporting.', meta: 'Inventory · Procurement · Finance', icon: 'inventory_2', action: app.enterApp },
    { module: 'hr' as const, eyebrow: 'People', title: 'Human Resources', desc: 'Employee records, departments and workforce administration.', meta: 'Employees · Departments · Access', icon: 'groups', action: app.enterHR },
  ].filter((module) => canAccessModule(app.user, module.module))

  return (
    <div className="launchpad">
      <header className="launchpad-header">
        <div className="launchpad-brand">
          <span className="launchpad-brand-mark"><Icon name="hotel" size={20} color="#fff" fill /></span>
          <span><strong>Hotel ERP</strong><small>Operations & administration</small></span>
        </div>
        <div className="launchpad-account">
          <Avatar className="launchpad-avatar" src={app.user.photoUrl} name={app.user.name} size={38} radius="50%" />
          <span className="launchpad-user"><strong>{app.user.name}</strong><small>{app.user.role}</small></span>
          <button onClick={app.logout} title="Sign out" aria-label="Sign out" className="launchpad-signout"><Icon name="logout" size={18} /></button>
        </div>
      </header>

      <main className="launchpad-main">
        <section className="launchpad-intro">
          <div className="launchpad-heading">
            <span className="launchpad-eyebrow">Workspace directory</span>
            <h1>Good to see you, {app.user.name.split(' ')[0]}.</h1>
            <p>Choose the business area you want to manage. Your assigned access and scope will be applied automatically.</p>
          </div>
          <aside className="launchpad-session" aria-label="Current session">
            <span className="launchpad-session-icon"><Icon name="verified_user" size={19} /></span>
            <span><small>Signed in with</small><strong>{app.user.role}</strong></span>
            <span className="launchpad-session-status"><i />Secure session</span>
          </aside>
        </section>

        <section className="launchpad-workspaces" aria-labelledby="workspace-heading">
          <div className="launchpad-section-heading">
            <div><span>Available to you</span><h2 id="workspace-heading">Business areas</h2></div>
            <small>{modules.length} area{modules.length === 1 ? '' : 's'}</small>
          </div>
          <div className="launchpad-active-grid">
          {modules.map((module) => (
            <button key={module.title} onClick={module.action} className="module-card">
              <span className="module-card-icon"><Icon name={module.icon} size={22} /></span>
              <span className="module-card-copy"><em>{module.eyebrow}</em><strong>{module.title}</strong><small>{module.desc}</small><span>{module.meta}</span></span>
              <span className="module-card-action"><span>Open</span><Icon name="arrow_forward" size={18} /></span>
            </button>
          ))}
          </div>
        </section>
      </main>
    </div>
  )
}
