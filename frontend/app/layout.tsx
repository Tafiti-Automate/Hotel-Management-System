import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import '../src/tailwind.css'
import '../src/index.css'
import '../src/enterprise.css'
import '../src/hotel-ui-v2.css'
import '../src/workspace-v2.css'
import '../src/quotation-option-one.css'
import '../src/dashboard-v2.css'
import '../src/enterprise-redesign.css'
import '../src/enterprise-foundation.css'
import '../src/materials-control.css'
import '../src/operational-blueprint.css'
/* Restore the base department request, summary and responsive workspace grids. */
import '../src/responsive.css'
import '../src/mc-enterprise.css'
/* UI V3 production layer. These are shared application assets, not route-local styles. */
import '../src/reports-production.css'
import '../src/report-view-production.css'
import '../src/ui-v3.css'
import '../src/ui-v3-runtime-fixes.css'
/* The approved corporate shell is the final visual override. */
import '../src/approved-hotel-gui.css'
/* Mandatory Enterprise Hospitality Precision design system. */
import '../src/hospitality-precision.css'
/* Final approved five-screen visual foundation, shared by every role. */
import '../src/hotel-evergreen-unified.css'
/* Page-scoped final fixes: Department Requisitions master/detail + Article selector. */
import '../src/department-requisitions-fix.css'

export const metadata: Metadata = {
  title: 'Hotel ERP',
  description: 'Hotel operations, procurement, inventory, finance and administration workspace.',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en">
    <body>{children}</body>
  </html>
}
