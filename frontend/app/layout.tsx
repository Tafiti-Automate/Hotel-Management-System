import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '../src/index.css'
import '../src/enterprise.css'
import '../src/hotel-ui-v2.css'
import '../src/workspace-v2.css'
import '../src/quotation-option-one.css'
import '../src/dashboard-v2.css'
import '../src/enterprise-redesign.css'
import '../src/enterprise-foundation.css'

export const metadata: Metadata = {
  title: 'Hotel ERP',
  description: 'Hotel operations, procurement, inventory, finance and administration workspace.',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en">
    <body>{children}</body>
  </html>
}
