import { useApp } from './state/AppContext'
import { themeVars } from './lib/theme'
import { brandThemeVars, type BrandPalette } from './lib/brandTheme'
import { fetchHotels, type HotelRecord } from './lib/api'
import { useEffect, useState } from 'react'
import Login from './screens/Login'
import Launchpad from './screens/Launchpad'
import AppShell from './screens/AppShell'
import FormDrawer from './components/FormDrawer'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import WorkflowAlert from './components/WorkflowAlert'
import type { CSSProperties } from 'react'

export default function App() {
  const app = useApp()
  const [brand, setBrand] = useState<BrandPalette | null>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('hms_hotel_brand_theme') || 'null')
      return cached?.enabled ? { primary: cached.primary, secondary: cached.secondary, accent: cached.accent } : null
    } catch { return null }
  })

  useEffect(() => {
    if (app.screen === 'login') return
    const applyHotel = (hotel?: HotelRecord) => {
      if (!hotel?.use_logo_theme) { setBrand(null); return }
      const palette = { primary: hotel.brand_primary_color, secondary: hotel.brand_secondary_color, accent: hotel.brand_accent_color }
      setBrand(palette)
      try { localStorage.setItem('hms_hotel_brand_theme', JSON.stringify({ ...palette, enabled: true })) } catch { /* ignore */ }
    }
    void fetchHotels().then((hotels) => applyHotel(hotels.find((hotel) => hotel.is_active) || hotels[0])).catch(() => undefined)
    const listener = (event: Event) => applyHotel((event as CustomEvent<HotelRecord>).detail)
    window.addEventListener('hotel-theme-updated', listener)
    return () => window.removeEventListener('hotel-theme-updated', listener)
  }, [app.screen])

  const vars = { ...themeVars({ mode: app.mode, accentName: app.accentName, density: app.density }), ...brandThemeVars(brand, app.mode) }

  const rootStyle: CSSProperties = {
    ...(vars as CSSProperties),
    minHeight: '100vh',
    position: 'relative',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: "var(--font-sans)",
  }

  return (
    <div style={rootStyle}>
      {app.screen === 'login' && <Login />}
      {app.screen === 'launchpad' && <Launchpad />}
      {app.screen === 'app' && <AppShell />}

      <FormDrawer />
      <ConfirmDialog />
      <Toast />
      <WorkflowAlert />
    </div>
  )
}
