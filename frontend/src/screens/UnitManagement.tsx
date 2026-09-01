import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import type { Row } from '../lib/data'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const text = (value: unknown) => String(value ?? '')
const number = (value: unknown) => Number(value || 0)

type UnitRelation = Row & { implicitBase?: boolean }

export default function UnitManagement() {
  const app = useApp()
  const units = app.data.uoms || []
  const items = app.data.items || []
  const conversions = app.data.itemUnits || []
  const [query, setQuery] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [articleFilter, setArticleFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')

  const permissionMetadata = app.user.permissions.length > 0
  const canAddUnit = app.user.isSuperuser || app.user.permissions.includes('inventory.add_unitofmeasure') || (!permissionMetadata && app.user.isStaff)
  const canEditUnit = app.user.isSuperuser || app.user.permissions.includes('inventory.change_unitofmeasure') || (!permissionMetadata && app.user.isStaff)
  const canAddConversion = app.user.isSuperuser || app.user.permissions.includes('inventory.add_itemunitprice') || (!permissionMetadata && app.user.isStaff)
  const canEditConversion = app.user.isSuperuser || app.user.permissions.includes('inventory.change_itemunitprice') || (!permissionMetadata && app.user.isStaff)

  const unitUsage = useMemo(() => {
    const result = new Map<string, { base: number; conversions: number; articleNames: string[] }>()
    units.forEach((unit) => result.set(text(unit.id), { base: 0, conversions: 0, articleNames: [] }))
    items.forEach((item) => {
      const usage = result.get(text(item.baseUnitId))
      if (!usage) return
      usage.base += 1
      usage.articleNames.push(text(item.name))
    })
    conversions.forEach((conversion) => {
      const usage = result.get(text(conversion.unitId))
      if (!usage) return
      usage.conversions += 1
      usage.articleNames.push(text(conversion.item))
    })
    return result
  }, [conversions, items, units])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleUnits = useMemo(() => units
    .filter((unit) => {
      if (!normalizedQuery) return true
      const usage = unitUsage.get(text(unit.id))
      return [unit.name, unit.abbr, ...(usage?.articleNames || [])]
        .map(text)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    })
    .sort((a, b) => text(a.name).localeCompare(text(b.name))), [normalizedQuery, unitUsage, units])

  useEffect(() => {
    if (!visibleUnits.length) {
      setSelectedUnitId('')
      return
    }
    if (!visibleUnits.some((unit) => text(unit.id) === selectedUnitId)) {
      setSelectedUnitId(text(visibleUnits[0].id))
    }
  }, [selectedUnitId, visibleUnits])

  const selectedUnit = units.find((unit) => text(unit.id) === selectedUnitId) || null
  const relations = useMemo<UnitRelation[]>(() => {
    if (!selectedUnit) return []
    const explicit: UnitRelation[] = conversions
      .filter((conversion) => text(conversion.unitId) === text(selectedUnit.id))
      .map((conversion): UnitRelation => ({ ...conversion, implicitBase: false }))
    const explicitBaseArticles = new Set(
      explicit
        .filter((conversion) => text(conversion.role).toLowerCase() === 'base unit')
        .map((conversion) => text(conversion.itemId)),
    )
    const bases: UnitRelation[] = items
      .filter((item) => text(item.baseUnitId) === text(selectedUnit.id) && !explicitBaseArticles.has(text(item.id)))
      .map((item): UnitRelation => ({
        id: `base-${text(item.id)}`,
        item: item.name,
        itemId: item.id,
        sku: item.sku,
        unit: selectedUnit.name,
        unitId: selectedUnit.id,
        baseUnit: selectedUnit.name,
        role: 'Base unit',
        conversionFactor: 1,
        baseEquivalent: `1 ${text(selectedUnit.abbr) || text(selectedUnit.name)} = 1 ${text(selectedUnit.abbr) || text(selectedUnit.name)}`,
        sellingPrice: 0,
        status: item.status || 'Active',
        implicitBase: true,
      }))
    return [...bases, ...explicit].sort((a, b) => text(a.item).localeCompare(text(b.item)))
  }, [conversions, items, selectedUnit])

  const relationArticles = useMemo(() => {
    const seen = new Set<string>()
    return relations.filter((relation) => {
      const itemId = text(relation.itemId)
      if (!itemId || seen.has(itemId)) return false
      seen.add(itemId)
      return true
    })
  }, [relations])
  const filteredRelations = relations.filter((relation) => {
    if (articleFilter && text(relation.itemId) !== articleFilter) return false
    if (roleFilter && text(relation.role) !== roleFilter) return false
    return true
  })
  const roles = Array.from(new Set(relations.map((relation) => text(relation.role)).filter(Boolean)))
  const selectedUsage = selectedUnit ? unitUsage.get(text(selectedUnit.id)) : undefined
  const configuredArticles = new Set(conversions.map((conversion) => text(conversion.itemId))).size

  const addConversion = () => app.openCreate('itemUnits', 'Units & conversions', undefined, {
    unit: selectedUnit?.name || '',
    item: articleFilter ? text(items.find((item) => text(item.id) === articleFilter)?.name) : '',
  })

  return <div style={{ maxWidth: 1500, margin: '0 auto' }}>
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <h1 style={{ margin: '0 0 5px', color: 'var(--text)', fontSize: 29, fontWeight: 750 }}>Units &amp; Conversions</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Shared units and article conversion rules.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canAddUnit && <button type="button" onClick={() => app.openCreate('uoms', 'Units & conversions')} style={secondary}><Icon name="add" size={17} />New unit</button>}
        {canAddConversion && <button type="button" disabled={!selectedUnit} onClick={addConversion} style={{ ...primary, opacity: selectedUnit ? 1 : .5 }}><Icon name="calculate" size={17} color="#fff" />Add conversion</button>}
      </div>
    </header>

    <section className="unit-overview-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 9, marginBottom: 12 }}>
      <Summary icon="straighten" label="Unit definitions" value={String(units.length)} note="Shared names and abbreviations" />
      <Summary icon="inventory_2" label="Base assignments" value={String(items.filter((item) => item.baseUnitId).length)} note="Articles with a counting unit" />
      <Summary icon="calculate" label="Conversion rules" value={String(conversions.length)} note="Article-specific equivalents" />
      <Summary icon="verified" label="Configured articles" value={String(configuredArticles)} note="Articles with alternate usage" />
    </section>

    <div className="unit-master-layout" style={{ display: 'grid', gridTemplateColumns: '330px minmax(0,1fr)', minHeight: 620, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
      <aside style={{ minWidth: 0, borderRight: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <div style={panelHeader}><span>Unit library</span><small>{visibleUnits.length} of {units.length}</small></div>
        <div style={{ padding: 9, borderBottom: '1px solid var(--border)' }}>
          <label style={{ display: 'block', position: 'relative' }}>
            <Icon name="search" size={17} color="var(--text-faint)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit or related article…" style={{ ...control, width: '100%', paddingLeft: 34 }} />
          </label>
        </div>
        <div style={{ padding: '7px 6px' }}>
          {visibleUnits.map((unit) => {
            const active = text(unit.id) === selectedUnitId
            const usage = unitUsage.get(text(unit.id))
            return <button key={text(unit.id)} type="button" onClick={() => { setSelectedUnitId(text(unit.id)); setArticleFilter(''); setRoleFilter('') }} style={{ ...unitRow, color: active ? 'var(--accent)' : 'var(--text)', background: active ? 'var(--accent-soft)' : 'transparent' }}>
              <span style={{ ...unitMark, color: active ? '#fff' : 'var(--accent)', background: active ? 'var(--accent)' : 'var(--accent-soft)' }}>{text(unit.abbr).slice(0, 4).toUpperCase() || <Icon name="straighten" size={16} />}</span>
              <span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>{text(unit.name)}</strong><small style={{ display: 'block', marginTop: 2, color: active ? 'var(--accent)' : 'var(--text-faint)' }}>{usage?.base || 0} base · {usage?.conversions || 0} conversion{usage?.conversions === 1 ? '' : 's'}</small></span>
              <Icon name="chevron_right" size={17} color={active ? 'var(--accent)' : 'var(--text-faint)'} />
            </button>
          })}
          {!visibleUnits.length && <Empty icon="search_off" title="No matching units" note="Try a unit name, abbreviation or related article." />}
        </div>
      </aside>

      <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {selectedUnit ? <>
          <div style={{ padding: '15px 17px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div><div style={eyebrow}>Selected unit</div><h2 style={{ margin: '4px 0 2px', color: 'var(--text)', fontSize: 21 }}>{text(selectedUnit.name)}</h2><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Abbreviation: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{text(selectedUnit.abbr) || 'Not recorded'}</strong></div></div>
              {canEditUnit && <button type="button" onClick={() => app.openEdit(text(selectedUnit.id), 'uoms')} style={secondary}><Icon name="edit" size={16} />Edit unit</button>}
            </div>
            <div className="unit-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginTop: 12 }}>
              <Info label="Used as base unit" value={`${selectedUsage?.base || 0} article${selectedUsage?.base === 1 ? '' : 's'}`} />
              <Info label="Explicit conversion rules" value={String(selectedUsage?.conversions || 0)} />
              <Info label="Usage roles" value={roles.length ? roles.join(', ') : 'Base definition only'} />
            </div>
          </div>

          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 220px' }}><span style={filterLabel}>Article</span><select value={articleFilter} onChange={(event) => setArticleFilter(event.target.value)} style={{ ...control, width: '100%' }}><option value="">All related articles</option>{relationArticles.map((relation) => <option key={text(relation.itemId)} value={text(relation.itemId)}>{text(relation.item)} · {text(relation.sku)}</option>)}</select></label>
              <label style={{ flex: '0 1 190px' }}><span style={filterLabel}>Usage role</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} style={{ ...control, width: '100%' }}><option value="">All roles</option>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
              {canAddConversion && <button type="button" onClick={addConversion} style={secondary}><Icon name="add" size={16} />Conversion for this unit</button>}
            </div>
          </div>

          <div style={{ minHeight: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px' }}><strong style={{ color: 'var(--text)', fontSize: 13.5 }}>Article relationships</strong><span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{filteredRelations.length} relationship{filteredRelations.length === 1 ? '' : 's'}</span></div>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <div style={{ minWidth: 820 }}>
              <div className="unit-relation-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(185px,1.4fr) 120px 120px minmax(190px,1.2fr) 115px 90px 42px', padding: '0 9px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}><span style={headCell}>Article</span><span style={headCell}>Base unit</span><span style={headCell}>Used as</span><span style={headCell}>Conversion rule</span><span style={{ ...headCell, justifyContent: 'flex-end' }}>Selling price</span><span style={headCell}>Status</span><span /></div>
              {filteredRelations.map((relation) => <div key={text(relation.id)} className="unit-relation-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(185px,1.4fr) 120px 120px minmax(190px,1.2fr) 115px 90px 42px', minHeight: 58, padding: '0 9px', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                <span style={{ ...bodyCell, display: 'block' }}><strong style={{ display: 'block', color: 'var(--text)' }}>{text(relation.item)}</strong><small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{text(relation.sku)}</small></span>
                <span style={bodyCell}>{text(relation.baseUnit) || '—'}</span>
                <span style={bodyCell}><RoleBadge value={text(relation.role)} implicit={Boolean(relation.implicitBase)} /></span>
                <span style={{ ...bodyCell, color: 'var(--text)', fontWeight: 650 }}>{text(relation.baseEquivalent) || `1 ${text(relation.unit)} = ${number(relation.conversionFactor)} ${text(relation.baseUnit)}`}</span>
                <span style={{ ...bodyCell, justifyContent: 'flex-end' }}>{number(relation.sellingPrice) > 0 ? money(relation.sellingPrice) : '—'}</span>
                <span style={bodyCell}><Status value={text(relation.status)} /></span>
                <span style={bodyCell}>{relation.implicitBase ? (canEditUnit && <button type="button" onClick={() => app.openEdit(text(relation.itemId), 'items')} title="Edit article base unit" style={iconButton}><Icon name="open_in_new" size={15} /></button>) : (canEditConversion && <button type="button" onClick={() => app.openEdit(text(relation.id), 'itemUnits')} title="Edit conversion" style={iconButton}><Icon name="edit" size={15} /></button>)}</span>
              </div>)}
              {!filteredRelations.length && <Empty icon="conversion_path" title="No article relationships" note="This unit is defined once but is not yet assigned as an article base unit or conversion unit." />}
            </div>
          </div>

        </> : <Empty icon="straighten" title="Create the first unit" note="Add a shared unit name and abbreviation before configuring article conversions." />}
      </section>
    </div>
  </div>
}

function Summary({ icon, label, value, note }: { icon: string; label: string; value: string; note: string }) { return <div style={summaryCard}><Icon name={icon} size={19} color="var(--accent)" /><span style={{ minWidth: 0, flex: 1 }}><span style={summaryLabel}>{label}</span><strong style={{ display: 'block', marginTop: 3, color: 'var(--text)', fontSize: 18 }}>{value}</strong><small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)' }}>{note}</small></span></div> }
function Info({ label, value }: { label: string; value: string }) { return <div style={infoCard}><div style={summaryLabel}>{label}</div><div style={{ marginTop: 5, color: 'var(--text)', fontSize: 12.5, fontWeight: 700 }}>{value}</div></div> }
function RoleBadge({ value, implicit }: { value: string; implicit: boolean }) { return <span style={{ display: 'inline-flex', padding: '4px 7px', borderRadius: 999, background: implicit ? 'var(--accent-soft)' : 'var(--surface-3)', color: implicit ? 'var(--accent)' : 'var(--text-muted)', fontSize: 10.5, fontWeight: 750, whiteSpace: 'nowrap' }}>{value}</span> }
function Status({ value }: { value: string }) { const active = !value || value.toLowerCase() === 'active'; return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: active ? 'var(--good)' : 'var(--text-muted)', fontSize: 11, fontWeight: 750 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: active ? 'var(--good)' : 'var(--text-faint)' }} />{value || 'Active'}</span> }
function Empty({ icon, title, note }: { icon: string; title: string; note: string }) { return <div style={{ padding: 46, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}><Icon name={icon} size={27} color="var(--text-faint)" /><div style={{ marginTop: 8, color: 'var(--text)', fontWeight: 750 }}>{title}</div><div style={{ marginTop: 4 }}>{note}</div></div> }

const control: CSSProperties = { height: 38, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12, outline: 'none' }
const primary: CSSProperties = { minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const secondary: CSSProperties = { minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: 12, fontWeight: 650, cursor: 'pointer' }
const iconButton: CSSProperties = { width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
const panelHeader: CSSProperties = { minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 13px', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 11.5, fontWeight: 750 }
const unitRow: CSSProperties = { width: '100%', minHeight: 54, display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', border: 0, borderRadius: 7, textAlign: 'left', cursor: 'pointer', font: 'inherit' }
const unitMark: CSSProperties = { width: 42, height: 34, display: 'grid', placeItems: 'center', flex: 'none', borderRadius: 7, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 800 }
const summaryCard: CSSProperties = { minWidth: 0, minHeight: 82, display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 13px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)' }
const infoCard: CSSProperties = { minWidth: 0, padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }
const summaryLabel: CSSProperties = { display: 'block', color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.035em' }
const eyebrow: CSSProperties = { color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.045em' }
const filterLabel: CSSProperties = { display: 'block', marginBottom: 5, color: 'var(--text-muted)', fontSize: 10.5, fontWeight: 750, textTransform: 'uppercase' }
const headCell: CSSProperties = { minWidth: 0, minHeight: 40, display: 'flex', alignItems: 'center', padding: '0 8px', color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }
const bodyCell: CSSProperties = { minWidth: 0, display: 'flex', alignItems: 'center', padding: '8px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-muted)', fontSize: 12 }
