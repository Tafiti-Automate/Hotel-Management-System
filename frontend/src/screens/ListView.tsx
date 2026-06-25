import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from '../components/Icon'
import { cfg, type ColumnDef, type EntityKey, type Row } from '../lib/data'
import { chipStyleFor, money } from '../lib/theme'

function cellContent(c: ColumnDef, r: Row): { text: string; chip: boolean } {
  const v = r[c.key]
  if (c.kind === 'money' || c.kind === 'money2') return { text: money(v), chip: false }
  if (c.kind === 'rating') return { text: '★ ' + v, chip: false }
  if (c.kind === 'status') return { text: String(v ?? ''), chip: true }
  return { text: String(v ?? ''), chip: false }
}

function cellStyle(c: ColumnDef): CSSProperties {
  const s: CSSProperties = {
    padding: '12px 10px', fontSize: 12.5, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden',
    textOverflow: 'ellipsis', display: 'flex', alignItems: 'center',
    justifyContent: c.align === 'right' ? 'flex-end' : undefined,
  }
  if (c.kind === 'bold') { s.color = 'var(--text)'; s.fontWeight = 700 }
  else if (c.kind === 'mono') { s.color = 'var(--text-muted)'; s.fontFamily = "'JetBrains Mono',monospace"; s.fontSize = 11.5 }
  else if (c.kind === 'num' || c.kind === 'money' || c.kind === 'money2') { s.color = 'var(--text)'; s.fontWeight = 700; s.fontFamily = "'JetBrains Mono',monospace" }
  else if (c.kind === 'rating') { s.color = 'var(--text)'; s.fontWeight = 700 }
  else s.color = 'var(--text-muted)'
  return s
}

export default function ListView() {
  const app = useApp()
  const route = app.route
  const conf = cfg[route]
  if (!conf) return null

  const srcKey = (route === 'approvals' ? 'requisitions' : route) as EntityKey
  let data = (app.data[srcKey] || []).slice()
  if (route === 'approvals') data = data.filter((r) => r.status === 'Pending')

  const term = (app.searchTerm || '').toLowerCase()
  if (term) data = data.filter((r) => conf.cols.some((c) => String(r[c.key]).toLowerCase().includes(term)))

  const grid = conf.cols.map((c) => c.w).join(' ') + ' 96px'
  const headStyle = (c: ColumnDef): CSSProperties => ({
    padding: '9px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: 'var(--text-faint)',
    textTransform: 'uppercase', display: 'flex', alignItems: 'center',
    justifyContent: c.align === 'right' ? 'flex-end' : undefined,
  })

  const onRowClick = (id: string) => {
    if (route === 'requisitions' || route === 'approvals') app.openDetail('requisitions', id, route)
    else if (route === 'orders') app.openDetail('orders', id, 'orders')
  }

  return (
    <div className="list-view">
      <div className="list-toolbar" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div className="list-title" style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Icon name={conf.icon} size={23} color="var(--accent)" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--text)' }}>{conf.title}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{conf.sub}</p>
          </div>
        </div>
        <div className="list-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="list-search" style={{ position: 'relative' }}>
            <Icon name="search" size={18} color="var(--text-faint)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={app.searchTerm} onChange={(e) => app.setSearchTerm(e.target.value)} placeholder="Search…" style={{ width: 210, height: 38, border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 10, padding: '0 12px 0 36px', fontSize: 13, color: 'var(--text)', outline: 'none' }} />
          </div>
          {conf.editable && (
            <button onClick={() => app.openCreate()} className="hover-accent" style={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 15px', border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', borderRadius: 10, font: 'inherit', fontSize: 13, fontWeight: 700, boxShadow: 'var(--shadow-sm)' }}>
              <Icon name="add" size={18} />{conf.add}
            </button>
          )}
        </div>
      </div>

      <div className="data-table" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div className="data-head" style={{ display: 'grid', gridTemplateColumns: grid, borderBottom: '1px solid var(--border)', padding: '0 8px' }}>
          {conf.cols.map((c) => <div key={c.key} style={headStyle(c)}>{c.label}</div>)}
          <div />
        </div>

        {data.map((r) => (
          <div key={r.id} onClick={() => conf.detail && onRowClick(r.id)} className="data-row hover-surface2" style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '0 8px', cursor: conf.detail ? 'pointer' : 'default' }}>
            {conf.cols.map((c, index) => {
              const { text, chip } = cellContent(c, r)
              return (
                <div key={c.key} className="data-cell" data-label={c.label} data-primary={index === 0 ? 'true' : undefined} style={cellStyle(c)}>
                  {chip ? <span style={chipStyleFor(text)}>{text}</span> : text}
                </div>
              )
            })}
            <div className="data-actions" style={{ padding: '10px 8px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              {conf.detail && <Icon name="chevron_right" size={18} color="var(--text-faint)" />}
              {conf.editable && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); app.openEdit(r.id) }} title="Edit" className="hover-edit" style={iconActionStyle}>
                    <Icon name="edit" size={17} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); app.requestDelete(r.id) }} title="Delete" className="hover-del" style={iconActionStyle}>
                    <Icon name="delete" size={17} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

        <div className="list-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', fontSize: 12, color: 'var(--text-muted)' }}>
          <span>Showing <b style={{ color: 'var(--text)' }}>{data.length}</b> records</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button style={pagerStyle}><Icon name="chevron_left" size={17} /></button>
            <span style={{ padding: '0 6px', fontWeight: 700, color: 'var(--text)' }}>1</span>
            <button style={pagerStyle}><Icon name="chevron_right" size={17} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

const iconActionStyle: CSSProperties = {
  width: 30, height: 30, border: 'none', background: 'transparent', borderRadius: 8,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-faint)',
}

const pagerStyle: CSSProperties = {
  width: 30, height: 30, border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 8,
  cursor: 'pointer', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center',
}
