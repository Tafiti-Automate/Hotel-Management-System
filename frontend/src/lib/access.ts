export interface AccessUser {
  role: string
  isSuperuser: boolean
  permissions: string[]
}

const routePermissions: Record<string, string[]> = {
  items: ['inventory.view_item'],
  categories: ['inventory.view_category'],
  uoms: ['inventory.view_unitofmeasure', 'inventory.view_itemunitprice'],
  itemUnits: ['inventory.view_itemunitprice'],
  locations: ['inventory.view_storelocation'],
  balances: ['inventory.view_inventorybalance'],
  ledgers: ['inventory.view_stockledger'],
  batches: ['inventory.view_inventorybatch'],
  reorderRules: ['inventory.view_reorderrule'],
  storeRequisitions: ['inventory.view_storerequisition'],
  stockIssues: ['inventory.view_stockissue'],
  storeReturns: ['inventory.view_storereturn'],
  'workflow-stores': ['inventory.view_storerequisition', 'inventory.view_stocktransfer', 'inventory.view_stockcount'],
  'store-purchase-requests': ['inventory.view_storekeeperassignment', 'inventory.view_item'],
  'workflow-consume': ['inventory.view_storerequisition', 'inventory.view_stockissue'],
  suppliers: ['vendors.view_supplier'],
  supplierItems: ['inventory.view_supplieritemprice'],
  requisitions: ['procurement.view_purchaserequisition'],
  orders: ['procurement.view_purchaseorder'],
  grns: ['procurement.view_goodsreceiptnote'],
  inspections: ['procurement.view_goodsinspection'],
  supplierReturns: ['procurement.view_supplierreturn'],
  'workflow-procure': ['procurement.view_purchaserequisition', 'inventory.view_supplieritemprice', 'procurement.view_purchaseorder', 'procurement.view_goodsreceiptnote'],
  approvals: ['approvals.view_approvalworkflow'],
  'workflow-pay': ['finance.view_supplierinvoice', 'finance.view_supplierpayment', 'finance.view_expense', 'finance.view_cashflow'],
  employees: ['employees.view_employee'],
  departments: ['departments.view_department'],
  'hr-dashboard': ['employees.view_employee', 'departments.view_department'],
  reports: ['inventory.view_inventorybalance', 'inventory.view_stockledger', 'procurement.view_purchaseorder'],
  reportview: ['inventory.view_inventorybalance', 'inventory.view_stockledger', 'procurement.view_purchaseorder'],
  'audit-log': ['audit_logs.view_auditlog'],
  'access-management': ['accounts.view_user', 'auth.view_group'],
  'hotel-profile': ['organization.view_hotel'],
}

const hrApps = new Set(['employees', 'departments', 'accounts'])

const strictRoleRoutes: Record<string, Set<string>> = {
  requester: new Set(['dashboard', 'detail', 'workflow-stores', 'reports', 'reportview']),
  'department head': new Set(['dashboard', 'detail', 'workflow-stores', 'reports', 'reportview']),
  'store keeper': new Set(['dashboard', 'detail', 'workflow-stores', 'store-purchase-requests', 'reports', 'reportview']),
  'cost controller': new Set(['dashboard', 'detail', 'items', 'categories', 'uoms', 'itemUnits', 'suppliers', 'supplierItems', 'reports', 'reportview']),
  'procurement manager': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
  'procurement officer': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
  'financial manager': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
  'general manager': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
  'receiving clerk': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
}



export const roleReportIds: Record<string, string[]> = {
  requester: ['departmentRequests', 'storeIssues'],
  'department head': ['departmentRequests', 'storeIssues'],
  'store keeper': [
    'departmentRequests', 'storeIssues', 'valuation', 'lowstock', 'movement', 'aging',
    'consumption', 'stockMovementControl', 'goodsReceipts',
  ],
  'cost controller': ['lowstock', 'procurement', 'supplierPriceChanges', 'supplier'],
  'procurement manager': [
    'purchaseRequisitions', 'procurement', 'purchaseOrders', 'goodsReceipts', 'pendingActions',
    'exceptions', 'approvalTrail', 'supplierPriceChanges', 'directWorkspace', 'supplier',
  ],
  'procurement officer': [
    'purchaseRequisitions', 'procurement', 'purchaseOrders', 'goodsReceipts', 'pendingActions',
    'exceptions', 'approvalTrail', 'supplierPriceChanges', 'directWorkspace', 'supplier',
  ],
  'financial manager': [
    'procurement', 'purchaseOrders', 'goodsReceipts', 'pendingActions', 'exceptions',
    'approvalTrail', 'managementSummary',
  ],
  'general manager': [
    'managementSummary', 'procurement', 'purchaseOrders', 'goodsReceipts', 'valuation',
    'consumption', 'pendingActions', 'exceptions', 'approvalTrail',
  ],
  'receiving clerk': ['purchaseOrders', 'goodsReceipts', 'pendingActions', 'exceptions', 'directWorkspace'],
}

