import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { useApp } from '../state/AppContext'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import WorkspaceErrorBoundary from '../components/WorkspaceErrorBoundary'
import Dashboard from './DashboardV2'
import { canAccessRoute } from '../lib/access'
import { DocumentDrawerProvider, EnterpriseDocumentHotspots } from '../features/enterprise/workspaceKit'

const ListView = lazy(() => import('./ListView'))
const DetailView = lazy(() => import('./DetailView'))
const Reports = lazy(() => import('./Reports'))
const ReportView = lazy(() => import('./ReportView'))
const HotelProfile = lazy(() => import('./HotelProfile'))
const WorkflowHub = lazy(() => import('./WorkflowHub'))
const HRDashboard = lazy(() => import('./HRDashboard'))
const PayrollWorkspace = lazy(() => import('./HRWorkspaces').then(module => ({ default: module.PayrollWorkspace })))
const PayrollAffectorWorkspace = lazy(() => import('./HRWorkspaces').then(module => ({ default: module.PayrollAffectorWorkspace })))
const SalaryAdvanceWorkspace = lazy(() => import('./HRWorkspaces').then(module => ({ default: module.SalaryAdvanceWorkspace })))
const LeaveWorkspace = lazy(() => import('./HRWorkspaces').then(module => ({ default: module.LeaveWorkspace })))
const LeaveCalendarWorkspace = lazy(() => import('./HRWorkspaces').then(module => ({ default: module.LeaveCalendarWorkspace })))
const HRDocumentsWorkspace = lazy(() => import('./HRWorkspaces').then(module => ({ default: module.HRDocumentsWorkspace })))
const HRAttendanceWorkspace = lazy(() => import('./HRWorkspaces').then(module => ({ default: module.HRAttendanceWorkspace })))
const HRShiftsWorkspace = lazy(() => import('./HRWorkspaces').then(module => ({ default: module.HRShiftsWorkspace })))
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
const MarketLists = lazy(() => import('./MarketLists'))
const StorePurchaseRequests = lazy(() => import('./StorePurchaseRequests'))
const InventoryCatalogue = lazy(() => import('./InventoryCatalogue'))
const ArticleManagement = lazy(() => import('./ArticleManagement'))
const AuditLog = lazy(() => import('./AuditLog'))
const AccessManagement = lazy(() => import('./AccessManagement'))
const SupplierManagement = lazy(() => import('./SupplierManagement'))
const SupplierQuotationOptionOne = lazy(() => import('./SupplierQuotationOptionOne'))
const ReceptionWorkspace = lazy(() => import('./HospitalityWorkspaces').then(module => ({default: module.ReceptionWorkspace})))
const RoomManagementWorkspace = lazy(() => import('./RoomManagementWorkspace'))
const FrontOfficeWorkspace = lazy(() => import('./FrontOfficeWorkspace'))
const BarPosWorkspace = lazy(() => import('./HospitalityWorkspaces').then(module => ({default: module.BarPosWorkspace})))
const UnitManagement = lazy(() => import('./UnitManagement'))
const MaterialsControl = lazy(() => import('./MaterialsControl'))
const InternalRequestBuilder = lazy(() => import('./OutletWorkflow').then((module) => ({ default: module.InternalRequestBuilder })))
const IncomingPickup = lazy(() => import('./OutletWorkflow').then((module) => ({ default: module.IncomingPickup })))
const EnterpriseMenuEngineering = lazy(() => import('../features/enterprise/OperationsAdmin').then(m => ({ default: m.EnterpriseMenuEngineering })))
const GrnPostingConsole = lazy(() => import('./StorekeeperSprintOne').then((module) => ({ default: module.GrnPostingConsole })))
const TransferDispatchConsole = lazy(() => import('./StorekeeperSprintOne').then((module) => ({ default: module.TransferDispatchConsole })))

