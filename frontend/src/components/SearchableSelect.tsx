import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Icon } from './Icon'

export type SearchOption = { value: string; label: string }

export default function SearchableSelect({ value, onChange, options, placeholder = 'Select…', disabled = false, required = false, style, className, searchLabel = 'Search options' }: {
  value: string; onChange: (value: string) => void; options: SearchOption[]; placeholder?: string
  disabled?: boolean; required?: boolean; style?: CSSProperties; className?: string; searchLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLSelectElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const searchId = useId()
  useEffect(() => { if (open) input.current?.focus() }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matching = options.filter(option => tokens.every(token => option.label.toLocaleLowerCase().includes(token)))
  const filtered = matching.some(option => option.value === value) ? matching : [...options.filter(option => option.value === value), ...matching]
  const clear = () => { setQuery(''); setDraft('') }
  return <div style={{display:'grid', gap:5, minWidth:0}}>
    <div style={{display:'flex', gap:5, alignItems:'center', minWidth:0}}>
      <select ref={picker} required={required} disabled={disabled} value={value} onChange={event => { onChange(event.target.value); clear(); setOpen(false) }}
        className={className} style={{...style, flex:'1 1 0', minWidth:0}}>
        <option value="">{placeholder}</option>
        {filtered.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <button ref={toggle} type="button" disabled={disabled} title={searchLabel} aria-label={searchLabel} aria-expanded={open} aria-controls={searchId}
        style={{background:'var(--surface-2)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:6,padding:7,display:'inline-flex',alignItems:'center',gap:4,flexShrink:0}}
        onClick={()=>{if(open) clear();setOpen(!open)}}><Icon name="search" size={16}/></button>
    </div>
    {open && !disabled && <div id={searchId} style={{display:'grid',gap:5}}>
      <div style={{display:'flex',gap:5}}>
        <input ref={input} aria-label={searchLabel} placeholder="Name or code…" value={draft} style={{...style,flex:1,minWidth:0}}
          onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();setQuery(draft);picker.current?.focus()}if(event.key==='Escape'){event.preventDefault();clear();setOpen(false);toggle.current?.focus()}if(event.key==='ArrowDown'){event.preventDefault();setQuery(draft);picker.current?.focus()}}}/>
        <button type="button" onClick={()=>{setQuery(draft);picker.current?.focus()}} className="mc-secondary">Search</button>
        <button type="button" onClick={clear} className="mc-secondary">Clear</button>
      </div>
      <small style={{color:'var(--text-muted)'}}>Enter or ↓ to search and focus the options · Esc to close</small>
      <small role="status">{matching.length} matching option{matching.length===1?'':'s'}{query && value && !matching.some(option=>option.value===value)?' · Current selection retained':''}</small>
    </div>}
  </div>
}
