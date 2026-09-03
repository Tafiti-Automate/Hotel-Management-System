import { useEffect, useState, type CSSProperties } from 'react'

interface AvatarProps {
  src?: string | null
  name: string
  size?: number
  radius?: number | string
  className?: string
  style?: CSSProperties
  alt?: string
}

export function Avatar({ src, name, size = 34, radius = '50%', className, style, alt }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const initials = String(name || '?').split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?'
  const base: CSSProperties = {
    width: size, height: size, flex: 'none', borderRadius: radius, overflow: 'hidden',
    display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)',
    fontSize: Math.max(10, Math.round(size * .34)), fontWeight: 800, ...style,
  }
  if (src && !failed) {
    return <span className={className} style={base}><img src={src} alt={alt || `${name} profile`} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></span>
  }
  return <span className={className} style={base} aria-label={`${name} profile initials`}>{initials}</span>
}
