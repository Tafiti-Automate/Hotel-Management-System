export interface AccessUser {
  role: string
  isSuperuser: boolean
  permissions: string[]
}

const roleRoutes: Record<string, Set<string>> = {
  'stores manager': new Set([
    'dashboard',
    'items', 'categories', 'uoms', 'locations', 'balances', 'ledgers', 'batches', 'reorderRules',
    'storeRequisitions', 'stockIssues', 'storeReturns', 'workflow-stores', 'workflow-consume',
    'grns', 'inspections', 'supplierReturns', 'suppliers', 'supplierItems', 'reports', 'reportview',
  ]),
  'store manager': new Set([
    'dashboard',
    'items', 'categories', 'uoms', 'locations', 'balances', 'ledgers', 'batches', 'reorderRules',
    'storeRequisitions', 'stockIssues', 'storeReturns', 'workflow-stores', 'workflow-consume',
    'grns', 'inspections', 'supplierReturns', 'suppliers', 'supplierItems', 'reports', 'reportview',
  ]),
  'store keeper': new Set([
    'dashboard',
    'items', 'uoms', 'locations', 'balances', 'ledgers', 'batches',
    'storeRequisitions', 'stockIssues', 'storeReturns', 'workflow-stores', 'workflow-consume',
    'reports', 'reportview',
  ]),
  'procurement manager': new Set([
    'dashboard',
    'requisitions', 'workflow-procure', 'orders', 'grns', 'approvals',
    'items', 'uoms', 'locations', 'balances', 'ledgers', 'batches', 'reorderRules',
    'suppliers', 'supplierItems', 'inspections', 'supplierReturns',
    'reports', 'reportview', 'detail',
  ]),
  'finance controller': new Set([
    'dashboard',
    'workflow-pay', 'requisitions', 'approvals', 'orders',
    'locations', 'balances', 'ledgers', 'suppliers',
    'reports', 'reportview', 'detail',
  ]),
  'department head': new Set([
    'dashboard',
    'requisitions', 'workflow-procure', 'approvals', 'storeRequisitions',
    'items', 'locations', 'balances', 'ledgers',
    'reports', 'reportview', 'detail',
  ]),
  'receiving officer': new Set([
    'dashboard',
    'workflow-procure', 'orders', 'grns', 'inspections', 'supplierReturns',
    'items', 'uoms', 'locations', 'balances', 'ledgers', 'batches', 'suppliers',
    'reports', 'reportview',
  ]),
  'general manager': new Set([
    'dashboard',
    'requisitions', 'approvals', 'orders', 'grns', 'workflow-stores',
    'items', 'categories', 'uoms', 'locations', 'balances', 'ledgers', 'batches',
    'storeRequisitions', 'stockIssues', 'storeReturns',
    'suppliers', 'supplierItems', 'inspections', 'supplierReturns',
    'reports', 'reportview', 'detail',
    'hr-dashboard', 'employees', 'departments',
  ]),
  auditor: new Set([
    'dashboard',
    'requisitions', 'approvals', 'orders', 'grns',
    'items', 'categories', 'uoms', 'locations', 'balances', 'ledgers', 'batches', 'reorderRules',
    'storeRequisitions', 'stockIssues', 'storeReturns',
    'suppliers', 'supplierItems', 'inspections', 'supplierReturns',
    'reports', 'reportview', 'detail',
    'hr-dashboard', 'employees', 'departments',
  ]),
}

const operationsLanding: Record<string, { route: string; crumb: string }> = {
  'stores manager': { route: 'dashboard', crumb: 'Stores overview' },
  'store manager': { route: 'dashboard', crumb: 'Stores overview' },
  'store keeper': { route: 'workflow-stores', crumb: 'Stores workbench' },
  'procurement manager': { route: 'workflow-procure', crumb: 'Procurement workbench' },
  'finance controller': { route: 'workflow-pay', crumb: 'Finance control centre' },
  'department head': { route: 'requisitions', crumb: 'Purchase requisitions' },
  'receiving officer': { route: 'workflow-procure', crumb: 'Receiving workbench' },
  'general manager': { route: 'dashboard', crumb: 'Operations dashboard' },
  auditor: { route: 'dashboard', crumb: 'Operations dashboard' },
}

const hrRoles = new Set(['system administrator', 'general manager', 'auditor'])

function roleKey(user: Pick<AccessUser, 'role'>): string {
  return user.role.trim().toLowerCase()
}

export function isStoresManager(user: Pick<AccessUser, 'role'>): boolean {
  return ['stores manager', 'store manager'].includes(roleKey(user))
}

export function canAccessRoute(user: AccessUser, route: string): boolean {
  if (user.isSuperuser || roleKey(user) === 'system administrator') return true
  const routes = roleRoutes[roleKey(user)]
  return routes ? routes.has(route) : route === 'dashboard'
}

export function canAccessModule(user: AccessUser, module: 'operations' | 'hr'): boolean {
  if (user.isSuperuser || roleKey(user) === 'system administrator') return true
  return module === 'operations' || hrRoles.has(roleKey(user))
}

export function operationsLandingFor(user: AccessUser): { route: string; crumb: string } {
  return operationsLanding[roleKey(user)] || { route: 'dashboard', crumb: 'Operations dashboard' }
}

export function canSwitchModules(user: AccessUser): boolean {
  return canAccessModule(user, 'operations') && canAccessModule(user, 'hr')
}

export function canSwitchBranches(user: AccessUser): boolean {
  return user.isSuperuser || ['system administrator', 'general manager', 'auditor'].includes(roleKey(user))
}