const EnterprisePurchasingWorkbench = lazy(() => import('../features/enterprise/ProcurementFinance').then(module => ({ default: module.EnterprisePurchasingWorkbench })))
const EnterpriseQuoteMatrix = lazy(() => import('../features/enterprise/ProcurementFinance').then(module => ({ default: module.EnterpriseQuoteMatrix })))
const EnterprisePurchaseRequisitionBuilder = lazy(() => import('../features/enterprise/ProcurementFinance').then(module => ({ default: module.EnterprisePurchaseRequisitionBuilder })))
const EnterprisePurchaseOrderDetail = lazy(() => import('../features/enterprise/ProcurementFinance').then(module => ({ default: module.EnterprisePurchaseOrderDetail })))
const EnterpriseBlindReceiving = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseBlindReceiving })))
const EnterpriseSupplierReturn = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseSupplierReturn })))
const SupplierReturnReporter = lazy(() => import('../features/enterprise/SupplierReturnRequests'))
const EnterpriseDepartmentReturn = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseDepartmentReturn })))
const EnterpriseInvoiceMatching = lazy(() => import('../features/enterprise/ProcurementFinance').then(module => ({ default: module.EnterpriseInvoiceMatching })))
const EnterpriseBudgetMatrix = lazy(() => import('../features/enterprise/ProcurementFinance').then(module => ({ default: module.EnterpriseBudgetMatrix })))
const EnterprisePeriodClose = lazy(() => import('../features/enterprise/ProcurementFinance').then(module => ({ default: module.EnterprisePeriodClose })))
const EnterpriseCostCenters = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseCostCenters })))
const EnterpriseAuthorisationRules = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseAuthorisationRules })))
const EnterpriseArticleMaster = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseArticleMaster })))
const EnterpriseStocktakeSheet = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseStocktakeSheet })))
const EnterpriseStocktakeVariance = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseStocktakeVariance })))
const EnterpriseRecipeDetail = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseRecipeDetail })))
const EnterprisePosReconciliation = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterprisePosReconciliation })))
const EnterpriseWasteLogger = lazy(() => import('../features/enterprise/OperationsAdmin').then(module => ({ default: module.EnterpriseWasteLogger })))
const EnterpriseApprovalInbox = lazy(() => import('../features/enterprise/ProcurementFinance').then(module => ({ default: module.EnterpriseApprovalInbox })))

const listRoutes = new Set([
  'items', 'locations', 'suppliers',
  'balances', 'ledgers', 'batches', 'requisitions', 'approvals', 'orders', 'grns',
  'reorderRules', 'storeRequisitions', 'stockIssues', 'storeReturns', 'inspections',
  'supplierReturns', 'employees', 'departments', 'supplierItems',
])

