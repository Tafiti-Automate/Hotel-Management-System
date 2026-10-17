import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/Avatar'
import { canAccessModule } from '../lib/access'

export default function Launchpad() {
  const app = useApp()
  const modules = [
    {
      module: 'operations' as const,
      title: 'Hotel Operations',
      description: 'Procurement, stores, inventory, suppliers, finance and operational reporting.',
      meta: ['Procurement', 'Stores', 'Finance'],
      icon: 'inventory_2',
      action: app.enterApp,
    },
    {
      module: 'hr' as const,
      title: 'Human Resources',
      description: 'Employees, departments, staff administration and account access.',
      meta: ['Employees', 'Departments', 'Access'],
      icon: 'groups',
      action: app.enterHR,
    },
  ].filter((module) => canAccessModule(app.user, module.module))

  const firstName = app.user.name.split(/\s+/).filter(Boolean)[0] || 'there'
  const context = app.user.departmentName || app.currentBranch || app.user.branchName || 'Hotel ERP'

  return <div className="neo-launchpad">
    <header className="neo-launchpad-header">
      <div className="neo-launchpad-brand"><span><Icon name="hotel" size={21} color="#fff" fill /></span><div><strong>Hotel ERP</strong><small>Business workspace</small></div></div>
      <div className="neo-launchpad-account">
        <span className="neo-launchpad-context"><Icon name="business" size={15} />{context}</span>
        <Avatar src={app.user.photoUrl} name={app.user.name} size={36} radius={10} />
        <span><strong>{app.user.name}</strong><small>{app.user.role}</small></span>
        <button type="button" className="neo-launchpad-icon" onClick={app.logout} aria-label="Sign out" title="Sign out"><Icon name="logout" size={18} /></button>
      </div>
    </header>

    <main className="neo-launchpad-main">
      <section className="neo-launchpad-hero">
        <div>
          <span className="neo-launchpad-eyebrow">Workspace directory</span>
          <h1>Welcome back, {firstName}.</h1>
          <p>Select the business area you want to work in. Your role, property and permissions will be applied automatically.</p>
        </div>
        <div className="neo-session-card">
          <span className="neo-session-icon"><Icon name="verified_user" size={20} /></span>
          <div><small>Signed in as</small><strong>{app.user.role}</strong><span><i />Secure session</span></div>
        </div>
      </section>

      <section className="neo-launchpad-section">
        <div className="neo-launchpad-section-head"><div><span>Available to you</span><h2>Business areas</h2></div><small>{modules.length} workspace{modules.length === 1 ? '' : 's'}</small></div>
        <div className="neo-module-grid">
          {modules.map((module) => <button type="button" key={module.module} className="neo-module-card" onClick={module.action}>
            <span className="neo-module-card-icon"><Icon name={module.icon} size={24} /></span>
            <span className="neo-module-card-copy"><strong>{module.title}</strong><small>{module.description}</small><span>{module.meta.map((item) => <em key={item}>{item}</em>)}</span></span>
            <span className="neo-module-card-open">Open workspace <Icon name="arrow_forward" size={17} /></span>
          </button>)}
        </div>
      </section>

      <section className="neo-launchpad-footnote"><Icon name="info" size={16} /><span>Only business areas permitted for your account are shown here.</span></section>
    </main>
  </div>
}
