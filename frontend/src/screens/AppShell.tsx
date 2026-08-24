import { useApp } from '../state/AppContext'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import Dashboard from './Dashboard'
import ListView from './ListView'
import DetailView from './DetailView'
import Reports from './Reports'
import ReportView from './ReportView'
import HotelProfile from './HotelProfile'
import WorkflowHub from './WorkflowHub'
import HRDashboard from './HRDashboard'
import ProcurementWorkbench from './ProcurementWorkbench'
import FinanceWorkbench from './FinanceWorkbench'
import InventoryWorkbench from './InventoryWorkbench'
import AuditLog from './AuditLog'
import AccessManagement from './AccessManagement'
import SupplierManagement from './SupplierManagement'
import SupplierQuotationManagement from './SupplierQuotationManagement'
import { canAccessRoute } from '../lib/access'

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
        <div className="app-content" style={{ flex: 1, overflowY: 'auto', padding: 'var(--pad)' }}>{content}</div>
      </div>
    </div>
  )
}
