import type { CSSProperties } from 'react'
import { helpText } from '../lib/help'
import { Icon } from './Icon'

export function HelpLabel({ label, style }: { label: string; style?: CSSProperties }) {
  const explanation = helpText(label)
  return <span title={explanation} style={{ ...style, display: 'flex', alignItems: 'center', gap: 4, cursor: explanation ? 'help' : undefined }}>
    {label}
    {explanation && <Icon name="help" size={14} color="var(--text-faint)" />}
  </span>
}
