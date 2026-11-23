import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import { canAccessRoute, canSwitchBranches, canSwitchModules } from '../lib/access'

interface NavItem { route: string; label: string; icon?: string }
interface NavGroup { heading: string; items: NavItem[] }

const roleNavigation: Record<string, NavGroup[]> = {
  receptionist: [{ heading: 'Front office', items: [{ route: 'front-desk-reservations', label: 'Reservations desk', icon: 'hotel' }] }],
  'reservations agent': [{ heading: 'Reservations', items: [{ route: 'front-desk-reservations', label: 'Room availability & bookings', icon: 'event_available' }] }],
  'front office manager': [{ heading: 'Front office', items: [{ route: 'front-desk-reservations', label: 'Reservation management', icon: 'hotel' }] }],
  bartender: [{ heading: 'Bar', items: [{ route: 'bar-pos', label: 'Open bar checks', icon: 'point_of_sale' }] }],
  waiter: [{ heading: 'Restaurant', items: [{ route: 'bar-pos', label: 'Restaurant checks', icon: 'restaurant' }] }],
  cashier: [{ heading: 'Cashier', items: [{ route: 'bar-pos', label: 'POS check register', icon: 'receipt_long' }] }],
  'bar supervisor': [{ heading: 'Bar supervision', items: [{ route: 'bar-pos', label: 'Bar check register', icon: 'point_of_sale' }] }],
  'department supervisor': [
    { heading: 'Department', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'new-store-request', label: 'New store request', icon: 'add_circle' },
      { route: 'workflow-stores', label: 'My requests', icon: 'assignment' },
      { route: 'incoming-pickup', label: 'Confirm pickup', icon: 'fact_check' },
      { route: 'waste-new', label: 'Record waste', icon: 'delete_sweep' },
    ] },
  ],
  supervisor: [
    { heading: 'Department', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'new-store-request', label: 'New store request', icon: 'add_circle' },
      { route: 'workflow-stores', label: 'My requests', icon: 'assignment' },
      { route: 'incoming-pickup', label: 'Confirm pickup', icon: 'fact_check' },
      { route: 'waste-new', label: 'Record waste', icon: 'delete_sweep' },
    ] },
  ],
  'department head': [
    { heading: 'Department', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-stores', label: 'Department request approvals', icon: 'approval' },
      { route: 'waste-control', label: 'Waste review', icon: 'delete_sweep' },
      { route: 'purchasing-pr-new', label: 'New purchase requisition', icon: 'add_shopping_cart' },
      { route: 'market-lists', label: 'Daily Market Lists', icon: 'restaurant' },
      { route: 'recipes-production', label: 'Recipe costing', icon: 'menu_book' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'store keeper': [
    { heading: 'Stores', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },

      { route: 'supplier-return-report', label: 'Report goods for supplier return', icon: 'report_problem' },
      { route: 'department-returns-new', label: 'Department returns', icon: 'assignment_return' },
      { route: 'transfer-dispatch', label: 'Transfer fulfillment', icon: 'local_shipping' },
      { route: 'workflow-stores', label: 'Issue requests', icon: 'inventory' },
      { route: 'store-transfers', label: 'Transfers', icon: 'sync_alt' },
      { route: 'stock-on-hand', label: 'Stock on Hand Control', icon: 'inventory_2' },
      { route: 'locations', label: 'Stores & locations', icon: 'warehouse' },
      { route: 'store-inventory', label: 'Manage inventory', icon: 'fact_check' },
      { route: 'stocktake-sheet', label: 'Physical stocktake', icon: 'playlist_add_check' },
      { route: 'store-purchase-requests', label: 'Purchase requests', icon: 'shopping_cart' },
    ] },
    { heading: 'Insights', items: [
      { route: 'store-usage', label: 'Usage', icon: 'monitoring' },
      { route: 'store-analysis', label: 'Stock analysis', icon: 'bar_chart' },
      { route: 'reports', label: 'All reports', icon: 'description' },
    ] },
  ],
  'cost controller': [
    { heading: 'Supplier returns', items: [
      { route: 'receiving-return-new', label: 'Return to supplier', icon: 'assignment_return' },
    ] },
    { heading: 'Control desk', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'stock-on-hand', label: 'Stock on Hand', icon: 'inventory_2' },
      { route: 'workflow-stores', label: 'Request control', icon: 'fact_check' },
      { route: 'waste-control', label: 'Waste audit', icon: 'delete_sweep' },
      { route: 'recipes-production', label: 'Recipe costing', icon: 'menu_book' },
      { route: 'pos-reconciliation', label: 'POS reconciliation', icon: 'point_of_sale' },
      { route: 'stocktake-sheet', label: 'Stocktake sessions', icon: 'playlist_add_check' },
      { route: 'stocktake-variance', label: 'Stocktake variances', icon: 'analytics' },
      { route: 'menu-engineering', label: 'Menu sales analysis', icon: 'scatter_plot' },
    ] },
    { heading: 'Master data', items: [
      { route: 'suppliers', label: 'Suppliers', icon: 'local_shipping' },
      { route: 'purchasing-quotes', label: 'Supplier quote approvals', icon: 'request_quote' },
      { route: 'supplierItems', label: 'Supplier prices', icon: 'receipt_long' },
      { route: 'locations', label: 'Stores management', icon: 'warehouse' },
      { route: 'departments', label: 'Departments management', icon: 'account_tree' },
      { route: 'categories', label: 'Major & Item Groups', icon: 'category' },
      { route: 'items', label: 'Articles', icon: 'inventory_2' },
      { route: 'uoms', label: 'Units & conversions', icon: 'straighten' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'procurement manager': [
    { heading: 'Procurement', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'purchasing-workbench', label: 'PR-to-PO workbench', icon: 'shopping_cart' },
      { route: 'purchasing-quotes', label: 'Supplier quotes', icon: 'request_quote' },
      { route: 'workflow-procure', label: 'Procurement workflow', icon: 'account_tree' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'procurement officer': [
    { heading: 'Procurement', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'purchasing-workbench', label: 'PR-to-PO workbench', icon: 'shopping_cart' },
      { route: 'purchasing-quotes', label: 'Supplier quotes', icon: 'request_quote' },
      { route: 'workflow-procure', label: 'Procurement workflow', icon: 'account_tree' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'financial manager': [
    { heading: 'Approvals', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'approval-inbox', label: 'Approval inbox', icon: 'approval' },
      { route: 'workflow-procure', label: 'LPO workbench', icon: 'receipt_long' },
      { route: 'workflow-pay', label: 'Invoices & payments', icon: 'payments' },
      { route: 'hr-payroll', label: 'Payroll approval', icon: 'account_balance_wallet' },
      { route: 'finance-budgets', label: 'Monthly budgets', icon: 'table_chart' },
      { route: 'finance-period-close', label: 'Month-end close', icon: 'lock' },
      { route: 'finance-invoice-matching', label: '3-way invoice matching', icon: 'fact_check' },
      { route: 'finance-governance', label: 'Finance governance', icon: 'account_balance' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'accounts payable clerk': [
    { heading: 'Accounts payable', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'finance-invoice-matching', label: '3-way invoice matching', icon: 'fact_check' },
      { route: 'workflow-pay', label: 'Invoices & payments', icon: 'payments' },
    ] },
    { heading: 'Control evidence', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'general manager': [
    { heading: 'Management', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'menu-engineering', label: 'Menu engineering', icon: 'scatter_plot' },
      { route: 'approval-inbox', label: 'Final approvals', icon: 'verified' },
      { route: 'workflow-pay', label: 'Release supplier payments', icon: 'payments' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
  'receiving clerk': [
    { heading: 'Receiving', items: [
      { route: 'dashboard', label: 'Overview', icon: 'space_dashboard' },
      { route: 'workflow-procure', label: 'Receiving & GRN', icon: 'local_shipping' },
      { route: 'receiving-po-detail', label: 'Blind receiving', icon: 'inventory' },
      { route: 'supplier-return-report', label: 'Report rejected goods', icon: 'report_problem' },
    ] },
    { heading: 'Insights', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  ],
}

// Legacy outlet title resolves to the same narrow operational menu.
roleNavigation['outlet supervisor'] = roleNavigation['department supervisor']

const adminNavigation: NavGroup[] = [
  { heading: 'Master data', items: [
    { route:'dashboard', label:'IT dashboard', icon:'space_dashboard' },
    { route:'admin-cost-centers', label:'Cost center / Stores', icon:'warehouse' },
    { route:'admin-articles', label:'Article master', icon:'inventory_2' },
    { route:'admin-authorisation-rules', label:'Authorisation rules', icon:'rule' },
    { route:'uoms', label:'Unit conversions', icon:'straighten' },
    { route:'categories', label:'Item super groups', icon:'category' },
  ] },
  { heading: 'System controls', items: [
    { route:'access-management', label:'Users / Roles', icon:'manage_accounts' },
    { route:'audit-log', label:'Immutable audit', icon:'history' },
    { route:'integration-control', label:'Integrations', icon:'hub' },
    { route:'hotel-profile', label:'Property setup', icon:'settings' },
  ] },
]

const hrNavigation: NavGroup[] = [
  { heading: 'Human resources', items: [
    { route: 'hr-dashboard', label: 'People overview', icon: 'groups' },
    { route: 'employees', label: 'Employee management', icon: 'badge' },
    { route: 'departments', label: 'Departments', icon: 'account_tree' },
  ] },
  { heading: 'Payroll', items: [
    { route: 'hr-payroll', label: 'Payroll management', icon: 'payments' },
    { route: 'hr-affectors', label: 'Payroll affectors', icon: 'tune' },
    { route: 'hr-advances', label: 'Salary advances', icon: 'account_balance_wallet' },
  ] },
  { heading: 'Attendance & shifts', items: [
    { route: 'hr-attendance', label: 'Daily attendance', icon: 'fact_check' },
    { route: 'hr-shifts', label: 'Shift templates', icon: 'schedule' },
  ] },
  { heading: 'Leave & records', items: [
    { route: 'hr-leave', label: 'Leave management', icon: 'event_available' },
    { route: 'hr-calendar', label: 'Leave calendar', icon: 'calendar_month' },
    { route: 'hr-documents', label: 'Documents', icon: 'folder_open' },
  ] },
  { heading: 'Administration', items: [
    { route: 'access-management', label: 'User access', icon: 'manage_accounts' },
  ] },
]

export default function Sidebar() {
  const app = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
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

  const toggleGroup = (heading: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(heading)) next.delete(heading)
      else next.add(heading)
      return next
    })
  }

  useEffect(() => {
    const open = () => setMobileOpen(true)
    window.addEventListener('tafiti-sidebar-open', open)
    return () => window.removeEventListener('tafiti-sidebar-open', open)
  }, [])

  return <>
    {mobileOpen && <button className="neo-sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

    <aside className={`neo-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
      <div className="neo-sidebar-brand">
        <span className="neo-brand-mark"><Icon name="hotel" size={21} color="#D8B46C" /></span>
        {!collapsed && <span className="neo-brand-copy"><strong>HOTEL ERP</strong><small>Materials &amp; Cost Control</small></span>}
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
          aria-expanded={administrator && !branchLocked ? app.branchOpen : undefined}
          aria-haspopup={administrator && !branchLocked ? 'listbox' : undefined}
          disabled={!administrator || branchLocked}
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
        {groups.map((group) => {
          const groupId = `navigation-${group.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
          const groupCollapsed = collapsedGroups.has(group.heading)
          return <section className={`neo-nav-group ${groupCollapsed ? 'is-collapsed' : ''}`} key={group.heading} aria-labelledby={`${groupId}-label`}>
            {!collapsed && <button
              id={`${groupId}-label`}
              type="button"
              className="neo-nav-heading"
              onClick={() => toggleGroup(group.heading)}
              aria-expanded={!groupCollapsed}
              aria-controls={groupId}
            >
              <span>{group.heading}</span>
              <Icon name={groupCollapsed ? 'chevron_right' : 'expand_more'} size={15} />
            </button>}
            <div className="neo-nav-items" id={groupId} hidden={!collapsed && groupCollapsed}>
              {group.items.map((item) => {
                const active = app.navActive === item.route || (item.route === 'uoms' && app.navActive === 'itemUnits')
                return <button
                  type="button"
                  key={item.route}
                  data-route={item.route}
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
          </section>
        })}
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
