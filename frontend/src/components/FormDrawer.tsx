import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { HelpLabel } from './HelpLabel'
import { Icon } from './Icon'
import { cfg, getOptions, type Row } from '../lib/data'

function optionLabel(value: string): string {
  if (value === 'hotel_purchase') return 'Hotel purchase'
  if (value === 'department') return 'Department'
  return value
}

function categoryParentOptions(options: string[], categories: Row[], editingName: string): string[] {
  if (!editingName) return options
  const byName = new Map(categories.map((category) => [String(category.name), category]))

  return options.filter((option) => {
    let category = byName.get(option)
    const visited = new Set<string>()
    while (category && !visited.has(String(category.name))) {
      const name = String(category.name)
      if (name === editingName) return false
      visited.add(name)
      category = byName.get(String(category.parent))
    }
    return true
  })
}

export default function FormDrawer() {
  const app = useApp()
  const f = app.form
  const [values, setValues] = useState<Row>({})
  const [step, setStep] = useState(0)
  const roleKey = app.user.role.trim().toLowerCase()
  const canRequestOnBehalf = app.user.isSuperuser || ['system administrator', 'stores manager'].includes(roleKey)
  const canPurchaseOnBehalf = app.user.isSuperuser || ['system administrator', 'procurement manager', 'general manager'].includes(roleKey)
  const signedInEmployee = app.data.employees.find((employee) =>
    String(employee.employeeCode) === app.user.id || String(employee.userId) === app.user.id,
  )
  const locksStoreIdentity = f?.entity === 'storeRequisitions' && !canRequestOnBehalf
  const locksPurchaseIdentity = f?.entity === 'requisitions' && !canPurchaseOnBehalf

  // Seed the form whenever a new target opens.
  useEffect(() => {
    if (!f) return
    const conf = cfg[f.entity]
    const existing = f.id ? app.data[f.entity].find((x) => x.id === f.id) : null
    const seed: Row = {}
    conf.fields?.forEach((fd) => {
      const fallback = f.entity === 'requisitions' && fd.key === 'currency'
          ? 'UGX'
          : ''
      seed[fd.key] = existing && existing[fd.key] != null ? existing[fd.key] : fallback
    })
    if (f.entity === 'requisitions') {
      seed.request_type = existing?.request_type || 'department'
      if (!canPurchaseOnBehalf && signedInEmployee) {
        seed.department = signedInEmployee.department
        seed.requester = signedInEmployee.name
      }
    }
    if (f.entity === 'storeRequisitions' && !canRequestOnBehalf && signedInEmployee) {
      seed.department = signedInEmployee.department
      seed.requester = signedInEmployee.name
    }
    setValues(seed)
    setStep(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.entity, f?.id, canPurchaseOnBehalf, canRequestOnBehalf, signedInEmployee?.id])

  if (!f) return null
  const conf = cfg[f.entity]
  const fields = conf.fields || []
  const isHotelPurchase = f.entity === 'requisitions' && values.request_type === 'hotel_purchase'
  const visibleFields = fields.filter((fd) => !(isHotelPurchase && ['department', 'requester'].includes(fd.key)))
  const wizard = visibleFields.length > 6
  const pageSize = 4
  const pageCount = wizard ? Math.ceil(visibleFields.length / pageSize) : 1
  const pageFields = wizard ? visibleFields.slice(step * pageSize, (step + 1) * pageSize) : visibleFields
  const title = (f.id ? 'Edit ' : 'Add ') + (conf.singular || '')
  const editingCategoryName = f.entity === 'categories' && f.id
    ? String(app.data.categories.find((category) => category.id === f.id)?.name || '')
    : ''

  const setVal = (key: string, raw: string, numeric: boolean) =>
    setValues((v) => {
      const next = { ...v, [key]: numeric ? Number(raw || 0) : raw }
      if (f.entity === 'requisitions' && key === 'request_type' && raw === 'hotel_purchase') {
        next.department = ''
        next.requester = ''
      }
      return next
    })

  const submit = () => {
    // Coerce numeric fields one more time on save (mirrors prototype).
    const out: Row = {}
    visibleFields.forEach((fd) => {
      const v = values[fd.key]
      out[fd.key] = fd.type === 'number' ? Number(v || 0) : v
    })
    if (f.entity === 'requisitions') {
      out.request_type = values.request_type || 'department'
    }
    app.saveForm(out)
  }

  return (
    <>
      <div className="form-overlay" onClick={app.closeForm} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(16,17,33,.4)' }} />
      <div className="form-drawer" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 71, width: 520, maxWidth: '94vw', background: 'var(--surface)', boxShadow: '-8px 0 28px rgba(15,23,42,.16)', display: 'flex', flexDirection: 'column', animation: 'slideIn .22s ease' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div><div style={{ fontSize: 17, fontWeight: 650, color: 'var(--text)' }}>{title}</div>{wizard && <div style={{ marginTop: 4, color: 'var(--text-faint)', fontSize: 11.5 }}>Step {step + 1} of {pageCount}</div>}</div>
          <button onClick={app.closeForm} className="hover-text" style={{ width: 32, height: 32, border: 'none', background: 'var(--surface-2)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="close" size={19} />
          </button>
        </div>

        {wizard && <div style={{ display: 'grid', gridTemplateColumns: `repeat(${pageCount},1fr)`, gap: 5, padding: '12px 22px', borderBottom: '1px solid var(--border)' }}>{Array.from({ length: pageCount }).map((_, index) => <span key={index} style={{ height: 3, borderRadius: 2, background: index <= step ? 'var(--accent)' : 'var(--border)' }} />)}</div>}

        <div className="form-body" style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {pageFields.map((fd) => {
            const isSelect = fd.type === 'select'
            const numeric = fd.type === 'number'
            const options = fd.opts === 'categoryParents'
              ? categoryParentOptions(getOptions(fd.opts, app.data), app.data.categories, editingCategoryName)
              : getOptions(fd.opts || '', app.data)
            const identityLocked = (locksStoreIdentity && ['department', 'requester', 'store'].includes(fd.key))
              || (locksPurchaseIdentity && ['request_type', 'department', 'requester'].includes(fd.key))
            return (
              <div key={fd.key}>
                <label><HelpLabel label={fd.label} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7 }} /></label>
                {identityLocked ? (
                  <div style={{ minHeight: 42, display: 'flex', alignItems: 'center', gap: 9, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: '0 12px', color: 'var(--text)', fontSize: 13.5 }}>
                    <Icon name={fd.key === 'department' ? 'account_tree' : fd.key === 'request_type' ? 'request_quote' : fd.key === 'store' ? 'warehouse' : 'person'} size={18} color="var(--text-faint)" />
                    <span style={{ flex: 1 }}>{fd.key === 'request_type' ? 'Department request' : fd.key === 'store' ? 'Automatically assigned by branch' : values[fd.key] || 'No employee profile found'}</span>
                    <span style={{ color: 'var(--text-faint)', fontSize: 10.5 }}>From your account</span>
                  </div>
                ) : isSelect ? (
                  <div style={{ position: 'relative' }}>
                    <select value={values[fd.key] ?? ''} onChange={(e) => setVal(fd.key, e.target.value, false)} style={{ width: '100%', height: 42, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: '0 34px 0 12px', fontSize: 13.5, color: 'var(--text)', outline: 'none', cursor: 'pointer' }}>
                      <option value="" />
                      {options.map((opt) => <option key={opt} value={opt}>{optionLabel(opt)}</option>)}
                    </select>
                    <Icon name="expand_more" size={19} color="var(--text-faint)" style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                ) : fd.type === 'textarea' ? (
                  <textarea
                    value={values[fd.key] ?? ''}
                    onChange={(e) => setVal(fd.key, e.target.value, false)}
                    placeholder={fd.label}
                    style={{ width: '100%', minHeight: 92, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: '11px 12px', fontSize: 13.5, color: 'var(--text)', outline: 'none', resize: 'vertical' }}
                  />
                ) : (
                  <input
                    value={values[fd.key] ?? ''}
                    onChange={(e) => setVal(fd.key, e.target.value, numeric)}
                    type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : fd.type === 'password' ? 'password' : 'text'}
                    placeholder={fd.label}
                    style={{ width: '100%', height: 42, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: '0 12px', fontSize: 13.5, color: 'var(--text)', outline: 'none' }}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="form-footer" style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button onClick={app.closeForm} className="hover-surface2" style={{ height: 40, padding: '0 15px', border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--text-muted)', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 550 }}>Cancel</button>
          {wizard && step > 0 && <button onClick={() => setStep((value) => value - 1)} className="hover-surface2" style={{ height: 40, padding: '0 15px', border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 550 }}>Back</button>}
          {wizard && step < pageCount - 1
            ? <button onClick={() => setStep((value) => value + 1)} className="hover-accent" style={{ height: 40, padding: '0 17px', border: 0, cursor: 'pointer', background: 'var(--accent)', color: '#fff', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 600 }}>Continue</button>
            : <button onClick={submit} className="hover-accent" style={{ height: 40, padding: '0 17px', border: 0, cursor: 'pointer', background: 'var(--accent)', color: '#fff', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 600 }}>Save</button>}
        </div>
      </div>
    </>
  )
}
