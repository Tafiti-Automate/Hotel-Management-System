import type { ReactNode } from 'react'

/**
 * Shared authenticated dashboard route boundary. ClientApplication provides
 * AppProvider and the existing, unified AppShell with sidebar, context bar,
 * notifications, overlays and role-gated navigation.
 */
export default function DashboardRouteLayout({ children }: { children: ReactNode }) {
  return <div data-dashboard-layout="hotel-erp">{children}</div>
}
