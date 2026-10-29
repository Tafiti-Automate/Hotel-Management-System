import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './enterprise.css'
import './hotel-ui-v2.css'
import './workspace-v2.css'
import './quotation-option-one.css'
import './dashboard-v2.css'
import './enterprise-redesign.css'
import App from './App'
import { AppProvider } from './state/AppContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode><AppProvider><App /></AppProvider></StrictMode>,
)
