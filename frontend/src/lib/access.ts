export interface AccessUser { role: string; isSuperuser: boolean; permissions: string[] }

const routePermissions: Record<string, string[]> = {
  items: ['inventory.view_item'], categories: ['inventory.view_category'], uoms: ['inventory.view_unitofmeasure', 'inventory.view_itemunitprice'], itemUnits: ['inventory.view_itemunitprice'],
  locations: ['inventory.view_storelocation'], balances: ['inventory.view_inventorybalance'], ledgers: ['inventory.view_stockledger'], batches: ['inventory.view_inventorybatch'], reorderRules: ['inventory.view_reorderrule'],
  storeRequisitions: ['inventory.view_storerequisition'], stockIssues: ['inventory.view_stockissue'], storeReturns: ['inventory.view_storereturn'],
  'workflow-stores': ['inventory.view_storerequisition'], 'store-purchase-requests': ['inventory.view_storekeeperassignment', 'inventory.view_item'], 'workflow-consume': ['inventory.view_storerequisition', 'inventory.view_stockissue'],
  suppliers: ['vendors.view_supplier'], supplierItems: ['inventory.view_supplieritemprice'], requisitions: ['procurement.view_purchaserequisition'], orders: ['procurement.view_purchaseorder'], grns: ['procurement.view_goodsreceiptnote'], inspections: ['procurement.view_goodsinspection'], supplierReturns: ['procurement.view_supplierreturn'],
  'workflow-procure': ['procurement.view_purchaserequisition', 'inventory.view_supplieritemprice', 'procurement.view_purchaseorder', 'procurement.view_goodsreceiptnote'], approvals: ['approvals.view_approvalworkflow'],
  'workflow-pay': ['finance.view_supplierinvoice', 'finance.view_supplierpayment', 'finance.view_expense', 'finance.view_cashflow'], employees: ['employees.view_employee'], departments: ['departments.view_department'], 'hr-dashboard': ['employees.view_employee', 'departments.view_department'],
  reports: ['inventory.view_inventorybalance', 'inventory.view_stockledger', 'procurement.view_purchaseorder', 'inventory.view_storerequisition'], reportview: ['inventory.view_inventorybalance', 'inventory.view_stockledger', 'procurement.view_purchaseorder', 'inventory.view_storerequisition'],
  'audit-log': ['audit_logs.view_auditlog'], 'access-management': ['accounts.view_user', 'auth.view_group'], 'hotel-profile': ['organization.view_hotel'],
}
const hrApps = new Set(['employees', 'departments', 'accounts'])
const strictRoleRoutes: Record<string, Set<string>> = {
  'department supervisor': new Set(['dashboard', 'detail', 'workflow-stores']),
  supervisor: new Set(['dashboard', 'detail', 'workflow-stores']),
  'department head': new Set(['dashboard', 'detail', 'workflow-stores', 'reports', 'reportview']),
  'store keeper': new Set(['dashboard', 'detail', 'workflow-stores', 'store-purchase-requests', 'reports', 'reportview']),
  'cost controller': new Set(['dashboard', 'detail', 'workflow-stores', 'items', 'categories', 'uoms', 'itemUnits', 'suppliers', 'supplierItems', 'reports', 'reportview']),
  'procurement manager': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
  'procurement officer': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
  'financial manager': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
  'general manager': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
  'receiving clerk': new Set(['dashboard', 'detail', 'workflow-procure', 'reports', 'reportview']),
}

