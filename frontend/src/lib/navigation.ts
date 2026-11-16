/**
 * Shareable workspace URLs for existing operational screens.
 * Document details and report previews deliberately stay in application
 * state until their backend-backed deep-link contracts are defined.
 */
export const workspaceRoutes = [
  'dashboard', 'hr-dashboard', 'workflow-stores', 'workflow-procure',
  'workflow-pay', 'workflow-consume', 'workflow-configure',
  'waste-control', 'recipes-production', 'pos-control',
  'finance-governance', 'integration-control',
  'new-store-request', 'incoming-pickup', 'approval-inbox', 'menu-engineering',
  'grn-posting', 'transfer-dispatch',
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

/**
 * Semantic, bookmarkable Next.js URLs with backward compatibility for the
 * existing /workspace/:section paths.
 */
const semanticPaths: Partial<Record<WorkspaceRoute, string>> = {
  dashboard: '/dashboard',
  'workflow-stores': '/transfers/requisitions',
  'grn-posting': '/stores/grn-posting',
  'transfer-dispatch': '/stores/transfers',
  'new-store-request': '/transfers/requisitions/new',
  'incoming-pickup': '/transfers/incoming',
  'approval-inbox': '/approvals',
  'store-transfers': '/transfers/manage',
  'stock-on-hand': '/inventory/stock-on-hand',
  'store-inventory': '/stocktake/control',
  'store-purchase-requests': '/inventory/reorder',
  'waste-control': '/adjustments/waste',
  'recipes-production': '/recipes',
  'pos-control': '/pos/reconciliation',
  'workflow-procure': '/purchasing/workbench',
  'workflow-pay': '/finance/invoice-matching',
  'finance-governance': '/finance/period-close',
  'integration-control': '/admin/integrations',
  supplierItems: '/purchasing/quotes',
  suppliers: '/vendors',
  orders: '/purchasing/orders',
  grns: '/receiving/grns',
  supplierReturns: '/receiving/returns',
  reports: '/reports',
  'menu-engineering': '/reports/menu-engineering',
  items: '/admin/articles',
  categories: '/admin/article-groups',
  uoms: '/admin/units',
  itemUnits: '/admin/unit-conversions',
  locations: '/admin/stores',
  'access-management': '/admin/users',
  'audit-log': '/admin/audit',
  'hotel-profile': '/admin/property',
  'workflow-configure': '/admin/workflow',
}
const semanticLookup = new Map(
  Object.entries(semanticPaths).map(([route, path]) => [path, route as WorkspaceRoute]),
)
const routeAliases: Record<string, WorkspaceRoute> = {
  '/adjustments/waste/new': 'waste-control',
  '/finance/budgets': 'finance-governance',
  '/purchasing/requisitions/new': 'workflow-procure',
  '/receiving/returns/new': 'supplierReturns',
  '/purchasing/requisitions': 'workflow-procure',
  '/admin/roles': 'access-management',
}

export function routeFromPath(pathname: string): WorkspaceRoute | null {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const legacy = /^\/workspace\/([A-Za-z0-9-]+)$/.exec(normalized)
  if (legacy) return registeredRoutes.has(legacy[1]) ? legacy[1] as WorkspaceRoute : null
  const exact = semanticLookup.get(normalized) || routeAliases[normalized]
  if (exact) return exact
  if (/^\/purchasing\/orders\/[^/]+$/.test(normalized)) return 'workflow-procure'
  if (/^\/receiving\/po\/[^/]+$/.test(normalized)) return 'workflow-procure'
  if (/^\/recipes\/[^/]+$/.test(normalized)) return 'recipes-production'
  if (/^\/stocktake\/[^/]+$/.test(normalized)) return 'store-inventory'
  return null
}

export function pathForRoute(route: string): string | null {
  if (!registeredRoutes.has(route)) return null
  return semanticPaths[route as WorkspaceRoute] || `/workspace/${route}`
}

export function labelForRoute(route: string): string {
  const special: Record<string, string> = {
    dashboard: 'Overview',
    'new-store-request': 'New internal requisition',
    'incoming-pickup': 'Confirm pickup',
    'grn-posting': 'Post received GRNs',
    'transfer-dispatch': 'Transfer fulfillment',
    'approval-inbox': 'Approval inbox',
    'menu-engineering': 'Menu sales analysis',
    'hr-dashboard': 'People overview',
    'workflow-stores': 'Stores workflow',
    'workflow-procure': 'Procurement',
    'workflow-pay': 'Finance',
    'waste-control': 'Waste control',
    'recipes-production': 'Recipe costing',
    'pos-control': 'POS depletion',
    'finance-governance': 'Budgets & close',
    'integration-control': 'Integrations',
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
