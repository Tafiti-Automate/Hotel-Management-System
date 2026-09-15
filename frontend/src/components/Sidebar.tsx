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
    { route: 'hotel-profile', label: 'Settings' },
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
  'hotel-profile': 'settings',
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
  const width = collapsed ? 58 : 195

  const navStyle = (active: boolean): CSSProperties => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    border: 0,
    background: 'transparent',
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
    color: active ? 'var(--accent)' : 'inherit',
  })

  return <>
    {mobileOpen && (
      <button
        className="sidebar-mobile-backdrop"
        aria-label="Close navigation"
        onClick={() => setMobileOpen(false)}
      />
    )}

    <aside
      className={`sidebar tafiti-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      style={{ width }}
    >
      <div className="sidebar-brand tafiti-sidebar-brand">
        <div className="sidebar-brand-mark tafiti-sidebar-brand-mark">
          <Icon name="apartment" size={20} color="#fff" fill />
        </div>

        {!collapsed && (
          <div className="tafiti-sidebar-brand-copy">
            <div className="sidebar-brand-title">Hotel ERP</div>
            <div className="sidebar-brand-subtitle">{roleTitle}</div>
          </div>
        )}

        <button
          className="sidebar-mobile-toggle tafiti-sidebar-mobile-toggle"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          style={plainIcon}
        >
          <Icon name={mobileOpen ? 'close' : 'menu'} size={20} />
        </button>

        {!collapsed && (
          <button
            className="sidebar-desktop-collapse tafiti-sidebar-collapse"
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            style={plainIcon}
          >
            <Icon name="left_panel_close" size={16} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          className="sidebar-desktop-collapse tafiti-sidebar-expand"
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          style={plainIcon}
        >
          <Icon name="left_panel_open" size={18} />
        </button>
      )}

      {!collapsed && (
        <div className="sidebar-property tafiti-sidebar-property">
          <button
            onClick={branchLocked || !isAdministrator ? undefined : app.toggleBranch}
            className="tafiti-property-trigger"
            style={{ cursor: branchLocked || !isAdministrator ? 'default' : 'pointer' }}
          >
            <Icon name={role === 'store keeper' ? 'warehouse' : 'business'} size={16} />
            <span className="tafiti-property-copy">
              <span className="tafiti-property-label">
                {role === 'store keeper' ? 'Store / property' : app.user.departmentName ? 'Department' : 'Property'}
              </span>
              <span className="tafiti-property-value">{contextLabel || 'Current property'}</span>
            </span>
            {isAdministrator && !branchLocked && <Icon name="unfold_more" size={15} />}
          </button>

          {app.branchOpen && <>
            <div onClick={app.closePop} className="tafiti-popover-backdrop" />
            <div className="tafiti-branch-menu">
              {branches.map((branch) => (
                <button
                  key={branch.id}
                  onClick={() => app.selectBranch(String(branch.name))}
                  className="hover-surface2 tafiti-branch-option"
                >
                  {branch.name}
                </button>
              ))}
            </div>
          </>}
        </div>
      )}

      <nav className="sidebar-nav tafiti-sidebar-nav">
        {groups.map((group, groupIndex) => (
          <div
            key={group.heading}
            className="sidebar-nav-group tafiti-sidebar-nav-group"
            data-group-index={groupIndex}
          >
            {!collapsed && <div className="sidebar-nav-heading">{group.heading}</div>}

            {group.items.map((item) => {
              const active = app.navActive === item.route || (item.route === 'uoms' && app.navActive === 'itemUnits')
              return (
                <button
                  key={item.route}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    app.navTo(item.route, item.label)
                    setMobileOpen(false)
                  }}
                  className={`sidebar-nav-item tafiti-sidebar-nav-item ${active ? 'active' : 'hover-surface2'}`}
                  style={navStyle(active)}
                >
                  <Icon name={navIcons[item.route] || 'chevron_right'} size={15} weight={300} />
                  {!collapsed && <span className="tafiti-sidebar-nav-label">{item.label}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer tafiti-sidebar-footer">
        {canSwitchModules(app.user) && (
          <button
            onClick={app.gotoModules}
            title="Switch module"
            className="hover-surface2 tafiti-module-switch"
            style={{ ...navStyle(false), justifyContent: collapsed ? 'center' : undefined }}
          >
            <Icon name="apps" size={17} />
            {!collapsed && <span>Switch module</span>}
          </button>
        )}

        {!collapsed && (
          <div className="tafiti-sidebar-user">
            <Avatar
              className="sidebar-user-avatar"
              src={app.user.photoUrl}
              name={app.user.name}
              size={30}
              radius={7}
            />
            <div className="tafiti-sidebar-user-copy">
              <div className="tafiti-sidebar-user-name">{app.user.name}</div>
              <div className="tafiti-sidebar-user-role">{app.user.role}</div>
            </div>
            <button onClick={app.logout} title="Sign out" aria-label="Sign out" style={plainIcon}>
              <Icon name="logout" size={15} />
            </button>
          </div>
        )}
      </div>
    </aside>
  </>
}

const plainIcon: CSSProperties = {
  width: 26,
  height: 26,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  display: 'grid',
  placeItems: 'center',
  color: 'var(--text-faint)',
  cursor: 'pointer',
}