export const roleReportIds: Record<string, string[]> = {
  'department head': ['departmentRequests', 'storeIssues'],
  'store keeper': ['departmentRequests', 'storeIssues', 'valuation', 'lowstock', 'movement', 'aging', 'consumption', 'stockMovementControl', 'goodsReceipts'],
  'cost controller': ['departmentRequests', 'lowstock', 'procurement', 'supplierPriceChanges', 'supplier'],
  'procurement manager': ['purchaseRequisitions', 'procurement', 'purchaseOrders', 'goodsReceipts', 'pendingActions', 'exceptions', 'approvalTrail', 'supplierPriceChanges', 'directWorkspace', 'supplier'],
  'procurement officer': ['purchaseRequisitions', 'procurement', 'purchaseOrders', 'goodsReceipts', 'pendingActions', 'exceptions', 'approvalTrail', 'supplierPriceChanges', 'directWorkspace', 'supplier'],
  'financial manager': ['procurement', 'purchaseOrders', 'goodsReceipts', 'pendingActions', 'exceptions', 'approvalTrail', 'managementSummary'],
  'general manager': ['managementSummary', 'procurement', 'purchaseOrders', 'goodsReceipts', 'valuation', 'consumption', 'pendingActions', 'exceptions', 'approvalTrail'],
  'receiving clerk': ['purchaseOrders', 'goodsReceipts', 'pendingActions', 'exceptions', 'directWorkspace'],
}
function roleKey(user: Pick<AccessUser, 'role'>) { return user.role.trim().toLowerCase() }
export function reportIdsForUser(user: AccessUser): string[] { if (user.isSuperuser || roleKey(user) === 'system administrator') return ['*']; return roleReportIds[roleKey(user)] || [] }
export function canViewReport(user: AccessUser, reportId: string): boolean { const allowed=reportIdsForUser(user); return allowed.includes('*') || allowed.includes(reportId) }
export function hasReportAccess(user: AccessUser): boolean { const allowed=reportIdsForUser(user); return allowed.includes('*') || allowed.length>0 }
export function isStoresManager(user: Pick<AccessUser,'role'>): boolean { return roleKey(user)==='store keeper' }
export function canAccessRoute(user: AccessUser, route: string): boolean {
  const role=roleKey(user); if(user.isSuperuser||role==='system administrator') return true
  const strict=strictRoleRoutes[role]; if(strict&&!strict.has(route)) return false
  if(route==='workflow-stores'&&!['department supervisor','supervisor','department head','cost controller','store keeper'].includes(role)) return false
  if(route==='store-purchase-requests'&&role!=='store keeper') return false
  if(route==='storeRequisitions') return false
  if(route==='dashboard'||route==='detail') return true
  if(route==='reports'||route==='reportview') return hasReportAccess(user)
  const required=routePermissions[route]; return required?required.some(p=>user.permissions.includes(p)):false
}
export function canAccessModule(user: AccessUser,module:'operations'|'hr'):boolean{if(user.isSuperuser||roleKey(user)==='system administrator')return true;const hasHR=user.permissions.some(p=>hrApps.has(p.split('.')[0]));const hasOperations=user.permissions.some(p=>!hrApps.has(p.split('.')[0]));return module==='hr'?hasHR:hasOperations||!user.permissions.length}
export function operationsLandingFor(user: AccessUser):{route:string;crumb:string}{const role=roleKey(user);const map:Record<string,{route:string;crumb:string}>={
  'department supervisor':{route:'workflow-stores',crumb:'Department requests'},supervisor:{route:'workflow-stores',crumb:'Department requests'},'department head':{route:'workflow-stores',crumb:'Department approvals'},'store keeper':{route:'workflow-stores',crumb:'Stores control'},'cost controller':{route:'workflow-stores',crumb:'Cost Control approvals'},'procurement manager':{route:'dashboard',crumb:'Procurement dashboard'},'financial manager':{route:'dashboard',crumb:'Financial approvals dashboard'},'general manager':{route:'dashboard',crumb:'Final approvals dashboard'},'receiving clerk':{route:'workflow-procure',crumb:'Receiving & GRN'}};const preferred=map[role];if(preferred&&canAccessRoute(user,preferred.route))return preferred;const candidates=[['workflow-procure','Procurement to receiving'],['workflow-pay','Supplier invoices & payment'],['requisitions','Purchase requisitions']];const match=candidates.find(([r])=>canAccessRoute(user,r));return match?{route:match[0],crumb:match[1]}:{route:'dashboard',crumb:'Operations dashboard'}}
export function canSwitchModules(user:AccessUser):boolean{const admin=user.isSuperuser||roleKey(user)==='system administrator';return admin&&canAccessModule(user,'operations')&&canAccessModule(user,'hr')}
export function canSwitchBranches(user:AccessUser):boolean{return user.isSuperuser||roleKey(user)==='system administrator'||user.permissions.includes('departments.change_branch')}