export function reportIdsForUser(user: AccessUser): string[] {
  if (user.isSuperuser || roleKey(user) === 'system administrator') return ['*']
  return roleReportIds[roleKey(user)] || []
}

export function canViewReport(user: AccessUser, reportId: string): boolean {
  const allowed = reportIdsForUser(user)
  return allowed.includes('*') || allowed.includes(reportId)
}

export function hasReportAccess(user: AccessUser): boolean {
  const allowed = reportIdsForUser(user)
  return allowed.includes('*') || allowed.length > 0
}

function roleKey(user: Pick<AccessUser, 'role'>): string {
  return user.role.trim().toLowerCase()
}

export function isStoresManager(user: Pick<AccessUser, 'role'>): boolean {
  return roleKey(user) === 'store keeper'
}

export function canAccessRoute(user: AccessUser, route: string): boolean {
  if (user.isSuperuser || roleKey(user) === 'system administrator') return true
  const strict = strictRoleRoutes[roleKey(user)]
  if (strict && !strict.has(route)) return false
  // Store Keepers work only from the predecessor-driven Stores workflow.
  // The generic Store Requisitions CRUD page belongs to department requesters
  // and must never expose a create action to Stores.
  if (roleKey(user) === 'store keeper' && route === 'storeRequisitions') return false
  // Workflow routes are role boundaries, not only permission checks. This prevents
  // Finance/Management users who happen to inherit inventory permissions from
  // landing in Department/Stores queues.
  const role = roleKey(user)
  if (route === 'workflow-stores' && !['department head', 'store keeper', 'requester'].includes(role)) return false
  if (route === 'store-purchase-requests' && role !== 'store keeper') return false
  if (route === 'storeRequisitions' && role !== 'requester') return false
  if (route === 'dashboard' || route === 'detail') return true
  if (route === 'reports' || route === 'reportview') return hasReportAccess(user)
  const required = routePermissions[route]
  return required ? required.some((permission) => user.permissions.includes(permission)) : false
}

export function canAccessModule(user: AccessUser, module: 'operations' | 'hr'): boolean {
  if (user.isSuperuser || roleKey(user) === 'system administrator') return true
  const hasHR = user.permissions.some((permission) => hrApps.has(permission.split('.')[0]))
  const hasOperations = user.permissions.some((permission) => !hrApps.has(permission.split('.')[0]))
  return module === 'hr' ? hasHR : hasOperations || !user.permissions.length
}

export function operationsLandingFor(user: AccessUser): { route: string; crumb: string } {
  const role = roleKey(user)
  const roleLanding: Record<string, { route: string; crumb: string }> = {
    requester: { route: 'dashboard', crumb: 'My requisitions dashboard' },
    'department head': { route: 'dashboard', crumb: 'Department approvals dashboard' },
    'store keeper': { route: 'dashboard', crumb: 'Store Keeper dashboard' },
    'cost controller': { route: 'dashboard', crumb: 'Cost Controller dashboard' },
    'procurement manager': { route: 'dashboard', crumb: 'Procurement dashboard' },
    'financial manager': { route: 'dashboard', crumb: 'Financial approvals dashboard' },
    'general manager': { route: 'dashboard', crumb: 'Final approvals dashboard' },
    'receiving clerk': { route: 'dashboard', crumb: 'Receiving dashboard' },
  }
  const preferred = roleLanding[role]
  if (preferred && canAccessRoute(user, preferred.route)) return preferred
  const candidates = [
    ['workflow-procure', 'Procurement to receiving'],
    ['workflow-pay', 'Supplier invoices & payment'],
    ['requisitions', 'Purchase requisitions'],
  ]
  const match = candidates.find(([route]) => canAccessRoute(user, route))
  return match ? { route: match[0], crumb: match[1] } : { route: 'dashboard', crumb: 'Operations dashboard' }
}

export function canSwitchModules(user: AccessUser): boolean {
  const administrator = user.isSuperuser || roleKey(user) === 'system administrator'
  return administrator && canAccessModule(user, 'operations') && canAccessModule(user, 'hr')
}

export function canSwitchBranches(user: AccessUser): boolean {
  return user.isSuperuser || roleKey(user) === 'system administrator' || user.permissions.includes('departments.change_branch')
}
