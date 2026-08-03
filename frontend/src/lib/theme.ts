// Theme + formatting helpers ported from the prototype (DCLogic).

export type Mode = 'light' | 'dark'
export type AccentName = 'Violet' | 'Blue' | 'Emerald' | 'Brass' | 'Rose' | 'Slate'
export type Density = 'Airy' | 'Compact'

export const accentMap: Record<AccentName, string> = {
  Violet: '#6E56F0',
  Blue: '#2563EB',
  Emerald: '#0E9F6E',
  Brass: '#B8893B',
  Rose: '#E0476B',
  Slate: '#5B6472',
}

export const accentOrder: AccentName[] = ['Violet', 'Blue', 'Emerald', 'Brass', 'Rose', 'Slate']

const LIGHT: Record<string, string> = {
  '--bg': '#EAF0F7',
  '--surface': '#FBFCFE',
  '--surface-2': '#F1F5F9',
  '--surface-3': '#E7EDF5',
  '--text': '#10233F',
  '--text-muted': '#465A73',
  '--text-faint': '#718198',
  '--border': '#D4DEE9',
  '--border-2': '#BFCBDC',
  '--shadow': '0 1px 2px rgba(15,35,63,.06),0 8px 22px rgba(15,35,63,.07)',
  '--shadow-sm': '0 1px 3px rgba(15,35,63,.08)',
}

const DARK: Record<string, string> = {
  '--bg': '#0C0C10',
  '--surface': '#15151B',
  '--surface-2': '#1E1E26',
  '--surface-3': '#272731',
  '--text': '#F3F3F5',
  '--text-muted': '#A0A0AA',
  '--text-faint': '#6E6E78',
  '--border': '#27272F',
  '--border-2': '#33333D',
  '--shadow': '0 1px 2px rgba(0,0,0,.4),0 12px 30px rgba(0,0,0,.4)',
  '--shadow-sm': '0 1px 2px rgba(0,0,0,.4)',
}

// Static status colors (constant across light/dark in the prototype).
const STATUS_VARS: Record<string, string> = {
  '--good': '#16A34A',
  '--good-soft': 'rgba(22,163,74,.12)',
  '--warn': '#D97706',
  '--warn-soft': 'rgba(217,119,6,.14)',
  '--bad': '#DC2626',
  '--bad-soft': 'rgba(220,38,38,.12)',
}

function hexA(h: string, a: number): string {
  h = h.replace('#', '')
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function shade(h: string, p: number): string {
  h = h.replace('#', '')
  const n = parseInt(h, 16)
  let r = (n >> 16) & 255
  let g = (n >> 8) & 255
  let b = n & 255
  const f = 1 + p / 100
  r = Math.max(0, Math.min(255, Math.round(r * f)))
  g = Math.max(0, Math.min(255, Math.round(g * f)))
  b = Math.max(0, Math.min(255, Math.round(b * f)))
  return '#' + (16777216 + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

export interface ThemeOptions {
  mode: Mode
  accentName: AccentName
  density: Density
}

/** Build the full set of CSS custom properties for the root element. */
export function themeVars({ mode, accentName, density }: ThemeOptions): Record<string, string> {
  const accent = accentMap[accentName] || accentMap.Violet
  const base = mode === 'dark' ? DARK : LIGHT
  const airy = density !== 'Compact'
  return {
    ...base,
    ...STATUS_VARS,
    '--accent': accent,
    '--accent-soft': hexA(accent, mode === 'dark' ? 0.24 : 0.1),
    '--accent-strong': shade(accent, -14),
    '--pad': airy ? '24px' : '16px',
    '--gap': airy ? '16px' : '10px',
    '--font-sans': "'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif",
    '--font-mono': "'JetBrains Mono','SFMono-Regular',Consolas,monospace",
    '--text-xs': '12px',
    '--text-sm': '13px',
    '--text-body': '14px',
    '--text-lead': '15px',
    '--text-section': '18px',
    '--text-page': '27px',
    '--leading-body': '1.55',
  }
}

/** Format backend monetary values. The ERP stores amounts directly in UGX. */
export function money(v: number | string | null | undefined): string {
  const n = Number(v || 0)
  return 'UGX ' + Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-UG')
}

export interface StatusPresentation {
  label: string
  tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral'
}

const STATUS_PRESENTATION: Record<string, StatusPresentation> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  pending: { label: 'Pending', tone: 'warn' },
  pending_department_approval: { label: 'Pending Department Approval', tone: 'warn' },
  pending_stores_approval: { label: 'Pending Stores Approval', tone: 'warn' },
  awaiting_procurement: { label: 'Awaiting Procurement', tone: 'warn' },
  partially_issued: { label: 'Partially Issued', tone: 'warn' },
  partially_received: { label: 'Partially Received', tone: 'warn' },
  partially_paid: { label: 'Partially Paid', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  accepted: { label: 'Accepted', tone: 'good' },
  matched: { label: 'Matched', tone: 'good' },
  posted: { label: 'Posted', tone: 'good' },
  paid: { label: 'Paid', tone: 'good' },
  issued: { label: 'Issued', tone: 'info' },
  completed: { label: 'Completed', tone: 'good' },
  active: { label: 'Active', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  inactive: { label: 'Inactive', tone: 'bad' },
  exception: { label: 'Exception', tone: 'bad' },
  low: { label: 'Low', tone: 'warn' },
  critical: { label: 'Critical', tone: 'bad' },
}

function statusKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function statusPresentation(value: string): StatusPresentation {
  const key = statusKey(value)
  return STATUS_PRESENTATION[key] || {
    label: value.includes('_') ? value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : value,
    tone: 'neutral',
  }
}

/** Inline style for a canonical status badge. */
export function chipStyleFor(value: string): React.CSSProperties {
  const { tone } = statusPresentation(value)
  const tones = {
    good: ['var(--good)', 'var(--good-soft)'],
    warn: ['var(--warn)', 'var(--warn-soft)'],
    bad: ['var(--bad)', 'var(--bad-soft)'],
    info: ['var(--accent)', 'var(--accent-soft)'],
    neutral: ['var(--text-muted)', 'var(--surface-2)'],
  } as const
  const [color, background] = tones[tone]
  return {
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 650,
    padding: '3px 10px',
    borderRadius: 20,
    color,
    background,
  }
}
