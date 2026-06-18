import type { CSSProperties } from 'react'

interface IconProps {
  name: string
  size?: number
  color?: string
  fill?: boolean
  weight?: number
  style?: CSSProperties
}

/** Material Symbols Rounded glyph. */
export function Icon({ name, size = 20, color, fill, weight, style }: IconProps) {
  const fvs: string[] = []
  if (fill) fvs.push("'FILL' 1")
  if (weight) fvs.push(`'wght' ${weight}`)
  return (
    <span
      className="ic"
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
