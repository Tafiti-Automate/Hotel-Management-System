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
// can never spill its name (for example, "business_center") into the UI.
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

/** Material Symbols Rounded glyph. */
export function Icon({ name, size = 20, color, fill, weight, style }: IconProps) {
  const fvs: string[] = []
  if (fill) fvs.push("'FILL' 1")
  if (weight) fvs.push(`'wght' ${weight}`)
  return (
    <span
      className={`ic${SUPPLEMENTAL_ICONS.has(name) ? ' ic-supplemental' : ''}`}
      aria-hidden="true"
      style={{
        fontSize: size,
        color,
        ...(fvs.length ? { fontVariationSettings: fvs.join(',') } : null),
        ...style,
      }}
    >
      {name}
    </span>
  )
}
