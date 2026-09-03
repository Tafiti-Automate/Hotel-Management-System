import { useState, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { canAccessRoute, canSwitchBranches, canSwitchModules } from '../lib/access'

interface NavItem { route: string; label: string }
interface NavGroup { heading: string; items: NavItem[] }

const workflowNav: Record<string, NavGroup[]> = {
  requester: [
    { heading: 'Workspace', items: [
      { route: 'dashboard', label: 'Dashboard' },
      { route: 'workflow-stores', label: 'My requisitions' },
    ] },
    { heading: 'Control', items: [{ route: 'reports', label: 'Reports' }] },
  ],
  'department head': [
    { heading: 'Workspace', items: [
      { route: 'dashboard', label: 'Dashboard' },
      { route: 'workflow-stores', label: 'Department approvals' },
    ] },
    { heading: 'Control', items: [{ route: 'reports', label: 'Reports' }] },
  ],
  'store keeper': [
    { heading: 'Workspace', items: [
      { route: 'dashboard', label: 'Dashboard' },
      { route: 'workflow-stores', label: 'Store Keeper queue' },
      { route: 'store-purchase-requests', label: 'Purchase requests' },
    ] },
    { heading: 'Control', items: [{ route: 'reports', label: 'Reports' }] },
  ],
  'cost controller': [
    { heading: 'Workspace', items: [{ route: 'dashboard', label: 'Dashboard' }] },
    { heading: 'Supplier & article setup', items: [
      { route: 'suppliers', label: 'Suppliers' },
      { route: 'supplierItems', label: 'Supplier quotations' },
      { route: 'categories', label: 'Item Category' },
      { route: 'items', label: 'Articles / items' },
      { route: 'uoms', label: 'Units & conversions' },
    ] },
    { heading: 'Control', items: [{ route: 'reports', label: 'Reports' }] },
  ],
  'procurement manager': [
    { heading: 'Workspace', items: [
      { route: 'dashboard', label: 'Dashboard' },
      { route: 'workflow-procure', label: 'Procurement queue' },
    ] },
    { heading: 'Control', items: [{ route: 'reports', label: 'Reports' }] },
  ],
  'financial manager': [
    { heading: 'Workspace', items: [
      { route: 'dashboard', label: 'Dashboard' },
      { route: 'workflow-procure', label: 'LPO approvals' },
    ] },
    { heading: 'Control', items: [{ route: 'reports', label: 'Reports' }] },
  ],
  'general manager': [
    { heading: 'Workspace', items: [
      { route: 'dashboard', label: 'Dashboard' },
      { route: 'workflow-procure', label: 'Final LPO approvals' },
    ] },
    { heading: 'Control', items: [{ route: 'reports', label: 'Reports' }] },
  ],
  'receiving clerk': [
    { heading: 'Workspace', items: [
      { route: 'dashboard', label: 'Dashboard' },
      { route: 'workflow-procure', label: 'Receiving & GRN' },
    ] },
    { heading: 'Control', items: [{ route: 'reports', label: 'Reports' }] },
  ],
}

const adminOperations: NavGroup[] = [
  { heading: 'Workspace', items: [
    { route: 'dashboard', label: 'Dashboard' },
    { route: 'workflow-stores', label: 'Department & Stores workflow' },
    { route: 'workflow-procure', label: 'Procurement workflow' },
    { route: 'workflow-pay', label: 'Finance' },
  ] },
  { heading: 'Master data', items: [
    { route: 'suppliers', label: 'Suppliers' },
    { route: 'supplierItems', label: 'Supplier quotations' },
    { route: 'categories', label: 'Item Category' },
    { route: 'items', label: 'Articles / items' },
    { route: 'uoms', label: 'Units & conversions' },
    { route: 'locations', label: 'Stores' },
  ] },
  { heading: 'Control', items: [
    { route: 'reports', label: 'Reports' },
    { route: 'audit-log', label: 'Audit trail' },
    { route: 'access-management', label: 'User access' },
  ] },
]

const hrGroups: NavGroup[] = [
  { heading: 'Human resources', items: [
    { route: 'hr-dashboard', label: 'People dashboard' },
    { route: 'employees', label: 'Employees' },
    { route: 'departments', label: 'Departments' },
    { route: 'access-management', label: 'User access' },
  ] },
]

const navIcons: Record<string, string> = {
  dashboard: 'space_dashboard',
  'hr-dashboard': 'groups',
  'workflow-stores': 'warehouse',
  'store-purchase-requests': 'shopping_cart_checkout',
  'workflow-procure': 'shopping_cart_checkout',
  'workflow-pay': 'payments',
  suppliers: 'local_shipping',
  supplierItems: 'request_quote',
  items: 'inventory_2',
  categories: 'category',
  uoms: 'straighten',
  itemUnits: 'calculate',
  locations: 'warehouse',
  reports: 'bar_chart',
  'audit-log': 'history',
  'access-management': 'manage_accounts',
  employees: 'badge',
  departments: 'account_tree',
}

export default function Sidebar() {
  const app = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const role = String(app.user.role || '').trim().toLowerCase()
  const isAdministrator = app.user.isSuperuser || role === 'system administrator'
  const sourceGroups = app.activeModule === 'hr' ? hrGroups : (workflowNav[role] || adminOperations)
  const groups = sourceGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccessRoute(app.user, item.route)) }))
    .filter((group) => group.items.length)

  const roleTitle = app.activeModule === 'hr' ? 'Human Resources' : app.user.role || 'Operations'
  const contextLabel = role === 'store keeper'
    ? (app.data.locations.length === 1 ? String(app.data.locations[0].name) : app.currentBranch || app.user.branchName)
    : app.user.departmentName || app.currentBranch || app.user.branchName
  const branchLocked = !canSwitchBranches(app.user) && Boolean(app.user.branchId)
  const branches = branchLocked ? app.data.branches.filter((branch) => String(branch.id) === app.user.branchId) : app.data.branches
  const width = collapsed ? 60 : 220

  const navStyle = (active: boolean): CSSProperties => ({
    width: '100%', minHeight: 34, display: 'flex', alignItems: 'center', gap: 9,
    padding: '0 9px', border: 0, borderRadius: 4,
    background: 'transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)', cursor: 'pointer',
    font: 'inherit', fontSize: 13.5, fontWeight: active ? 650 : 550, textAlign: 'left',
  })

  return <>
    {mobileOpen && <button className="sidebar-mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} style={{ width, flex: 'none', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)', transition: 'width .18s ease' }}>
      <div className="sidebar-brand" style={{ height: 66, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 11, borderBottom: '1px solid var(--border)' }}>
        <div className="sidebar-brand-mark" style={{ width: 36, height: 36, flex: 'none', borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent)', color: '#fff' }}><Icon name="apartment" size={20} color="#fff" fill /></div>
        {!collapsed && <div style={{ minWidth: 0, flex: 1 }}><div className="sidebar-brand-title" style={{ color: 'var(--text)', fontSize: 14, fontWeight: 750 }}>Hotel ERP</div><div className="sidebar-brand-subtitle" style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 1 }}>{roleTitle}</div></div>}
        <button className="sidebar-mobile-toggle" onClick={() => setMobileOpen((open) => !open)} aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} style={plainIcon}><Icon name={mobileOpen ? 'close' : 'menu'} size={21} /></button>
        {!collapsed && <button className="sidebar-desktop-collapse" onClick={() => setCollapsed(true)} title="Collapse sidebar" style={plainIcon}><Icon name="left_panel_close" size={18} /></button>}
      </div>

      {collapsed && <button className="sidebar-desktop-collapse" onClick={() => setCollapsed(false)} title="Expand sidebar" style={{ ...plainIcon, margin: '10px auto 2px' }}><Icon name="left_panel_open" size={19} /></button>}

      {!collapsed && <div className="sidebar-property" style={{ padding: '12px 12px 6px', position: 'relative' }}>
        <button onClick={branchLocked || !isAdministrator ? undefined : app.toggleBranch} style={{ width: '100%', minHeight: 50, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', cursor: branchLocked || !isAdministrator ? 'default' : 'pointer', font: 'inherit' }}>
          <Icon name={role === 'store keeper' ? 'warehouse' : 'business'} size={18} color="var(--text-muted)" />
          <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}><span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)', fontWeight: 650 }}>{role === 'store keeper' ? 'Store / property' : app.user.departmentName ? 'Department' : 'Property'}</span><span style={{ display: 'block', marginTop: 2, fontSize: 12.5, fontWeight: 650, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contextLabel || 'Current property'}</span></span>
          {isAdministrator && !branchLocked && <Icon name="unfold_more" size={17} color="var(--text-faint)" />}
        </button>
        {app.branchOpen && <><div onClick={app.closePop} style={{ position: 'fixed', inset: 0, zIndex: 40 }} /><div style={{ position: 'absolute', left: 12, right: 12, top: '100%', zIndex: 50, padding: 5, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow)' }}>{branches.map((branch) => <button key={branch.id} onClick={() => app.selectBranch(String(branch.name))} className="hover-surface2" style={{ width: '100%', minHeight: 36, border: 0, borderRadius: 5, background: 'transparent', padding: '0 9px', textAlign: 'left', color: 'var(--text)', font: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>{branch.name}</button>)}</div></>}
      </div>}

      <nav className="sidebar-nav" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: collapsed ? '6px 10px 12px' : '6px 10px 16px' }}>
        {groups.map((group, groupIndex) => <div key={group.heading} className="sidebar-nav-group" style={{ paddingTop: groupIndex ? 14 : 4 }}>
          {!collapsed && <div className="sidebar-nav-heading" style={{ minHeight: 30, display: 'flex', alignItems: 'center', padding: '0 10px', color: 'var(--text-faint)', fontSize: 12, fontWeight: 750, letterSpacing: '.04em', textTransform: 'uppercase' }}>{group.heading}</div>}
          {group.items.map((item) => { const active = app.navActive === item.route || (item.route === 'uoms' && app.navActive === 'itemUnits'); return <button key={item.route} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} aria-current={active ? 'page' : undefined} onClick={() => { app.navTo(item.route, item.label); setMobileOpen(false) }} className={`sidebar-nav-item ${active ? 'active' : 'hover-surface2'}`} style={navStyle(active)}><Icon name={navIcons[item.route] || 'chevron_right'} size={17} weight={300} />{!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>}</button> })}
        </div>)}
      </nav>

      <div className="sidebar-footer" style={{ borderTop: '1px solid var(--border)', padding: collapsed ? 10 : '10px 12px' }}>
        {canSwitchModules(app.user) && <button onClick={app.gotoModules} title="Switch module" className="hover-surface2" style={{ ...navStyle(false), justifyContent: collapsed ? 'center' : undefined }}><Icon name="apps" size={19} />{!collapsed && <span>Switch module</span>}</button>}
        {!collapsed && <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px 2px' }}><Avatar className="sidebar-user-avatar" src={app.user.photoUrl} name={app.user.name} size={34} radius={8} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ color: 'var(--text)', fontSize: 12.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.user.name}</div><div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.user.role}</div></div><button onClick={app.logout} title="Sign out" style={plainIcon}><Icon name="logout" size={18} /></button></div>}
      </div>
    </aside>
  </>
}

const plainIcon: CSSProperties = { width: 30, height: 30, border: 0, borderRadius: 6, background: 'transparent', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', cursor: 'pointer' }
