export interface AccessUser {
  role: string
  isSuperuser: boolean
  permissions: string[]
}

const routePermissions: Record<string, string[]> = {
  items: ['inventory.view_item'],
  categories: ['inventory.view_category'],
  uoms: ['inventory.view_unitofmeasure'],
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
  'workflow-consume': ['inventory.view_storerequisition', 'inventory.view_stockissue'],
  suppliers: ['vendors.view_supplier'],
  supplierItems: ['inventory.view_supplieritemprice'],
  requisitions: ['procurement.view_purchaserequisition'],
  orders: ['procurement.view_purchaseorder'],
  grns: ['procurement.view_goodsreceiptnote'],
  inspections: ['procurement.view_goodsinspection'],
  supplierReturns: ['procurement.view_supplierreturn'],
  'workflow-procure': ['procurement.view_purchaserequisition', 'procurement.view_vendorquotation', 'procurement.view_purchaseorder', 'procurement.view_goodsreceiptnote'],
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

function roleKey(user: Pick<AccessUser, 'role'>): string {
  return user.role.trim().toLowerCase()
}

export function isStoresManager(user: Pick<AccessUser, 'role'>): boolean {
  return roleKey(user) === 'store keeper'
}

export function canAccessRoute(user: AccessUser, route: string): boolean {
  if (user.isSuperuser || roleKey(user) === 'system administrator') return true
  if (route === 'dashboard' || route === 'detail') return true
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
  if (roleKey(user) === 'store keeper') {
    return { route: 'dashboard', crumb: 'Store Keeper overview' }
  }
  const candidates = [
    ['workflow-stores', 'Store Requests'],
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
