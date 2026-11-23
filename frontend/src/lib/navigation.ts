/**
 * Shareable workspace URLs for existing operational screens.
 * Document details and report previews deliberately stay in application
 * state until their backend-backed deep-link contracts are defined.
 */
export const workspaceRoutes = [
  'dashboard', 'hr-dashboard', 'hr-payroll', 'hr-affectors', 'hr-advances', 'hr-attendance', 'hr-shifts', 'hr-leave', 'hr-calendar', 'hr-documents', 'front-desk-reservations', 'front-desk-rooms', 'bar-pos', 'workflow-stores', 'workflow-procure',
  'workflow-pay', 'workflow-consume', 'workflow-configure',
  'waste-control', 'recipes-production', 'pos-control',
  'finance-governance', 'integration-control',
  'new-store-request', 'incoming-pickup', 'approval-inbox', 'menu-engineering',
  'grn-posting', 'transfer-dispatch',
  'purchasing-workbench', 'purchasing-quotes', 'purchasing-order-detail',
  'purchasing-pr-new', 'receiving-po-detail', 'receiving-return-new', 'department-returns-new',
  'finance-invoice-matching', 'finance-budgets', 'finance-period-close',
  'admin-cost-centers', 'admin-authorisation-rules', 'admin-articles',
  'stocktake-sheet', 'stocktake-variance', 'recipes-detail',
  'pos-reconciliation', 'waste-new',
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
  'hr-dashboard': '/hr',
  'hr-payroll': '/hr/payroll',
  'hr-affectors': '/hr/payroll/affectors',
  'hr-advances': '/hr/payroll/advances',
  'hr-attendance': '/hr/attendance',
  'hr-shifts': '/hr/shifts',
  'hr-leave': '/hr/leave',
  'hr-calendar': '/hr/leave/calendar',
  'hr-documents': '/hr/documents',
  'front-desk-reservations': '/front-desk/reservations',
  'front-desk-rooms': '/front-desk/rooms',
  'bar-pos': '/bar/pos',
  'workflow-stores': '/transfers/requisitions',
  'purchasing-workbench': '/purchasing/workbench',
  'purchasing-quotes': '/purchasing/quotes',
  'purchasing-pr-new': '/purchasing/requisitions/new',
  'purchasing-order-detail': '/purchasing/orders',
  'receiving-po-detail': '/receiving/po',
  'receiving-return-new': '/stores/supplier-returns/new',
  'department-returns-new': '/stores/department-returns/new',
  'finance-invoice-matching': '/finance/invoice-matching',
  'finance-budgets': '/finance/budgets',
  'finance-period-close': '/finance/period-close',
  'admin-cost-centers': '/admin/cost-centers',
  'admin-authorisation-rules': '/admin/authorisation-rules',
  'admin-articles': '/admin/articles',
  'stocktake-sheet': '/stocktake/counts',
  'stocktake-variance': '/stocktake/variance',
  'recipes-detail': '/recipes/detail',
  'pos-reconciliation': '/pos/reconciliation',
  'waste-new': '/adjustments/waste/new',
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
  'pos-control': '/pos/manage',
  'workflow-procure': '/purchasing',
  'workflow-pay': '/finance',
  'finance-governance': '/finance/governance',
  'integration-control': '/admin/integrations',
  supplierItems: '/admin/price-quotations',
  suppliers: '/vendors',
  orders: '/purchasing/orders',
  grns: '/receiving/grns',
  supplierReturns: '/stores/supplier-returns',
  reports: '/reports',
  'menu-engineering': '/reports/menu-engineering',
  items: '/admin/articles/catalogue',
  categories: '/admin/article-groups',
  uoms: '/admin/units',
  itemUnits: '/admin/unit-conversions',
  locations: '/admin/stores',
  'access-management': '/admin/users',
  'audit-log': '/admin/audit-logs',
  'hotel-profile': '/admin/property',
  'workflow-configure': '/admin/workflow',
}
const semanticLookup = new Map(
  Object.entries(semanticPaths).map(([route, path]) => [path, route as WorkspaceRoute]),
)
const routeAliases: Record<string, WorkspaceRoute> = {
  '/adjustments/waste': 'waste-control',
  '/admin/audit': 'audit-log',
  '/admin/roles': 'access-management',
  '/purchasing/quotes/catalogue': 'supplierItems',
  '/purchasing/requisitions': 'purchasing-workbench',
}

export function routeFromPath(pathname: string): WorkspaceRoute | null {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const legacy = /^\/workspace\/([A-Za-z0-9-]+)$/.exec(normalized)
  if (legacy) return registeredRoutes.has(legacy[1]) ? legacy[1] as WorkspaceRoute : null
  const exact = semanticLookup.get(normalized) || routeAliases[normalized]
  if (exact) return exact
  if (/^\/purchasing\/orders\/[^/]+$/.test(normalized)) return 'purchasing-order-detail'
  if (/^\/receiving\/po\/[^/]+$/.test(normalized)) return 'receiving-po-detail'
  if (/^\/recipes\/[^/]+$/.test(normalized)) return 'recipes-detail'
  if (/^\/stocktake\/[^/]+\/variance$/.test(normalized)) return 'stocktake-variance'
  if (/^\/stocktake\/[^/]+$/.test(normalized)) return 'stocktake-sheet'
  return null
}

export function pathForRoute(route: string): string | null {
  if (!registeredRoutes.has(route)) return null
  return semanticPaths[route as WorkspaceRoute] || `/workspace/${route}`
}

export function labelForRoute(route: string): string {
  const special: Record<string, string> = {
    dashboard: 'Overview',
    'front-desk-reservations': 'Front desk reservations',
    'bar-pos': 'Bar and restaurant POS',
    'new-store-request': 'New internal requisition',
    'incoming-pickup': 'Confirm pickup',
    'grn-posting': 'Post received GRNs',
    'purchasing-workbench': 'PR to PO workbench',
    'purchasing-quotes': 'Supplier price quotes',
    'purchasing-pr-new': 'New purchase requisition',
    'purchasing-order-detail': 'Purchase order details',
    'receiving-po-detail': 'Blind receiving',
    'receiving-return-new': 'Return to supplier',
    'department-returns-new': 'Department returns',
    'finance-invoice-matching': 'Three-way invoice matching',
    'finance-budgets': 'Cost center budgets',
    'finance-period-close': 'Month-end closing',
    'admin-cost-centers': 'Cost centers and stores',
    'admin-authorisation-rules': 'Authorisation rules',
    'admin-articles': 'Article master',
    'stocktake-sheet': 'Blind stock count',
    'stocktake-variance': 'Variance audit',
    'recipes-detail': 'Recipe details',
    'pos-reconciliation': 'POS reconciliation',
    'waste-new': 'Record waste',
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
