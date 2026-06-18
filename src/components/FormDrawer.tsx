import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { cfg, getOptions, type Row } from '../lib/data'

export default function FormDrawer() {
  const app = useApp()
  const f = app.form
  const [values, setValues] = useState<Row>({})

  // Seed the form whenever a new target opens.
  useEffect(() => {
    if (!f) return
    const conf = cfg[f.entity]
    const existing = f.id ? app.data[f.entity].find((x) => x.id === f.id) : null
    const seed: Row = {}
    conf.fields?.forEach((fd) => {
      seed[fd.key] = existing && existing[fd.key] != null ? existing[fd.key] : ''
    })
    setValues(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.entity, f?.id])

  if (!f) return null
  const conf = cfg[f.entity]
  const fields = conf.fields || []
  const title = (f.id ? 'Edit ' : 'Add ') + (conf.singular || '')

  const setVal = (key: string, raw: string, numeric: boolean) =>
    setValues((v) => ({ ...v, [key]: numeric ? Number(raw || 0) : raw }))

  const submit = () => {
    // Coerce numeric fields one more time on save (mirrors prototype).
    const out: Row = {}
    fields.forEach((fd) => {
      const v = values[fd.key]
      out[fd.key] = fd.type === 'number' ? Number(v || 0) : v
    })
    app.saveForm(out)
  }

  return (
    <>
      <div onClick={app.closeForm} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(16,17,33,.4)' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 71, width: 440, maxWidth: '92vw', background: 'var(--surface)', boxShadow: '-12px 0 40px rgba(16,17,33,.18)', display: 'flex', flexDirection: 'column', animation: 'slideIn .22s ease' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
          <button onClick={app.closeForm} className="hover-text" style={{ width: 32, height: 32, border: 'none', background: 'var(--surface-2)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="close" size={19} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {fields.map((fd) => {
            const isSelect = fd.type === 'select'
            const numeric = fd.type === 'number'
            return (
              <div key={fd.key}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7 }}>{fd.label}</label>
                {isSelect ? (
                  <div style={{ position: 'relative' }}>
                    <select value={values[fd.key] ?? ''} onChange={(e) => setVal(fd.key, e.target.value, false)} style={{ width: '100%', height: 42, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: '0 34px 0 12px', fontSize: 13.5, color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
                      <option value="" />
                      {getOptions(fd.opts || '', app.data).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    <Icon name="expand_more" size={19} color="var(--text-faint)" style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                ) : (
                  <input
                    value={values[fd.key] ?? ''}
                    onChange={(e) => setVal(fd.key, e.target.value, numeric)}
                    type={fd.type === 'number' ? 'number' : 'text'}
                    placeholder={fd.label}
                    style={{ width: '100%', height: 42, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: '0 12px', fontSize: 13.5, color: 'var(--text)', outline: 'none' }}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
          <button onClick={app.closeForm} className="hover-surface2" style={{ flex: 1, height: 42, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', borderRadius: 11, font: 'inherit', fontSize: 13.5, fontWeight: 700 }}>Cancel</button>
          <button onClick={submit} className="hover-accent" style={{ flex: 1, height: 42, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', borderRadius: 11, font: 'inherit', fontSize: 13.5, fontWeight: 700 }}>Save</button>
        </div>
      </div>
    </>
  )
}
