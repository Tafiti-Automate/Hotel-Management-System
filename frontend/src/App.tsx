import { useApp } from './state/AppContext'
import { themeVars } from './lib/theme'
import Login from './screens/Login'
import Launchpad from './screens/Launchpad'
import AppShell from './screens/AppShell'
import FormDrawer from './components/FormDrawer'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import type { CSSProperties } from 'react'

export default function App() {
  const app = useApp()
  const vars = themeVars({ mode: app.mode, accentName: app.accentName, density: app.density })

  const rootStyle: CSSProperties = {
    ...(vars as CSSProperties),
    minHeight: '100vh',
    position: 'relative',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif",
  }

  return (
    <div style={rootStyle}>
      {app.screen === 'login' && <Login />}
      {app.screen === 'launchpad' && <Launchpad />}
      {app.screen === 'app' && <AppShell />}

      <FormDrawer />
      <ConfirmDialog />
      <Toast />
    </div>
  )
}
