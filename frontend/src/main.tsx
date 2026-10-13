import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './enterprise.css'
import './responsive.css'
import './tafiti-school-ui.css'
import './tafiti-school-auth.css'
import './tafiti-school-finishing.css'
import App from './App'
import { AppProvider } from './state/AppContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
