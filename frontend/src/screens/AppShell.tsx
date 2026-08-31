import { lazy, Suspense } from 'react'
import { useApp } from '../state/AppContext'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import Dashboard from './Dashboard'
import { canAccessRoute } from '../lib/access'

const ListView = lazy(() => import('./ListView'))
const DetailView = lazy(() => import('./DetailView'))
const Reports = lazy(() => import('./Reports'))
const ReportView = lazy(() => import('./ReportView'))
const HotelProfile = lazy(() => import('./HotelProfile'))
const WorkflowHub = lazy(() => import('./WorkflowHub'))
const HRDashboard = lazy(() => import('./HRDashboard'))
const ProcurementWorkbench = lazy(() => import('./ProcurementWorkbench'))
const FinanceWorkbench = lazy(() => import('./FinanceWorkbench'))
const InventoryWorkbench = lazy(() => import('./InventoryWorkbench'))
const AuditLog = lazy(() => import('./AuditLog'))
const AccessManagement = lazy(() => import('./AccessManagement'))
const SupplierManagement = lazy(() => import('./SupplierManagement'))
const SupplierQuotationManagement = lazy(() => import('./SupplierQuotationManagement'))

const listRoutes: string[] = [
  'items', 'categories', 'uoms', 'itemUnits', 'locations', 'suppliers',
  'balances', 'ledgers', 'batches', 'requisitions', 'approvals', 'orders', 'grns',
  'reorderRules', 'storeRequisitions', 'stockIssues', 'storeReturns', 'inspections',
  'supplierReturns',
  'employees', 'departments',
  'supplierItems',
]

export default function AppShell() {
  const app = useApp()
  const { route } = app

  let content: React.ReactNode = null
  if (!canAccessRoute(app.user, route)) content = <Dashboard />
  else if (route === 'dashboard') content = <Dashboard />
  else if (route === 'hr-dashboard') content = <HRDashboard />
  else if (route === 'workflow-procure') content = <ProcurementWorkbench />
  else if (route === 'workflow-stores') content = <InventoryWorkbench />
  else if (route === 'workflow-consume') content = <InventoryWorkbench />
  else if (route === 'workflow-pay') content = <FinanceWorkbench />
  else if (route === 'workflow-configure') content = <WorkflowHub kind="configure" />
  else if (route === 'suppliers') content = <SupplierManagement />
  else if (route === 'supplierItems') content = <SupplierQuotationManagement />
  else if (listRoutes.includes(route)) content = <ListView />
  else if (route === 'detail') content = <DetailView />
  else if (route === 'reports') content = <Reports />
  else if (route === 'reportview') content = <ReportView />
  else if (route === 'hotel-profile') content = <HotelProfile />
  else if (route === 'audit-log') content = <AuditLog />
  else if (route === 'access-management') content = <AccessManagement />

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div className="app-main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Header />
        <main className="app-content" style={{ flex: 1, overflowY: 'auto', padding: 'var(--pad)' }}><Suspense fallback={<RouteLoading />}>{content}</Suspense></main>
      </div>
    </div>
  )
}


function RouteLoading() {
  return <div className="route-loading" role="status" aria-live="polite">
    <span className="route-loading-spinner" aria-hidden="true" />
    <div><strong>Loading</strong><span>Preparing your workspace…</span></div>
  </div>
}
