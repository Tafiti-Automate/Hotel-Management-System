import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import Dashboard from './DashboardV2'
import { canAccessRoute } from '../lib/access'

const ListView = lazy(() => import('./ListView'))
const DetailView = lazy(() => import('./DetailView'))
const Reports = lazy(() => import('./Reports'))
const ReportView = lazy(() => import('./ReportView'))
const HotelProfile = lazy(() => import('./HotelProfile'))
const WorkflowHub = lazy(() => import('./WorkflowHub'))
const HRDashboard = lazy(() => import('./HRDashboard'))
const ProcurementWorkbench = lazy(() => import('./ProcurementWorkbench'))
const FinancialManagerLpoWorkspace = lazy(() => import('./FinancialManagerLpoWorkspace'))
const ReceivingClerkWorkspaceV2 = lazy(() => import('./ReceivingClerkWorkspaceV2'))
const FinanceWorkbench = lazy(() => import('./FinanceWorkbench'))
const InventoryWorkbench = lazy(() => import('./InventoryWorkbench'))
const DepartmentSupplyWorkspace = lazy(() => import('./DepartmentSupplyWorkspace'))
const StockOnHand = lazy(() => import('./StockOnHand'))
const StoreInventory = lazy(() => import('./StoreInventory'))
const StoreAnalysis = lazy(() => import('./StoreAnalysis'))
const DepartmentRequisitions = lazy(() => import('./DepartmentRequisitions'))
const StorePurchaseRequests = lazy(() => import('./StorePurchaseRequests'))
const InventoryCatalogue = lazy(() => import('./InventoryCatalogue'))
const ArticleManagement = lazy(() => import('./ArticleManagement'))
const AuditLog = lazy(() => import('./AuditLog'))
const AccessManagement = lazy(() => import('./AccessManagement'))
const SupplierManagement = lazy(() => import('./SupplierManagement'))
const SupplierQuotationOptionOne = lazy(() => import('./SupplierQuotationOptionOne'))
const UnitManagement = lazy(() => import('./UnitManagement'))

const listRoutes = new Set([
  'items', 'locations', 'suppliers',
  'balances', 'ledgers', 'batches', 'requisitions', 'approvals', 'orders', 'grns',
  'reorderRules', 'storeRequisitions', 'stockIssues', 'storeReturns', 'inspections',
  'supplierReturns', 'employees', 'departments', 'supplierItems',
])

const departmentSupplyRoles = new Set([
  'department supervisor',
  'supervisor',
  'department head',
  'cost controller',
  'store keeper',
])

export default function AppShell() {
  const app = useApp()
  const workspaceRef = useRef<HTMLElement>(null)
  const role = String(app.user.role || '').trim().toLowerCase()
  const { route } = app

  useEffect(() => {
    workspaceRef.current?.focus({ preventScroll: true })
  }, [route])

  let content: ReactNode = null
  if (!canAccessRoute(app.user, route)) content = <Dashboard />
  else if (route === 'dashboard') content = <Dashboard />
  else if (route === 'hr-dashboard') content = <HRDashboard />
  else if (route === 'workflow-procure') content = role === 'financial manager'
    ? <FinancialManagerLpoWorkspace />
    : role === 'receiving clerk'
      ? <ReceivingClerkWorkspaceV2 />
      : <ProcurementWorkbench />
  else if (route === 'workflow-stores') content = departmentSupplyRoles.has(role)
    ? <DepartmentSupplyWorkspace />
    : role === 'department head'
      ? <DepartmentRequisitions />
      : <InventoryWorkbench />
  else if (route === 'stock-on-hand') content = <StockOnHand />
  else if (route === 'store-transfers') content = <InventoryWorkbench initialTab="transfers" />
  else if (route === 'store-inventory') content = <StoreInventory />
  else if (route === 'store-analysis') content = <StoreAnalysis />
  else if (route === 'store-usage') content = <StoreAnalysis focus="usage" />
  else if (route === 'store-purchase-requests') content = <StorePurchaseRequests />
  else if (route === 'workflow-consume') content = <InventoryWorkbench />
  else if (route === 'categories') content = <InventoryCatalogue />
  else if (route === 'items') content = <ArticleManagement />
  else if (route === 'uoms' || route === 'itemUnits') content = <UnitManagement />
  else if (route === 'workflow-pay') content = <FinanceWorkbench />
  else if (route === 'workflow-configure') content = <WorkflowHub kind="configure" />
  else if (route === 'suppliers') content = <SupplierManagement />
  else if (route === 'supplierItems') content = <SupplierQuotationOptionOne />
  else if (listRoutes.has(route)) content = <ListView />
  else if (route === 'detail') content = <DetailView />
  else if (route === 'reports') content = <Reports />
  else if (route === 'reportview') content = <ReportView />
  else if (route === 'hotel-profile') content = <HotelProfile />
  else if (route === 'audit-log') content = <AuditLog />
  else if (route === 'access-management') content = <AccessManagement />
  else content = <Dashboard />

  return <div className="neo-app-shell">
    <a className="neo-skip-link" href="#main-workspace">Skip to main workspace</a>
    <Sidebar />
    <div className="neo-app-main">
      <Header />
      <main ref={workspaceRef} id="main-workspace" tabIndex={-1} className={`neo-workspace route-${route}`} data-route={route}>
        <Suspense fallback={<RouteSkeleton />}>{content}</Suspense>
      </main>
    </div>
  </div>
}

function RouteSkeleton() {
  return <div className="neo-route-skeleton" role="status" aria-live="polite" aria-label="Loading workspace">
    <div className="neo-skeleton-line is-title" />
    <div className="neo-skeleton-kpis">{[0, 1, 2, 3].map((item) => <div key={item} />)}</div>
    <div className="neo-skeleton-panel" />
  </div>
}
