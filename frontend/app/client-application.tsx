'use client'

import { useEffect, useState } from 'react'
import App from '../src/App'
import { AppProvider } from '../src/state/AppContext'

export default function ClientApplication() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="erp-boot-screen" role="status" aria-label="Loading Hotel ERP">
    <span aria-hidden="true" />
  </div>

  return <AppProvider><App /></AppProvider>
}