const departmentSupplyRoles = new Set([
  'department supervisor',
  'outlet supervisor',
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
  if (!canAccessRoute(app.user, route)) content = <section className="mc-access-denied" role="alert">
    <h2>Access restricted</h2><p>Your authenticated role does not permit this workspace.</p>
    <button onClick={() => app.navTo('dashboard','Overview')}>Back to dashboard</button>
  </section>
  else if (route === 'dashboard') content = <Dashboard />
  else if (route === 'hr-dashboard') content = <HRDashboard />
  else if (route === 'hr-payroll') content = <PayrollWorkspace />
  else if (route === 'hr-affectors') content = <PayrollAffectorWorkspace />
  else if (route === 'hr-advances') content = <SalaryAdvanceWorkspace />
  else if (route === 'hr-leave') content = <LeaveWorkspace />
  else if (route === 'hr-calendar') content = <LeaveCalendarWorkspace />
  else if (route === 'hr-documents') content = <HRDocumentsWorkspace />
  else if (route === 'hr-attendance') content = <HRAttendanceWorkspace />
  else if (route === 'hr-shifts') content = <HRShiftsWorkspace />
  else if (route === 'front-desk-reservations') content = <ReceptionWorkspace />
  else if (route === 'front-desk-rooms') content = <RoomManagementWorkspace />
  else if (['front-office-dashboard', 'front-office-arrivals', 'front-office-inhouse', 'front-office-departures', 'front-office-assignments', 'front-office-housekeeping', 'front-office-guests', 'front-office-folios', 'front-office-cashier', 'front-office-night-audit', 'front-office-reports', 'front-office-config'].includes(route)) content = <FrontOfficeWorkspace section={route} />
  else if (route === 'bar-pos') content = <BarPosWorkspace />
  else if (route === 'purchasing-workbench') content = <EnterprisePurchasingWorkbench />
  else if (route === 'purchasing-quotes') content = <EnterpriseQuoteMatrix />
  else if (route === 'purchasing-pr-new') content = <EnterprisePurchaseRequisitionBuilder />
  else if (route === 'purchasing-order-detail') content = <EnterprisePurchaseOrderDetail />
  else if (route === 'receiving-po-detail') content = <EnterpriseBlindReceiving />
  else if (route === 'receiving-return-new') content = <EnterpriseSupplierReturn />
  else if (route === 'supplier-return-report') content = <SupplierReturnReporter />
  else if (route === 'department-returns-new') content = <EnterpriseDepartmentReturn />
  else if (route === 'finance-invoice-matching') content = <EnterpriseInvoiceMatching />
  else if (route === 'finance-budgets') content = <EnterpriseBudgetMatrix />
  else if (route === 'finance-period-close') content = <EnterprisePeriodClose />
  else if (route === 'admin-cost-centers') content = <EnterpriseCostCenters />
  else if (route === 'admin-authorisation-rules') content = <EnterpriseAuthorisationRules />
  else if (route === 'admin-articles') content = <EnterpriseArticleMaster />
  else if (route === 'stocktake-sheet') content = <EnterpriseStocktakeSheet />
  else if (route === 'stocktake-variance') content = <EnterpriseStocktakeVariance />
  else if (route === 'recipes-detail') content = <EnterpriseRecipeDetail />
  else if (route === 'pos-reconciliation') content = <EnterprisePosReconciliation />
  else if (route === 'waste-new') content = <EnterpriseWasteLogger />
  else if (route === 'approval-inbox') content = <EnterpriseApprovalInbox />
  else if (route === 'workflow-procure') content = role === 'financial manager'
    ? <FinancialManagerLpoWorkspace />
    : role === 'receiving clerk'
      ? <ReceivingClerkWorkspaceV2 />
      : <ProcurementWorkbench />
  else if (route === 'workflow-stores') content = role === 'department head'
    ? <DepartmentRequisitions />
    : departmentSupplyRoles.has(role)
      ? <DepartmentSupplyWorkspace />
      : <InventoryWorkbench />
  else if (route === 'market-lists') content = <MarketLists />
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
  else if (route === 'grn-posting') content = <GrnPostingConsole />
  else if (route === 'transfer-dispatch') content = <TransferDispatchConsole />
  else if (route === 'new-store-request') content = <InternalRequestBuilder />
  else if (route === 'incoming-pickup') content = <IncomingPickup />
  else if (route === 'waste-control') content = <MaterialsControl section="waste" />
  else if (route === 'recipes-production') content = <MaterialsControl section="recipes" />
  else if (route === 'pos-control') content = <MaterialsControl section="pos" />
  else if (route === 'finance-governance') content = <MaterialsControl section="governance" />
  else if (route === 'integration-control') content = <MaterialsControl section="integrations" />
  else if (route === 'workflow-configure') content = <WorkflowHub kind="configure" />
  else if (route === 'suppliers') content = <SupplierManagement />
  else if (route === 'supplierItems') content = <SupplierQuotationOptionOne />
  else if (listRoutes.has(route)) content = <ListView />
  else if (route === 'detail') content = <DetailView />
  else if (route === 'reports') content = <Reports />
  else if (route === 'menu-engineering') content = <EnterpriseMenuEngineering />
  else if (route === 'reportview') content = <ReportView />
  else if (route === 'hotel-profile') content = <HotelProfile />
  else if (route === 'audit-log') content = <AuditLog />
  else if (route === 'access-management') content = <AccessManagement />
  else content = <Dashboard />

  return <DocumentDrawerProvider><div className="neo-app-shell" data-ui-design="hospitality-evergreen">
    <a className="neo-skip-link" href="#main-workspace">Skip to main workspace</a>
    <Sidebar />
    <div className="neo-app-main">
      <Header />
      <main ref={workspaceRef} id="main-workspace" tabIndex={-1} className={`neo-workspace route-${route}`} data-route={route}>
        <EnterpriseDocumentHotspots>
          <WorkspaceErrorBoundary key={route} onHome={() => app.navTo('dashboard', 'Overview')}>
            <Suspense fallback={<RouteSkeleton />}>{content}</Suspense>
          </WorkspaceErrorBoundary>
        </EnterpriseDocumentHotspots>
      </main>
    </div>
  </div></DocumentDrawerProvider>
}

function RouteSkeleton() {
  return <div className="neo-route-skeleton" role="status" aria-live="polite" aria-label="Loading workspace">
    <div className="neo-skeleton-line is-title" />
    <div className="neo-skeleton-kpis">{[0, 1, 2, 3].map((item) => <div key={item} />)}</div>
    <div className="neo-skeleton-panel" />
  </div>
}
