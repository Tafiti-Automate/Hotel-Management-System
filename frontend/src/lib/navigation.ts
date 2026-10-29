/**
 * Shareable workspace URLs for existing operational screens.
 * Document details and report previews deliberately stay in application
 * state until their backend-backed deep-link contracts are defined.
 */
export const workspaceRoutes = [
  'dashboard', 'hr-dashboard', 'workflow-stores', 'workflow-procure',
  'workflow-pay', 'workflow-consume', 'workflow-configure',
  'stock-on-hand', 'store-transfers', 'store-inventory',
  'store-analysis', 'store-usage', 'store-purchase-requests',
  'items', 'categories', 'uoms', 'itemUnits', 'locations',
  'suppliers', 'supplierItems', 'departments', 'employees',
  'balances', 'ledgers', 'batches', 'reorderRules',
  'storeRequisitions', 'stockIssues', 'storeReturns',
  'requisitions', 'approvals', 'orders', 'grns',
  'inspections', 'supplierReturns', 'reports',
  'audit-log', 'access-management', 'hotel-profile',
] as const

export type WorkspaceRoute = (typeof workspaceRoutes)[number]

const registeredRoutes = new Set<string>(workspaceRoutes)

export function routeFromPath(pathname: string): WorkspaceRoute | null {
  const match = /^\/workspace\/([A-Za-z0-9-]+)\/?$/.exec(pathname)
  if (!match) return null
  const route = match[1]
  return registeredRoutes.has(route) ? route as WorkspaceRoute : null
}

export function pathForRoute(route: string): string | null {
  return registeredRoutes.has(route) ? `/workspace/${route}` : null
}

export function labelForRoute(route: string): string {
  const special: Record<string, string> = {
    dashboard: 'Overview',
    'hr-dashboard': 'People overview',
    'workflow-stores': 'Stores workflow',
    'workflow-procure': 'Procurement',
    'workflow-pay': 'Finance',
    'stock-on-hand': 'Stock on hand',
    'store-inventory': 'Manage inventory',
    'store-transfers': 'Stock transfers',
    'store-purchase-requests': 'Purchase requests',
    supplierItems: 'Supplier quotations',
    itemUnits: 'Item conversions',
    uoms: 'Units of measure',
    grns: 'Goods received',
    'audit-log': 'Audit trail',
    'access-management': 'User access',
    'hotel-profile': 'Hotel settings',
  }
  return special[route] || route.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/-/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}
