import type { CSSProperties } from 'react'

interface IconProps {
  name: string
  size?: number
  color?: string
  fill?: boolean
  weight?: number
  style?: CSSProperties
}

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

const SAFE_ALIASES: Record<string, string> = {
  analytics: 'bar_chart',
  monitoring: 'bar_chart',
  visibility: 'description',
  visibility_off: 'description',
  filter_alt: 'tune',
  filter_alt_off: 'tune',
  sync: 'refresh',
  search_off: 'search',
  assignment_turned_in: 'assignment',
  shopping_cart_checkout: 'shopping_cart',
  right_panel_open: 'left_panel_open',
  person: 'badge',
  support_agent: 'info',
  keyboard_capslock: 'info',
  shield: 'verified_user',
  verified: 'verified_user',
  inventory: 'inventory_2',
  waving_hand: 'badge',
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
