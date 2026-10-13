import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './enterprise.css'
import './responsive.css'
import './department-requisitions-polish.css'
import './department-requisitions-fix.css'
import './role-workspaces.css'
import './reports-production.css'
import './report-view-production.css'
import './reference-ui.css'
import './reference-ui-dark.css'
import App from './App'
import { AppProvider } from './state/AppContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
