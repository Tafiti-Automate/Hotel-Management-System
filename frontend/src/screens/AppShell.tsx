import { useApp } from '../state/AppContext'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import Dashboard from './Dashboard'
import ListView from './ListView'
import DetailView from './DetailView'
import Reports from './Reports'
import ReportView from './ReportView'
import HotelProfile from './HotelProfile'

const listRoutes: string[] = [
  'items', 'categories', 'uoms', 'locations', 'suppliers',
  'balances', 'ledgers', 'batches', 'requisitions', 'approvals', 'orders', 'grns',
]

export default function AppShell() {
  const { route } = useApp()

  let content: React.ReactNode = null
  if (route === 'dashboard') content = <Dashboard />
  else if (listRoutes.includes(route)) content = <ListView />
  else if (route === 'detail') content = <DetailView />
  else if (route === 'reports') content = <Reports />
  else if (route === 'reportview') content = <ReportView />
  else if (route === 'hotel-profile') content = <HotelProfile />

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
