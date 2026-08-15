import { useState, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { canAccessRoute, canSwitchBranches, canSwitchModules, isStoresManager } from '../lib/access'

interface NavItem { route: string; label: string; icon: string }
interface NavGroup { heading: string; icon?: string; items: NavItem[] }

const operationsGroups: NavGroup[] = [
  { heading: 'Hotel operations', items: [{ route: 'dashboard', label: 'Dashboard', icon: 'space_dashboard' }] },
  { heading: 'Start here · workflows', icon: 'route', items: [
    { route: 'workflow-stores', label: 'Store requests', icon: 'warehouse' },
    { route: 'workflow-procure', label: 'Procurement', icon: 'shopping_cart_checkout' },
    { route: 'workflow-pay', label: 'Finance', icon: 'payments' },
    { route: 'approvals', label: 'My approval queue', icon: 'approval' },
  ] },
  { heading: 'Procurement records', icon: 'shopping_cart', items: [
    { route: 'requisitions', label: 'Purchase requisitions', icon: 'request_quote' },
    { route: 'orders', label: 'Purchase orders', icon: 'receipt_long' },
    { route: 'grns', label: 'Goods receipts', icon: 'move_to_inbox' },
  ] },
  { heading: 'Inventory records', icon: 'inventory_2', items: [
    { route: 'items', label: 'Article catalogue', icon: 'inventory_2' },
    { route: 'categories', label: 'Categories', icon: 'category' },
    { route: 'uoms', label: 'Units of measure', icon: 'straighten' },
    { route: 'itemUnits', label: 'Unit conversions', icon: 'calculate' },
    { route: 'balances', label: 'Stock balances', icon: 'equalizer' },
    { route: 'ledgers', label: 'Stock ledger', icon: 'menu_book' },
    { route: 'batches', label: 'Batches & expiry', icon: 'layers' },
  ] },
  { heading: 'Stores records', icon: 'warehouse', items: [
    { route: 'storeRequisitions', label: 'Store requests', icon: 'assignment' },
    { route: 'stockIssues', label: 'Stock issues', icon: 'outbox' },
    { route: 'storeReturns', label: 'Store returns', icon: 'assignment_return' },
  ] },
  { heading: 'Partners & control', items: [
    { route: 'suppliers', label: 'Suppliers', icon: 'local_shipping' },
    { route: 'supplierItems', label: 'Supplier catalogue', icon: 'contract' },
    { route: 'reports', label: 'Reports', icon: 'bar_chart' },
    { route: 'audit-log', label: 'Audit log', icon: 'history' },
    { route: 'workflow-configure', label: 'Settings', icon: 'settings' },
  ] },
]

const hrGroups: NavGroup[] = [
  { heading: 'Human resources', items: [{ route: 'hr-dashboard', label: 'People dashboard', icon: 'space_dashboard' }] },
  { heading: 'Workforce', icon: 'groups', items: [
    { route: 'employees', label: 'Employees', icon: 'badge' },
    { route: 'departments', label: 'Departments', icon: 'account_tree' },
  ] },
  { heading: 'Access control', icon: 'admin_panel_settings', items: [
    { route: 'access-management', label: 'Roles & user accounts', icon: 'manage_accounts' },
  ] },
]

export default function Sidebar() {
  const app = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const storesManager = isStoresManager(app.user)
  const baseGroups = app.activeModule === 'hr' ? hrGroups : operationsGroups
  const role = String(app.user.role || '').toLowerCase()
  const isRequester = ['staff', 'unassigned', 'department employee', 'employee'].includes(role)
  const groups = baseGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => {
      if (!canAccessRoute(app.user, item.route)) return false
      if (isRequester && ['uoms', 'storeRequisitions'].includes(item.route)) return false
      return true
    }) }))
    .filter((group) => group.items.length > 0)
  const departmentLabel = app.user.departmentName || app.user.role
  const moduleTitle = storesManager ? 'Stores & Inventory' : app.activeModule === 'hr' ? 'Human Resources' : departmentLabel
  const moduleIcon = storesManager ? 'warehouse' : app.activeModule === 'hr' ? 'groups' : 'hotel'
  const initials = app.user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const branchLocked = !canSwitchBranches(app.user) && Boolean(app.user.branchId)
  const branches = branchLocked
    ? app.data.branches.filter((branch) => String(branch.id) === app.user.branchId)
    : app.data.branches
  const width = collapsed ? 76 : 260

  const navStyle = (active: boolean): CSSProperties => ({
    width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 11,
    padding: collapsed ? '0 12px' : '0 12px', border: 0, borderRadius: 6,
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer',
    font: 'inherit', fontSize: 14.5, fontWeight: active ? 650 : 500, textAlign: 'left',
  })

  return (
    <>
    {mobileOpen && <button className="sidebar-mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} style={{ width, flex: 'none', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)', transition: 'width .18s ease' }}>
      <div className="sidebar-brand" style={{ height: 64, padding: '0 17px', display: 'flex', alignItems: 'center', gap: 11, borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: 34, height: 34, flex: 'none', borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--accent)', color: '#fff' }}>
          <Icon name={moduleIcon} size={20} color="#fff" fill />
        </div>
        {!collapsed && <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 700 }}>{moduleTitle}</div><div style={{ color: 'var(--text-faint)', fontSize: 10.5, marginTop: 2 }}>Management workspace</div></div>}
        <button className="sidebar-mobile-toggle" onClick={() => setMobileOpen((open) => !open)} aria-expanded={mobileOpen} aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} style={plainIcon}><Icon name={mobileOpen ? 'close' : 'menu'} size={21} /></button>
        {!collapsed && <button className="sidebar-desktop-collapse" onClick={() => setCollapsed(true)} title="Collapse sidebar" style={plainIcon}><Icon name="left_panel_close" size={18} /></button>}
      </div>

      {collapsed && <button className="sidebar-desktop-collapse" onClick={() => setCollapsed(false)} title="Expand sidebar" style={{ ...plainIcon, margin: '10px auto 2px' }}><Icon name="left_panel_open" size={19} /></button>}

      {!collapsed && (
        <div className="sidebar-property" style={{ padding: '12px 12px 6px', position: 'relative' }}>
          <button onClick={branchLocked ? undefined : app.toggleBranch} className={branchLocked ? undefined : 'hover-border2'} style={{ width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', cursor: branchLocked ? 'default' : 'pointer', font: 'inherit' }}>
            <Icon name="apartment" size={18} color="var(--text-muted)" />
            <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}><span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)', fontWeight: 600 }}>Property</span><span style={{ display: 'block', marginTop: 2, fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.currentBranch || 'No branch configured'}</span></span>
            {!branchLocked && <Icon name="unfold_more" size={17} color="var(--text-faint)" />}
          </button>
          {app.branchOpen && <>
            <div onClick={app.closePop} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div style={{ position: 'absolute', left: 12, right: 12, top: '100%', zIndex: 50, padding: 5, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow)' }}>
              {branches.map((branch) => <button key={branch.id} onClick={() => app.selectBranch(String(branch.name))} className="hover-surface2" style={{ width: '100%', minHeight: 36, border: 0, borderRadius: 5, background: 'transparent', padding: '0 9px', textAlign: 'left', color: 'var(--text)', font: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>{branch.name}</button>)}
              {!branches.length && <div style={{ padding: 10, color: 'var(--text-faint)', fontSize: 11.5 }}>No branches returned by the backend.</div>}
            </div>
          </>}
        </div>
      )}

      <nav className="sidebar-nav" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: collapsed ? '6px 10px 12px' : '4px 10px 16px' }}>
        {groups.map((group, groupIndex) => (
          <div key={group.heading} style={{ paddingTop: groupIndex ? 13 : 5, borderTop: groupIndex && !collapsed ? '1px solid var(--border)' : undefined, marginTop: groupIndex && !collapsed ? 5 : 0 }}>
            {!collapsed && <div style={{ minHeight: 32, display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px', color: 'var(--text-faint)', fontSize: 13, fontWeight: 600 }}>{group.icon && <Icon name={group.icon} size={15} />}{group.heading}</div>}
            {group.items.map((item) => {
              const active = app.navActive === item.route
              return <button key={item.route} title={collapsed ? item.label : undefined} onClick={() => { app.navTo(item.route, item.label); setMobileOpen(false) }} className={active ? undefined : 'hover-surface2'} style={navStyle(active)}><Icon name={item.icon} size={19} color={active ? 'var(--accent)' : 'var(--text-faint)'} />{!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>}</button>
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer" style={{ borderTop: '1px solid var(--border)', padding: collapsed ? 10 : '10px 12px' }}>
        {canSwitchModules(app.user) && <button onClick={app.gotoModules} title="Switch module" className="hover-surface2" style={{ ...navStyle(false), justifyContent: collapsed ? 'center' : undefined }}><Icon name="apps" size={19} />{!collapsed && <span>Switch module</span>}</button>}
        {!collapsed && <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px 2px' }}><div style={{ width: 32, height: 32, borderRadius: 7, display: 'grid', placeItems: 'center', background: '#E8EEF9', color: '#1D4ED8', fontSize: 11, fontWeight: 700 }}>{initials}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.user.name}</div><div style={{ color: 'var(--text-faint)', fontSize: 10.5, marginTop: 2 }}>{departmentLabel}</div></div><button onClick={app.logout} title="Sign out" style={plainIcon}><Icon name="logout" size={18} /></button></div>}
      </div>
    </aside>
    </>
  )
}

const plainIcon: CSSProperties = {
  width: 30, height: 30, border: 0, borderRadius: 6, background: 'transparent',
  display: 'grid', placeItems: 'center', color: 'var(--text-faint)', cursor: 'pointer',
}
