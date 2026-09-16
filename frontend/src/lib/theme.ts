// Shared theme and formatting helpers.

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
  '--bg': '#F8FAFC',
  '--surface': '#FFFFFF',
  '--surface-2': '#F8FAFC',
  '--surface-3': '#F1F5F9',
  '--text': '#0F172A',
  '--text-muted': '#475569',
  '--text-faint': '#64748B',
  '--border': '#E2E8F0',
  '--border-2': '#CBD5E1',
  '--shadow': '0 1px 3px rgba(15,23,42,.10)',
  '--shadow-sm': '0 1px 2px rgba(15,23,42,.08)',
}

const DARK: Record<string, string> = {
  '--bg': '#0F172A',
  '--surface': '#1E293B',
  '--surface-2': '#172033',
  '--surface-3': '#334155',
  '--text': '#F8FAFC',
  '--text-muted': '#94A3B8',
  '--text-faint': '#94A3B8',
  '--border': '#334155',
  '--border-2': '#475569',
  '--shadow': '0 1px 3px rgba(0,0,0,.32)',
  '--shadow-sm': '0 1px 2px rgba(0,0,0,.28)',
}

function statusVars(mode: Mode): Record<string, string> {
  return mode === 'dark'
    ? {
        '--good': '#4ADE80',
        '--good-soft': '#14532D',
        '--warn': '#FBBF24',
        '--warn-soft': '#422006',
        '--bad': '#F87171',
        '--bad-soft': '#450A0A',
      }
    : {
        '--good': '#15803D',
        '--good-soft': '#DCFCE7',
        '--warn': '#B45309',
        '--warn-soft': '#FEF3C7',
        '--bad': '#B91C1C',
        '--bad-soft': '#FEE2E2',
      }
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
  const selectedAccent = accentMap[accentName] || accentMap.Blue
  const accent = accentName === 'Blue' && mode === 'dark' ? '#3B82F6' : selectedAccent
  const base = mode === 'dark' ? DARK : LIGHT
  const airy = density !== 'Compact'
  return {
    ...base,
    ...statusVars(mode),
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
    '--text-section': '20px',
    '--text-page': '32px',
    '--leading-body': '1.55',
  }
}

/** Format backend monetary values. The ERP stores amounts directly in UGX. */
export function money(v: number | string | null | undefined): string {
  const n = Number(v || 0)
  return 'UGX ' + Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-UG')
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  UGX: 'USh',
  KES: 'KSh',
  USD: '$',
  TZS: 'TSh',
  RWF: 'FRw',
}

/** Format a supplier quotation in the currency recorded on that quotation. */
export function currencyMoney(v: number | string | null | undefined, currency = 'UGX'): string {
  const n = Number(v || 0)
  const code = currency.trim().toUpperCase() || 'UGX'
  const amount = (Number.isFinite(n) ? n : 0).toLocaleString('en', {
    minimumFractionDigits: 0,
    maximumFractionDigits: code === 'USD' ? 2 : 0,
  })
  return `${CURRENCY_SYMBOLS[code] || code} ${amount}`
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
