import { useState, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { canSwitchModules, isStoresManager } from '../lib/access'

export default function Header() {
  const app = useApp()
  const [profileOpen, setProfileOpen] = useState(false)
  const storesManager = isStoresManager(app.user)
  const roleKey = app.user.role.trim().toLowerCase()
  const moduleName = storesManager ? 'Stores & Inventory' : app.activeModule === 'hr' ? 'Human Resources' : `${app.user.role} workspace`
  const initials = app.user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const isHR = app.activeModule === 'hr'
  const pendingStoreRequests = app.data.storeRequisitions.filter((row) => String(row.status).toLowerCase() === 'submitted').length
  const pendingPurchaseRequests = app.data.requisitions.filter((row) => String(row.status).toLowerCase() === 'pending').length
  const notificationCount = ['stores manager', 'store manager', 'store keeper'].includes(roleKey) ? pendingStoreRequests : pendingPurchaseRequests
  const hasPermission = (permission: string) => app.user.isSuperuser || app.user.permissions.includes(permission)

  const primary = (() => {
    if (isHR) {
      return hasPermission('employees.add_employee')
        ? { label: 'Register employee', icon: 'person_add', action: () => app.openCreate('employees', 'Employees') }
        : null
    }
    if (['stores manager', 'store manager', 'store keeper'].includes(roleKey)) {
      return { label: 'Open stores workbench', icon: 'warehouse', action: () => app.navTo('workflow-stores', 'Stores workbench') }
    }
    if (roleKey === 'finance controller') {
      return { label: 'Open finance workbench', icon: 'account_balance', action: () => app.navTo('workflow-pay', 'Finance control centre') }
    }
    if (roleKey === 'receiving officer') {
      return { label: 'Open receiving workbench', icon: 'move_to_inbox', action: () => app.navTo('workflow-procure', 'Receiving workbench') }
    }
    if (hasPermission('procurement.add_purchaserequisition')) {
      return { label: 'New requisition', icon: 'add', action: () => app.openCreate('requisitions', 'Purchase requisitions') }
    }
    if (hasPermission('approvals.change_approvalworkflow')) {
      return { label: 'Review approvals', icon: 'approval', action: () => app.navTo('approvals', 'Approvals') }
    }
    return null
  })()

  return (
    <header className="app-header" style={{ height: 96, flex: 'none', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <div style={{ height: 58, display: 'flex', alignItems: 'center', gap: 18, padding: '0 24px' }}>
        <div className="header-search" style={{ flex: 1, maxWidth: 560, position: 'relative' }}>
          <Icon name="search" size={19} color="var(--text-faint)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input placeholder={storesManager ? 'Search articles, stock, store requests and receipts…' : 'Search articles, suppliers, employees, POs, GRNs…'} style={{ width: '100%', height: 38, border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 7, padding: '0 42px 0 38px', color: 'var(--text)', fontSize: 13, outline: 'none' }} />
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 5px', color: 'var(--text-faint)', fontSize: 10 }}>⌘ K</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
          <button onClick={primary?.action} className="header-text-action hover-surface2" style={textAction}><Icon name="task_alt" size={18} />Tasks</button>
          <button className="header-text-action hover-surface2" style={textAction}><Icon name="help" size={18} />Help</button>
          <button onClick={primary?.action} title="Notifications" className="hover-surface2" style={{ ...iconAction, position: 'relative' }}><Icon name="notifications" size={20} />{notificationCount > 0 && <span style={{ position: 'absolute', right: 7, top: 6, minWidth: 15, height: 15, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'var(--bad)', color: '#fff', fontSize: 9, fontWeight: 700, border: '2px solid var(--surface)' }}>{notificationCount}</span>}</button>

          <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 8px' }} />
          <div style={{ position: 'relative' }}>
            <button onClick={() => setProfileOpen((open) => !open)} style={{ height: 40, display: 'flex', alignItems: 'center', gap: 9, border: 0, background: 'transparent', borderRadius: 7, padding: '0 4px 0 7px', cursor: 'pointer', font: 'inherit' }} className="hover-surface2">
              <span style={{ width: 31, height: 31, borderRadius: 7, display: 'grid', placeItems: 'center', background: '#E8EEF9', color: '#1D4ED8', fontSize: 11, fontWeight: 700 }}>{initials}</span>
              <span className="header-user-copy" style={{ textAlign: 'left' }}><span style={{ display: 'block', color: 'var(--text)', fontSize: 12.5, fontWeight: 600 }}>{app.user.name}</span><span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 10.5, marginTop: 1 }}>{app.user.role}</span></span>
              <Icon name="expand_more" size={17} color="var(--text-faint)" />
            </button>
            {profileOpen && <>
              <div onClick={() => setProfileOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', right: 0, top: '100%', width: 220, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow)', padding: 6 }}>
                <button onClick={app.toggleMode} className="hover-surface2" style={menuAction}><Icon name={app.mode === 'dark' ? 'light_mode' : 'dark_mode'} size={18} />{app.mode === 'dark' ? 'Light appearance' : 'Dark appearance'}</button>
                {canSwitchModules(app.user) && <button onClick={app.gotoModules} className="hover-surface2" style={menuAction}><Icon name="apps" size={18} />Switch module</button>}
                <button onClick={app.logout} className="hover-surface2" style={{ ...menuAction, color: 'var(--bad)' }}><Icon name="logout" size={18} />Sign out</button>
              </div>
            </>}
          </div>
        </div>
      </div>

      <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 24px', borderTop: '1px solid var(--border)', background: '#FBFCFD' }}>
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{moduleName}</span>
        <Icon name="chevron_right" size={15} color="var(--text-faint)" />
        <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>{app.crumb}</span>
        {primary && <button onClick={primary.action} className="header-primary-action hover-accent" style={{ marginLeft: 'auto', height: 29, display: 'flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 5, background: 'var(--accent)', color: '#fff', padding: '0 11px', cursor: 'pointer', font: 'inherit', fontSize: 11.5, fontWeight: 600 }}><Icon name={primary.icon} size={16} color="#fff" />{primary.label}</button>}
      </div>
    </header>
  )
}

const iconAction: CSSProperties = {
  width: 38, height: 38, border: 0, borderRadius: 6, background: 'transparent',
  display: 'grid', placeItems: 'center', color: 'var(--text-muted)', cursor: 'pointer',
}

const textAction: CSSProperties = {
  height: 38, border: 0, borderRadius: 6, background: 'transparent', padding: '0 9px',
  display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', font: 'inherit',
  fontSize: 12, fontWeight: 500, cursor: 'pointer',
}

const menuAction: CSSProperties = {
  width: '100%', height: 36, border: 0, borderRadius: 5, background: 'transparent',
  display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', color: 'var(--text-muted)',
  font: 'inherit', fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
}
