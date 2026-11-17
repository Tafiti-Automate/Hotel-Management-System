'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

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
  group: 'groups',
  shield_person: 'verified_user',
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
  // The subset includes the down chevron but omits `expand_less`. Reuse the
  // available glyph and rotate it below so the ligature name never leaks into
  // the interface as visible text.
  expand_less: 'expand_more',
  // These two symbols are not present in the locally bundled font subset.
  // Use equivalent available symbols so their ligature names never render as
  // visible text in compact quotation cards.
  folder: 'inventory_2',
  event_available: 'schedule',
  waving_hand: 'badge',
}

// The bundled font is intentionally small. Unsupported ligatures used to leak
// literal names (CALENDAR_MONTH, EVENT_NOTE, ...) into the UI. Render the
// missing symbols as inline vectors, and detect any future missing glyphs.
// No network font, CDN or browser-specific glyph substitutions are required.
const VECTOR_NAMES = new Set([
  'calendar_month', 'format_list_numbered', 'problem', 'swap_horiz',
  'event_note', 'book_2', 'donut_large',
])

function VectorIcon({ name, size, color, style }: {
  name: string
  size: number
  color?: string
  style?: CSSProperties
}) {
  let paths: ReactNode
  switch (name) {
    case 'calendar_month':
      paths = <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 18h3M14 18h3"/></>
      break
    case 'event_note':
      paths = <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h10M7 18h6"/></>
      break
    case 'format_list_numbered':
      paths = <><path d="M9 6h12M9 12h12M9 18h12M3 4h2v4M3 8h3M3 12h3l-3 3h3M3 19h3"/></>
      break
    case 'problem':
      paths = <><path d="M10.4 4.3 2.5 18a1.7 1.7 0 0 0 1.5 2.5h16a1.7 1.7 0 0 0 1.5-2.5L13.6 4.3a1.8 1.8 0 0 0-3.2 0Z"/><path d="M12 9v5M12 17.5h.01"/></>
      break
    case 'swap_horiz':
      paths = <><path d="M3 8h17l-4-4M20 8l-4 4M21 16H4l4-4M4 16l4 4"/></>
      break
    case 'book_2':
      paths = <><path d="M5 3h14a2 2 0 0 1 2 2v15H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h1M4 17a3 3 0 0 1 3-3h14"/><path d="M9 7h7"/></>
      break
    case 'donut_large':
      paths = <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M16.5 15.5l3.5 3.5"/></>
      break
    default:
      // Unknown third-party glyphs get a neutral symbol rather than exposing
      // implementation tokens and disrupting navigation/card dimensions.
      paths = <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true" focusable="false"
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}>
    {paths}
  </svg>
}

/** Material Symbols Rounded glyph. */
export function Icon({ name, size = 20, color, fill, weight, style }: IconProps) {
  const safeName = SAFE_ALIASES[name] || name
  const aliasStyle = name === 'expand_less' && safeName === 'expand_more'
    ? { transform: 'rotate(180deg)' }
    : null
  const glyphRef = useRef<HTMLSpanElement>(null)
  const [missingGlyph, setMissingGlyph] = useState('')
  useEffect(() => {
    if (VECTOR_NAMES.has(name)) return
    let active = true
    const check = () => {
      const el = glyphRef.current
      // An unsupported ligature renders its readable name, which is
      // substantially wider than the intended square icon glyph.
      if (active && el && el.scrollWidth > Math.ceil(size * 1.55)) {
        setMissingGlyph(safeName)
      }
    }
    if (document.fonts?.ready) void document.fonts.ready.then(check)
    else check()
    return () => { active = false }
  }, [name, safeName, size])

  if (VECTOR_NAMES.has(name) || missingGlyph === safeName) {
    return <VectorIcon name={name} size={size} color={color}
      style={{ ...aliasStyle, ...style }} />
  }

  const fvs: string[] = []
  if (fill) fvs.push("'FILL' 1")
  if (weight) fvs.push(`'wght' ${weight}`)
  return (
    <span
      ref={glyphRef}
      className={`ic${SUPPLEMENTAL_ICONS.has(safeName) ? ' ic-supplemental' : ''}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        overflow: 'hidden',
        fontSize: size,
        color,
        ...(fvs.length ? { fontVariationSettings: fvs.join(',') } : null),
        ...aliasStyle,
        ...style,
      }}
    >
      {safeName}
    </span>
  )
}
