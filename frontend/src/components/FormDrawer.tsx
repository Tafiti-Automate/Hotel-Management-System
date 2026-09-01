import { useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { HelpLabel } from './HelpLabel'
import { Icon } from './Icon'
import { cfg, getOptions, type Row } from '../lib/data'
import { normalizeUgandaPhone, UGANDA_PHONE_HINT } from '../lib/ugandaPhone'

function optionLabel(value: string): string {
  if (value === 'hotel_purchase') return 'Hotel purchase'
  if (value === 'department') return 'Department'
  if (value === 'manual') return 'Other special purchase'
  if (value === 'capital_asset') return 'Equipment or furniture for long-term use'
  if (value === 'emergency') return 'Urgent or emergency purchase'
  if (value === 'project') return 'Purchase for a specific project'
  if (value === 'service') return 'Service or item that is not kept in store'
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

function categoryOptionLabel(option: string, categories: Row[]): string {
  const category = categories.find((candidate) => String(candidate.name) === option)
  return String(category?.path || option)
}

export default function FormDrawer() {
  const app = useApp()
  const f = app.form
  const [values, setValues] = useState<Row>({})
  const [step, setStep] = useState(0)
  const roleKey = app.user.role.trim().toLowerCase()
  const canRequestOnBehalf = app.user.isSuperuser || roleKey === 'system administrator'
  const canPurchaseOnBehalf = app.user.isSuperuser || ['system administrator', 'general manager'].includes(roleKey)
  const signedInEmployee = app.data.employees.find((employee) =>
    String(employee.id) === app.user.employeeId
    || String(employee.employeeCode) === app.user.employeeCode
    || String(employee.userId) === app.user.id,
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
        : f.entity === 'locations' && fd.key === 'status'
          ? 'Active'
          : f.entity === 'locations' && fd.key === 'isDefault'
            ? 'No'
            : ''
      seed[fd.key] = existing && existing[fd.key] != null ? existing[fd.key] : fallback
    })
    if (f.entity === 'requisitions') {
      seed.request_type = existing?.request_type || 'department'
      seed.procurement_source = existing?.procurement_source || 'manual'
      if (!canPurchaseOnBehalf && signedInEmployee) {
        seed.department = signedInEmployee.department
        seed.requester = signedInEmployee.name
      }
    }
    if (f.entity === 'storeRequisitions' && !canRequestOnBehalf && signedInEmployee) {
      seed.department = signedInEmployee.department
      seed.requester = signedInEmployee.name
    }
    if (f.entity === 'items' && existing) {
      const itemGroup = app.data.categories.find((category) => String(category.name) === String(existing.category))
      const majorGroup = app.data.categories.find((category) => String(category.id) === String(itemGroup?.parentId))
      seed.majorGroup = majorGroup?.name || ''
    }
    setValues(seed)
    setStep(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.entity, f?.id, canPurchaseOnBehalf, canRequestOnBehalf, signedInEmployee?.id])

  if (!f) return null
  const conf = cfg[f.entity]
  const fields = conf.fields || []
  const isHotelPurchase = f.entity === 'requisitions' && values.request_type === 'hotel_purchase'
  const visibleFields = fields.filter((fd) => {
    if (isHotelPurchase && ['department', 'requester'].includes(fd.key)) return false
    if (locksStoreIdentity && ['department', 'requester', 'store'].includes(fd.key)) return false
    if (locksPurchaseIdentity && ['request_type', 'department', 'requester'].includes(fd.key)) return false
    if (f.entity === 'employees' && !f.id && fd.key === 'status') return false
    return true
  })
  const wizard = visibleFields.length > 6
  const pageSize = 4
  const pageCount = wizard ? Math.ceil(visibleFields.length / pageSize) : 1
  const pageFields = wizard ? visibleFields.slice(step * pageSize, (step + 1) * pageSize) : visibleFields
  const title = (f.id ? 'Edit ' : 'Add ') + (conf.singular || '')
  const editingRecord = f.id
    ? app.data[f.entity].find((record) => record.id === f.id)
    : null
  const baseUnitLocked = f.entity === 'items' && Boolean(editingRecord?.baseUnitLocked)
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
      if (f.entity === 'itemUnits' && key === 'role') {
        next.unit = ''
        if (raw === 'Base unit') next.conversionFactor = 1
      }
      if (f.entity === 'items' && key === 'majorGroup') next.category = ''
      return next
    })

  const submit = async () => {
    if (f.entity === 'itemUnits' && values.role !== 'Base unit' && Number(values.conversionFactor || 0) <= 1) {
      app.showWorkflowAlert(
        'Invalid unit conversion',
        'The selected unit must contain more than one base stock unit. Example: 1 carton = 12 pieces.',
        'warning',
      )
      return
    }
    if (f.entity === 'itemUnits' && values.role === 'Base unit' && Number(values.conversionFactor || 0) !== 1) {
      app.showWorkflowAlert('Invalid base-unit conversion', 'The Article base stock unit must always have a conversion factor of 1.', 'warning')
      return
    }
    // Normalize numeric fields before saving.
    const out: Row = {}
    visibleFields.forEach((fd) => {
      const v = values[fd.key]
      out[fd.key] = fd.type === 'number' ? Number(v || 0) : v
    })
    try {
      if (f.entity === 'employees') out.contact = normalizeUgandaPhone(values.contact)
      if (f.entity === 'suppliers') out.phone = normalizeUgandaPhone(values.phone, true)
      if (f.entity === 'branches') out.contact = normalizeUgandaPhone(values.contact)
    } catch {
      app.showWorkflowAlert('Invalid Uganda phone number', UGANDA_PHONE_HINT, 'warning')
      return
    }
    if (f.entity === 'employees' && !f.id) out.status = 'Active'
    if (f.entity === 'requisitions') {
      out.request_type = 'department'
      out.procurement_source = values.procurement_source || 'manual'
    }
    if (f.entity === 'storeRequisitions' && !String(values.purpose || '').trim()) {
      app.showWorkflowAlert('Purpose required', 'Enter the reason for this store request before continuing.', 'warning')
      return
    }
    if (f.entity === 'items') {
      if (!String(values.majorGroup || '').trim()) {
        app.showWorkflowAlert('Major Group required', 'Choose the Major Group before selecting an Item Group.', 'warning')
        return
      }
      if (!String(values.category || '').trim()) {
        app.showWorkflowAlert('Item Group required', 'Every item must belong to an Item Group under the selected Major Group.', 'warning')
        return
      }
      const chosenGroup = app.data.categories.find((category) => String(category.name) === String(values.category))
      if (!chosenGroup?.parentId) {
        app.showWorkflowAlert('Choose an Item Group', 'Items cannot be attached directly to a Major Group.', 'warning')
        return
      }
    }
    await app.saveForm(out)
  }

  return (
    <>
      <div className="form-overlay" onClick={app.formSaving ? undefined : app.closeForm} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(16,17,33,.4)' }} />
      <div className="form-drawer" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 71, width: 520, maxWidth: '94vw', background: 'var(--surface)', boxShadow: '-8px 0 28px rgba(15,23,42,.16)', display: 'flex', flexDirection: 'column', animation: 'slideIn .22s ease' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div><div style={{ fontSize: 17, fontWeight: 650, color: 'var(--text)' }}>{title}</div>{wizard && <div style={{ marginTop: 4, color: 'var(--text-faint)', fontSize: 12 }}>Step {step + 1} of {pageCount}</div>}</div>
          <button type="button" onClick={app.closeForm} disabled={app.formSaving} className="hover-text" style={{ width: 32, height: 32, border: 'none', background: 'var(--surface-2)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: app.formSaving ? 'wait' : 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="close" size={19} />
          </button>
        </div>

        {wizard && <div style={{ display: 'grid', gridTemplateColumns: `repeat(${pageCount},1fr)`, gap: 5, padding: '12px 22px', borderBottom: '1px solid var(--border)' }}>{Array.from({ length: pageCount }).map((_, index) => <span key={index} style={{ height: 3, borderRadius: 2, background: index <= step ? 'var(--accent)' : 'var(--border)' }} />)}</div>}

        <div className="form-body" style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {f.entity === 'categories' && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: 12, border: '1px solid var(--accent)', borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--text)', fontSize: 12, lineHeight: 1.5 }}><Icon name="account_tree" size={18} color="var(--accent)" style={{ marginTop: 1 }} /><div><strong>Catalogue structure:</strong> create <strong>Beverages</strong> with no parent, then create <strong>Soft Drinks</strong> under Beverages. Articles such as Water and Soda are added from the Items screen.</div></div>}
          {f.entity === 'itemUnits' && values.item && values.unit && Number(values.conversionFactor || 0) > 0 && <div style={{ padding: 12, borderRadius: 8, background: 'var(--good-soft)', color: 'var(--good)', fontSize: 12, fontWeight: 750 }}>1 {String(values.unit)} = {Number(values.conversionFactor)} {String(app.data.items.find((item) => item.name === values.item)?.uom || 'base units')}</div>}
          {pageFields.map((fd) => {
            const isSelect = fd.type === 'select'
            const numeric = fd.type === 'number'
            let options = fd.opts === 'categoryParents'
              ? categoryParentOptions(getOptions(fd.opts, app.data), app.data.categories, editingCategoryName)
              : getOptions(fd.opts || '', app.data)
            if (fd.opts === 'categories' && values[fd.key] && !options.includes(String(values[fd.key]))) {
              options = [String(values[fd.key]), ...options]
            }
            if (fd.opts === 'itemGroups') {
              options = app.data.categories
                .filter((category) => String(category.parent) === String(values.majorGroup))
                .map((category) => String(category.name))
              if (values[fd.key] && !options.includes(String(values[fd.key]))) options = [String(values[fd.key]), ...options]
            }
            if (fd.opts === 'uoms' && f.entity === 'itemUnits' && values.item) {
              const article = app.data.items.find((item) => item.name === values.item)
              options = values.role === 'Base unit'
                ? options.filter((option) => option === article?.uom)
                : options.filter((option) => option !== article?.uom)
            }
            if (fd.opts === 'uoms' && f.entity === 'supplierItems' && values.article) {
              const article = app.data.items.find((item) => item.name === values.article)
              const configured = app.data.itemUnits
                .filter((entry) => entry.itemId === article?.id && entry.status === 'Active' && ['Purchase unit', 'Alternate unit'].includes(String(entry.role)))
                .map((entry) => String(entry.unit))
              options = Array.from(new Set([String(article?.uom || ''), ...configured].filter(Boolean)))
            }
            const identityLocked = false
            const fieldLocked = baseUnitLocked && fd.key === 'uom'
            const dependencyLocked = f.entity === 'items' && fd.opts === 'itemGroups' && !values.majorGroup
            const selectLocked = fieldLocked || dependencyLocked
            return (
              <div key={fd.key}>
                <label><HelpLabel label={fd.label} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7 }} /></label>
                {identityLocked ? (
                  <div style={{ minHeight: 42, display: 'flex', alignItems: 'center', gap: 9, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: '0 12px', color: 'var(--text)', fontSize: 13.5 }}>
                    <Icon name={fd.key === 'department' ? 'account_tree' : fd.key === 'request_type' ? 'request_quote' : fd.key === 'store' ? 'warehouse' : 'person'} size={18} color="var(--text-faint)" />
                    <span style={{ flex: 1 }}>{fd.key === 'request_type' ? 'Department request' : fd.key === 'store' ? values.store || 'Assigned automatically' : values[fd.key] || 'Assigned automatically'}</span>
                    <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{fd.key === 'store' ? 'Active issuing store' : 'From your account'}</span>
                  </div>
                ) : isSelect ? (
                  <div style={{ position: 'relative' }}>
                    <select disabled={selectLocked} value={values[fd.key] ?? ''} onChange={(e) => setVal(fd.key, e.target.value, false)} style={{ width: '100%', height: 42, border: '1px solid var(--border)', background: selectLocked ? 'var(--surface-3)' : 'var(--surface-2)', borderRadius: 10, padding: '0 34px 0 12px', fontSize: 13.5, color: selectLocked ? 'var(--text-muted)' : 'var(--text)', outline: 'none', cursor: selectLocked ? 'not-allowed' : 'pointer', opacity: selectLocked ? .82 : 1 }}>
                      <option value="">{dependencyLocked ? 'Select a Major Group first' : 'Select an option'}</option>
                      {options.map((opt) => <option key={opt} value={opt}>{['categories', 'itemGroups'].includes(fd.opts || '') ? categoryOptionLabel(opt, app.data.categories) : optionLabel(opt)}</option>)}
                    </select>
                    <Icon name={selectLocked ? 'lock' : 'expand_more'} size={selectLocked ? 16 : 19} color="var(--text-faint)" style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                ) : fd.type === 'textarea' ? (
                  <textarea
                    value={values[fd.key] ?? ''}
                    onChange={(e) => setVal(fd.key, e.target.value, false)}
                    placeholder={fd.placeholder || fd.label}
                    style={{ width: '100%', minHeight: 92, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: '11px 12px', fontSize: 13.5, color: 'var(--text)', outline: 'none', resize: 'vertical' }}
                  />
                ) : (
                  <input
                    value={values[fd.key] ?? ''}
                    onChange={(e) => setVal(fd.key, e.target.value, numeric)}
                    type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : fd.type === 'password' ? 'password' : 'text'}
                    placeholder={fd.placeholder || fd.label}
                    style={{ width: '100%', height: 42, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 10, padding: '0 12px', fontSize: 13.5, color: 'var(--text)', outline: 'none' }}
                  />
                )}
                {fieldLocked && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 7, color: 'var(--text-faint)', fontSize: 12, lineHeight: 1.45 }}>
                    <Icon name="info" size={15} color="var(--text-faint)" style={{ marginTop: 1 }} />
                    <div>
                      <span>
                        Locked because this article already has conversions, stock, or transactions. Keep {String(editingRecord?.uom || 'the current unit')} as the base unit and add larger units under Article Unit Conversions.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          app.closeForm()
                          app.navTo('itemUnits', 'UOM conversions')
                        }}
                        style={{ display: 'block', marginTop: 5, padding: 0, border: 0, background: 'transparent', color: 'var(--accent)', font: 'inherit', fontSize: 12, fontWeight: 650, cursor: 'pointer' }}
                      >
                        Open unit conversions
                      </button>
                    </div>
                  </div>
                )}
                {fd.hint && <div style={{ marginTop: 6, color: 'var(--text-faint)', fontSize: 12, lineHeight: 1.45 }}>{fd.hint}</div>}
              </div>
            )
          })}
        </div>

        <div className="form-footer" style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
          <button type="button" onClick={app.closeForm} disabled={app.formSaving} className="hover-surface2" style={{ height: 40, padding: '0 15px', border: '1px solid var(--border)', cursor: app.formSaving ? 'wait' : 'pointer', background: 'var(--surface)', color: 'var(--text-muted)', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 550 }}>Cancel</button>
          {wizard && step > 0 && <button onClick={() => setStep((value) => value - 1)} className="hover-surface2" style={{ height: 40, padding: '0 15px', border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)', color: 'var(--text)', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 550 }}>Back</button>}
          {wizard && step < pageCount - 1
            ? <button onClick={() => setStep((value) => value + 1)} className="hover-accent" style={{ height: 40, padding: '0 17px', border: 0, cursor: 'pointer', background: 'var(--accent)', color: '#fff', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 600 }}>Continue</button>
            : <button type="button" onClick={submit} disabled={app.formSaving} className="hover-accent" style={{ height: 40, padding: '0 17px', border: 0, cursor: app.formSaving ? 'wait' : 'pointer', opacity: app.formSaving ? .65 : 1, background: 'var(--accent)', color: '#fff', borderRadius: 6, font: 'inherit', fontSize: 12.5, fontWeight: 600 }}>{app.formSaving ? 'Saving…' : f.entity === 'storeRequisitions' && !f.id ? 'Save & add items' : 'Save'}</button>}
        </div>
      </div>
    </>
  )
}
