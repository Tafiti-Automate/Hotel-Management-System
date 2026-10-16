import type { CSSProperties } from 'react'

interface IconProps {
  name: string
  size?: number
  color?: string
  fill?: boolean
  weight?: number
  style?: CSSProperties
}

// These symbols were introduced after the original product icon subset was
// bundled. Keep them in a tiny supplemental font so an unavailable ligature
// can never spill its name into the UI.
const SUPPLEMENTAL_ICONS = new Set([
  'alternate_email',
  'auto_awesome',
  'business_center',
  'language',
  'location_on',
  'palette',
  'settings',
  'upload',
])

// The bundled primary symbol font is intentionally small. Alias newer symbol
// names to equivalent glyphs that are known to exist in the bundled subset so
// raw ligature text can never leak into the interface.
const SAFE_ALIASES: Record<string, string> = {
  analytics: 'bar_chart',
  monitoring: 'bar_chart',
  visibility: 'description',
  filter_alt: 'tune',
  filter_alt_off: 'tune',
  sync: 'refresh',
  search_off: 'search',
  assignment_turned_in: 'assignment',
  shopping_cart_checkout: 'shopping_cart',
}

/** Material Symbols Rounded glyph. */
export function Icon({ name, size = 20, color, fill, weight, style }: IconProps) {
  const safeName = SAFE_ALIASES[name] || name
  const fvs: string[] = []
  if (fill) fvs.push("'FILL' 1")
  if (weight) fvs.push(`'wght' ${weight}`)
  return (
    <span
      className={`ic${SUPPLEMENTAL_ICONS.has(safeName) ? ' ic-supplemental' : ''}`}
      aria-hidden="true"
      style={{
        fontSize: size,
        color,
        ...(fvs.length ? { fontVariationSettings: fvs.join(',') } : null),
        ...style,
      }}
    >
      {safeName}
    </span>
  )
}
