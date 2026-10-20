import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { canAccessRoute, canSwitchBranches, canSwitchModules } from '../lib/access'

interface NavItem { route: string; label: string; icon?: string }
interface NavGroup { heading: string; items: NavItem[] }

const roleNavigation: Record<string, NavGroup[]> = {
  'department supervisor': [
    { heading: 'Department', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-stores', label: 'My requests', icon: 'assignment' },
    ] },
  ],
  supervisor: [
    { heading: 'Department', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-stores', label: 'My requests', icon: 'assignment' },
    ] },
  ],
  'department head': [
    { heading: 'Department', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-stores', label: 'Approvals', icon: 'approval' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'store keeper': [
    { heading: 'Stores', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-stores', label: 'Issue requests', icon: 'inventory' },
      { route: 'store-transfers', label: 'Transfers', icon: 'sync_alt' },
      { route: 'stock-on-hand', label: 'Stock on Hand Control', icon: 'inventory_2' },
      { route: 'locations', label: 'Stores & locations', icon: 'warehouse' },
      { route: 'store-inventory', label: 'Manage inventory', icon: 'fact_check' },
      { route: 'store-purchase-requests', label: 'Purchase requests', icon: 'shopping_cart' },
    ] },
    { heading: 'Insights', items: [
      { route: 'store-usage', label: 'Usage', icon: 'monitoring' },
      { route: 'store-analysis', label: 'Stock analysis', icon: 'bar_chart' },
      { route: 'reports', label: 'All reports', icon: 'description' },
    ] },
  ],
  'cost controller': [
    { heading: 'Control desk', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-stores', label: 'Request control', icon: 'fact_check' },
    ] },
    { heading: 'Master data', items: [
      { route: 'suppliers', label: 'Suppliers', icon: 'local_shipping' },
      { route: 'supplierItems', label: 'Supplier prices', icon: 'request_quote' },
      { route: 'categories', label: 'Item categories', icon: 'category' },
      { route: 'items', label: 'Articles', icon: 'inventory_2' },
      { route: 'uoms', label: 'Units & conversions', icon: 'straighten' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'procurement manager': [
    { heading: 'Procurement', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-procure', label: 'Procurement workbench', icon: 'shopping_cart' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'procurement officer': [
    { heading: 'Procurement', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-procure', label: 'Procurement workbench', icon: 'shopping_cart' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'financial manager': [
    { heading: 'Approvals', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-procure', label: 'LPO approvals', icon: 'approval' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'general manager': [
    { heading: 'Management', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-procure', label: 'Final approvals', icon: 'verified' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'receiving clerk': [
    { heading: 'Receiving', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-procure', label: 'Receiving & GRN', icon: 'local_shipping' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
}

const adminNavigation: NavGroup[] = [
  { heading: 'Operations', items: [
    { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
    { route: 'workflow-stores', label: 'Stores workflow', icon: 'inventory' },
    { route: 'stock-on-hand', label: 'Stock on hand', icon: 'inventory_2' },
    { route: 'workflow-procure', label: 'Procurement', icon: 'shopping_cart' },
    { route: 'workflow-pay', label: 'Finance', icon: 'payments' },
  ] },
  { heading: 'Master data', items: [
    { route: 'suppliers', label: 'Suppliers', icon: 'local_shipping' },
    { route: 'supplierItems', label: 'Supplier prices', icon: 'request_quote' },
    { route: 'categories', label: 'Item categories', icon: 'category' },
    { route: 'items', label: 'Articles', icon: 'inventory_2' },
    { route: 'uoms', label: 'Units & conversions', icon: 'straighten' },
    { route: 'locations', label: 'Stores', icon: 'warehouse' },
  ] },
  { heading: 'Governance', items: [
    { route: 'reports', label: 'Reports', icon: 'bar_chart' },
    { route: 'audit-log', label: 'Audit trail', icon: 'history' },
    { route: 'access-management', label: 'User access', icon: 'manage_accounts' },
    { route: 'hotel-profile', label: 'Settings', icon: 'settings' },
  ] },
]

const hrNavigation: NavGroup[] = [
  { heading: 'Human resources', items: [
    { route: 'hr-dashboard', label: 'People overview', icon: 'groups' },
    { route: 'employees', label: 'Employees', icon: 'badge' },
    { route: 'departments', label: 'Departments', icon: 'account_tree' },
    { route: 'access-management', label: 'User access', icon: 'manage_accounts' },
  ] },
]

export default function Sidebar() {
  const app = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const role = String(app.user.role || '').trim().toLowerCase()
  const administrator = app.user.isSuperuser || role === 'system administrator'
  const rawGroups = app.activeModule === 'hr' ? hrNavigation : (roleNavigation[role] || adminNavigation)
  const groups = rawGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccessRoute(app.user, item.route)) }))
    .filter((group) => group.items.length)

  const branchLocked = !canSwitchBranches(app.user) && Boolean(app.user.branchId)
  const branchOptions = branchLocked
    ? app.data.branches.filter((branch) => String(branch.id) === app.user.branchId)
    : app.data.branches
  const locationName = role === 'store keeper' && app.data.locations.length === 1
    ? String(app.data.locations[0].name || '')
    : ''
  const contextName = locationName || app.user.departmentName || app.currentBranch || app.user.branchName || 'Current workspace'
  const workspaceTitle = app.activeModule === 'hr' ? 'Human Resources' : 'Hotel Operations'

  useEffect(() => {
    const open = () => setMobileOpen(true)
    window.addEventListener('tafiti-sidebar-open', open)
    return () => window.removeEventListener('tafiti-sidebar-open', open)
  }, [])

  return <>
    {mobileOpen && <button className="neo-sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

    <aside className={`neo-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
      <div className="neo-sidebar-brand">
        <span className="neo-brand-mark"><Icon name="hotel" size={21} color="#fff" fill /></span>
        {!collapsed && <span className="neo-brand-copy"><strong>Hotel ERP</strong><small>{workspaceTitle}</small></span>}
        <button className="neo-icon-button neo-sidebar-collapse" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
          <Icon name={collapsed ? 'right_panel_open' : 'left_panel_close'} size={18} />
        </button>
        <button className="neo-icon-button neo-sidebar-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><Icon name="close" size={19} /></button>
      </div>

      {!collapsed && <div className="neo-context-wrap">
        <button
          type="button"
          className="neo-context-card"
          onClick={administrator && !branchLocked ? app.toggleBranch : undefined}
          aria-expanded={app.branchOpen}
        >
          <span className="neo-context-icon"><Icon name={role === 'store keeper' ? 'warehouse' : app.activeModule === 'hr' ? 'groups' : 'business'} size={17} /></span>
          <span className="neo-context-copy"><small>{role === 'store keeper' ? 'Store / property' : app.user.departmentName ? 'Department' : 'Property'}</small><strong>{contextName}</strong></span>
          {administrator && !branchLocked && <Icon name="expand_more" size={16} />}
        </button>
        {app.branchOpen && <>
          <button className="neo-popover-backdrop" aria-label="Close property selector" onClick={app.closePop} />
          <div className="neo-branch-menu">
            {branchOptions.map((branch) => <button key={String(branch.id)} onClick={() => app.selectBranch(String(branch.name))}>{String(branch.name)}</button>)}
            {!branchOptions.length && <span>No properties available</span>}
          </div>
        </>}
      </div>}

      <nav className="neo-sidebar-nav" aria-label="Primary navigation">
        {groups.map((group) => <section className="neo-nav-group" key={group.heading}>
          {!collapsed && <div className="neo-nav-heading">{group.heading}</div>}
          <div className="neo-nav-items">
            {group.items.map((item) => {
              const active = app.navActive === item.route || (item.route === 'uoms' && app.navActive === 'itemUnits')
              return <button
                type="button"
                key={item.route}
                className={`neo-nav-item ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
                onClick={() => {
                  app.navTo(item.route, item.label)
                  setMobileOpen(false)
                }}
              >
                <span className="neo-nav-icon"><Icon name={item.icon || 'chevron_right'} size={18} /></span>
                {!collapsed && <span>{item.label}</span>}
                {!collapsed && active && <i aria-hidden="true" />}
              </button>
            })}
          </div>
        </section>)}
      </nav>

      <div className="neo-sidebar-footer">
        {canSwitchModules(app.user) && <button type="button" className="neo-module-switch" onClick={app.gotoModules} title="Switch workspace">
          <Icon name="apps" size={18} />
          {!collapsed && <span>Switch workspace</span>}
        </button>}

        <div className={`neo-sidebar-user ${collapsed ? 'is-compact' : ''}`}>
          <Avatar src={app.user.photoUrl} name={app.user.name} size={34} radius={10} />
          {!collapsed && <span className="neo-sidebar-user-copy"><strong>{app.user.name}</strong><small>{app.user.role}</small></span>}
          {!collapsed && <button className="neo-icon-button" onClick={app.logout} aria-label="Sign out" title="Sign out"><Icon name="logout" size={17} /></button>}
        </div>
      </div>
    </aside>
  </>
}
