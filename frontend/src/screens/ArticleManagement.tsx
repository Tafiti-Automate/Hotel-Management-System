import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import type { Row } from '../lib/data'
import { money } from '../lib/theme'
import { useApp } from '../state/AppContext'

const text = (value: unknown) => String(value ?? '')
const number = (value: unknown) => Number(value || 0)

function FolderIcon({ open = false, active = false, size = 18 }: { open?: boolean; active?: boolean; size?: number }) {
  const color = active ? 'var(--accent)' : 'var(--text-muted)'
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block' }}>
    <path d="M3.5 6.4c0-1 .8-1.8 1.8-1.8h4l1.7 1.8h7.7c1 0 1.8.8 1.8 1.8v1H3.5V6.4Z" fill={color} opacity={open ? .7 : .56} />
    {open
      ? <path d="M3.9 9.2h16.6c.8 0 1.4.7 1.2 1.5L19.1 18c-.2.8-.9 1.3-1.7 1.3H5.8c-.8 0-1.4-.5-1.6-1.2l-1.5-7c-.2-.9.4-1.9 1.2-1.9Z" fill={color} />
      : <path d="M3.5 8.8h17v8.3c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8V8.8Z" fill={color} />}
  </svg>
}

function ArticleIcon({ active = false, size = 17 }: { active?: boolean; size?: number }) {
  const color = active ? 'var(--accent)' : 'var(--text-faint)'
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block' }}>
    <path d="M5 7.2 12 3l7 4.2v9.6L12 21l-7-4.2V7.2Z" stroke={color} strokeWidth="1.65" strokeLinejoin="round" />
    <path d="m5.3 7.4 6.7 4 6.7-4M12 11.4V21" stroke={color} strokeWidth="1.65" strokeLinejoin="round" />
  </svg>
}

function stockState(item: Row) {
  const onHand = number(item.onHand)
  const reorder = number(item.reorder)
  if (onHand <= 0) return { label: 'Out of stock', color: 'var(--bad)', background: 'var(--bad-soft)', icon: 'cancel' }
  if (reorder > 0 && onHand <= reorder) return { label: 'Below reorder', color: 'var(--warn)', background: 'var(--warn-soft)', icon: 'warning' }
  return { label: 'Available', color: 'var(--good)', background: 'var(--good-soft)', icon: 'check_circle' }
}

export default function ArticleManagement() {
  const app = useApp()
  const categories = app.data.categories || []
  const items = app.data.items || []
  const quotations = app.data.supplierItems || []
  const conversions = app.data.itemUnits || []
  const balances = app.data.balances || []
  const [query, setQuery] = useState('')
  const [selectedItemId, setSelectedItemId] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const permissionMetadata = app.user.permissions.length > 0
  const canAddItem = app.user.isSuperuser || app.user.permissions.includes('inventory.add_item') || (!permissionMetadata && app.user.isStaff)
  const canEditItem = app.user.isSuperuser || app.user.permissions.includes('inventory.change_item') || (!permissionMetadata && app.user.isStaff)
  const canAddQuote = app.user.isSuperuser || app.user.permissions.includes('inventory.add_supplieritemprice') || (!permissionMetadata && app.user.isStaff)

  const roots = useMemo(
    () => categories.filter((category) => !category.parentId).sort((a, b) => text(a.name).localeCompare(text(b.name))),
    [categories],
  )
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Row[]>()
    categories.filter((category) => category.parentId).forEach((category) => {
      const key = text(category.parentId)
      map.set(key, [...(map.get(key) || []), category])
    })
    map.forEach((entries) => entries.sort((a, b) => text(a.name).localeCompare(text(b.name))))
    return map
  }, [categories])
  const itemsByCategory = useMemo(() => {
    const map = new Map<string, Row[]>()
    items.forEach((item) => {
      const key = text(item.categoryId)
      map.set(key, [...(map.get(key) || []), item])
    })
    map.forEach((entries) => entries.sort((a, b) => text(a.name).localeCompare(text(b.name))))
    return map
  }, [items])

  const normalizedQuery = query.trim().toLowerCase()
  const matchingIds = useMemo(() => {
    if (!normalizedQuery) return null
    const result = new Set<string>()
    items.forEach((item) => {
      const itemQuotes = quotations.filter((quote) => text(quote.articleId) === text(item.id))
      const haystack = [item.name, item.sku, item.category, item.categoryPath, item.businessType, item.store, ...itemQuotes.map((quote) => quote.supplier)].map(text).join(' ').toLowerCase()
      if (haystack.includes(normalizedQuery)) result.add(text(item.id))
    })
    return result
  }, [items, normalizedQuery, quotations])
  const visibleItem = (item: Row) => !matchingIds || matchingIds.has(text(item.id))
  const visibleGroups = (rootId: string) => (childrenByParent.get(rootId) || []).filter((group) => (itemsByCategory.get(text(group.id)) || []).some(visibleItem))

  useEffect(() => {
    if (!expanded.size && roots.length) {
      const next = new Set<string>()
      roots.forEach((root) => next.add(text(root.id)))
      const firstGroup = childrenByParent.get(text(roots[0]?.id))?.[0]
      if (firstGroup) next.add(text(firstGroup.id))
      setExpanded(next)
    }
  }, [childrenByParent, expanded.size, roots])

  useEffect(() => {
    const eligible = items.filter(visibleItem)
    if (!eligible.length) {
      setSelectedItemId('')
      return
    }
    if (!selectedItemId || !eligible.some((item) => text(item.id) === selectedItemId)) setSelectedItemId(text(eligible[0].id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, matchingIds, selectedItemId])

  const selectedItem = items.find((item) => text(item.id) === selectedItemId) || null
  const selectedGroup = selectedItem ? categories.find((category) => text(category.id) === text(selectedItem.categoryId)) : null
  const selectedMajor = selectedGroup?.parentId ? categories.find((category) => text(category.id) === text(selectedGroup.parentId)) : null
  const itemQuotes = selectedItem ? quotations.filter((quote) => text(quote.articleId) === text(selectedItem.id)) : []
  const activeQuotes = itemQuotes.filter((quote) => text(quote.status).toLowerCase() === 'active').sort((a, b) => number(a.price) - number(b.price))
  const itemConversions = selectedItem ? conversions.filter((entry) => text(entry.itemId) === text(selectedItem.id)) : []
  const itemBalances = selectedItem ? balances.filter((entry) => text(entry.item) === text(selectedItem.name) || text(entry.itemId) === text(selectedItem.id)) : []
  const state = selectedItem ? stockState(selectedItem) : null
  const supplierCount = new Set(activeQuotes.map((quote) => text(quote.supplierId) || text(quote.supplier))).size
  const lowestQuote = activeQuotes.length ? activeQuotes[0] : null

  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  const chooseItem = (item: Row) => {
    setSelectedItemId(text(item.id))
    const group = categories.find((category) => text(category.id) === text(item.categoryId))
    setExpanded((current) => {
      const next = new Set(current)
      if (group) next.add(text(group.id))
      if (group?.parentId) next.add(text(group.parentId))
      return next
    })
  }
  const addItem = () => app.openCreate('items', 'Item Grouping', 'item')
  const addQuote = () => selectedItem && app.openCreate('supplierItems', 'Add supplier quotation', undefined, { article: text(selectedItem.name) })
  const exportCsv = () => {
    const quote = (value: unknown) => `"${text(value).replace(/"/g, '""')}"`
    const csv = [
      ['Major Group', 'Item Group', 'Item', 'SKU', 'Base UOM', 'Business Type', 'On Hand', 'Reorder', 'Reference Cost', 'Status'],
      ...items.filter(visibleItem).map((item) => {
        const group = categories.find((category) => text(category.id) === text(item.categoryId))
        const major = group?.parentId ? categories.find((category) => text(category.id) === text(group.parentId)) : null
        return [major?.name || '', group?.name || '', item.name, item.sku, item.uom, item.businessType, item.onHand, item.reorder, item.unitCost, stockState(item).label]
      }),
    ].map((row) => row.map(quote).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `article-master-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return <div className="article-master-screen" style={{ width: '100%', maxWidth: 1500, height: '100%', minHeight: 0, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
      <div>
        <h1 style={{ margin: '0 0 5px', color: 'var(--text)', fontSize: 29, fontWeight: 750 }}>Articles / Items</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Stock and article controls.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={exportCsv} style={secondary}><Icon name="download" size={17} />Export CSV</button>
        {canAddItem && <button type="button" onClick={addItem} style={primary}><Icon name="add" size={17} />Add item</button>}
      </div>
    </header>

    <div style={{ position: 'relative', marginBottom: 12 }}>
      <Icon name="search" size={19} color="var(--text-faint)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item, SKU, group or supplier…" style={{ ...control, width: '100%', height: 42, paddingLeft: 38, paddingRight: query ? 42 : 12 }} />
      {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear article search" style={{ ...iconButton, position: 'absolute', right: 5, top: 4, border: 0 }}><Icon name="close" size={17} /></button>}
    </div>

    <div className="catalogue-layout article-master-layout" style={{ display: 'grid', gridTemplateColumns: '360px minmax(0,1fr)', flex: '1 1 auto', minHeight: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
      <aside className="article-master-explorer" style={{ borderRight: '1px solid var(--border)', background: 'var(--surface-2)', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={panelHeader}><span>Article explorer</span><small>{items.filter(visibleItem).length} item{items.filter(visibleItem).length === 1 ? '' : 's'}</small></div>
        <div className="article-master-explorer-tree" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 7px' }}>
          {roots.map((root) => {
            const rootId = text(root.id)
            const groups = visibleGroups(rootId)
            if (matchingIds && !groups.length) return null
            const rootOpen = expanded.has(rootId)
            return <div key={rootId} style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button type="button" onClick={() => toggle(rootId)} aria-label={`${rootOpen ? 'Collapse' : 'Expand'} ${text(root.name)}`} style={treeToggle}><Icon name={rootOpen ? 'expand_more' : 'chevron_right'} size={18} /></button>
                <div style={{ ...treeRow, cursor: 'default', color: 'var(--text)', fontWeight: 750 }}><FolderIcon open={rootOpen} /><span style={{ flex: 1 }}>{text(root.name)}</span><small>{groups.length} group{groups.length === 1 ? '' : 's'}</small></div>
              </div>
              {rootOpen && groups.map((group) => {
                const groupId = text(group.id)
                const groupOpen = expanded.has(groupId)
                const groupItems = (itemsByCategory.get(groupId) || []).filter(visibleItem)
                return <div key={groupId}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button type="button" onClick={() => toggle(groupId)} aria-label={`${groupOpen ? 'Collapse' : 'Expand'} ${text(group.name)}`} style={{ ...treeToggle, marginLeft: 18 }}><Icon name={groupOpen ? 'expand_more' : 'chevron_right'} size={18} /></button>
                    <div style={{ ...treeRow, cursor: 'default', color: 'var(--text-muted)', fontWeight: 650 }}><FolderIcon open={groupOpen} /><span style={{ flex: 1 }}>{text(group.name)}</span><small>{groupItems.length}</small></div>
                  </div>
                  {groupOpen && <div style={{ marginLeft: 49, borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
                    {groupItems.map((item) => {
                      const active = selectedItemId === text(item.id)
                      const status = stockState(item)
                      return <button type="button" key={text(item.id)} onClick={() => chooseItem(item)} style={{ ...treeLeaf, width: 'calc(100% - 8px)', color: active ? 'var(--accent)' : 'var(--text-muted)', background: active ? 'var(--accent-soft)' : 'transparent', fontWeight: active ? 750 : 600 }}>
                        <ArticleIcon active={active} />
                        <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text(item.name)}</span><small style={{ display: 'block', marginTop: 1, color: active ? 'var(--accent)' : 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{text(item.sku)}</small></span>
                        <span title={status.label} style={{ width: 7, height: 7, borderRadius: 999, background: status.color, flex: 'none' }} />
                      </button>
                    })}
                  </div>}
                </div>
              })}
            </div>
          })}
          {!items.filter(visibleItem).length && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No articles match this search.</div>}
        </div>
      </aside>

      <section className="article-master-detail" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {selectedItem && state ? <>
          <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.045em' }}>Article master record</div>
                <h2 style={{ margin: '4px 0 2px', color: 'var(--text)', fontSize: 21, fontWeight: 750 }}>{text(selectedItem.name)}</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{text(selectedMajor?.name)} › {text(selectedGroup?.name)} · <span style={{ fontFamily: 'var(--font-mono)' }}>{text(selectedItem.sku)}</span></div>
              </div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {canAddQuote && <button type="button" onClick={addQuote} style={secondary}><Icon name="request_quote" size={16} />Add quotation</button>}
                {canEditItem && <button type="button" onClick={() => app.openEdit(text(selectedItem.id), 'items')} style={primary}><Icon name="edit" size={16} />Edit item</button>}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(0,1fr))', gap: 8, marginTop: 14 }} className="article-summary-grid">
              <Summary label="On hand" value={number(selectedItem.onHand).toLocaleString()} sub={text(selectedItem.store) || 'All stores'} />
              <Summary label="Reorder level" value={number(selectedItem.reorder).toLocaleString()} />
              <Summary label="Base unit" value={text(selectedItem.uom) || '—'} />
              <Summary label="Reference cost" value={number(selectedItem.unitCost) ? money(selectedItem.unitCost) : 'Not priced'} />
              <Summary label="Suppliers" value={String(supplierCount)} sub="Active quotes" />
              <div style={{ ...summaryCard, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}><div style={summaryLabel}>Stock status</div><span style={{ marginTop: 5, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, color: state.color, background: state.background, fontSize: 11.5, fontWeight: 750 }}><Icon name={state.icon} size={14} color={state.color} />{state.label}</span></div>
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr .8fr .8fr', gap: 8 }} className="article-control-grid">
              <Info label="Business classification" value={text(selectedItem.businessType) || '—'} />
              <Info label="Batch tracking" value={selectedItem.batchTracking ? 'Enabled' : 'Not used'} />
              <Info label="Expiry tracking" value={selectedItem.expiryTracking ? 'Enabled' : 'Not used'} />
              <Info label="Maximum level" value={selectedItem.maximumLevel == null ? 'Not set' : number(selectedItem.maximumLevel).toLocaleString()} />
            </div>
          </div>

          <section style={{ padding: '13px 14px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ marginBottom: 9, color: 'var(--text)', fontSize: 13.5, fontWeight: 750 }}>Related setup</div>
            <div className="article-related-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 9 }}>
              <RelatedWorkspace
                icon="request_quote"
                title="Supplier quotations"
                value={`${activeQuotes.length} active · ${supplierCount} supplier option${supplierCount === 1 ? '' : 's'}`}
                note={lowestQuote ? `Lowest active price ${money(lowestQuote.price || 0)}` : 'No active price recorded'}
                action="Open price comparison"
                onClick={() => app.navTo('supplierItems', 'Supplier quotations')}
              />
              <RelatedWorkspace
                icon="straighten"
                title="Units & conversions"
                value={`Base unit: ${text(selectedItem.uom) || 'not recorded'}`}
                note={`${itemConversions.length} article conversion${itemConversions.length === 1 ? '' : 's'} configured`}
                action="Open unit setup"
                onClick={() => app.navTo('uoms', 'Units & conversions')}
              />
            </div>
          </section>

          <section style={{ flex: 1 }}>
            <SectionHeader title="Store position" subtitle="Current stock by store where balance records are available." count={`${itemBalances.length || (selectedItem.store ? 1 : 0)} location${(itemBalances.length || (selectedItem.store ? 1 : 0)) === 1 ? '' : 's'}`} />
            {itemBalances.length ? <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 620 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.5fr) 110px 110px 110px 120px', padding: '0 10px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}><span style={headCell}>Store</span><span style={{ ...headCell, justifyContent: 'flex-end' }}>On hand</span><span style={{ ...headCell, justifyContent: 'flex-end' }}>Reserved</span><span style={{ ...headCell, justifyContent: 'flex-end' }}>Available</span><span style={headCell}>Status</span></div>
              {itemBalances.map((balance) => <div key={text(balance.id)} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1.5fr) 110px 110px 110px 120px', minHeight: 48, padding: '0 10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}><span style={{ ...bodyCell, color: 'var(--text)', fontWeight: 700 }}>{text(balance.store)}</span><span style={{ ...bodyCell, justifyContent: 'flex-end' }}>{number(balance.onHand).toLocaleString()}</span><span style={{ ...bodyCell, justifyContent: 'flex-end' }}>{number(balance.reserved).toLocaleString()}</span><span style={{ ...bodyCell, justifyContent: 'flex-end', color: 'var(--text)', fontWeight: 700 }}>{number(balance.available).toLocaleString()}</span><span style={bodyCell}><Status value={text(balance.status) || 'Active'} /></span></div>)}
            </div></div> : selectedItem.store ? <div style={{ padding: '12px 14px' }}><Info label="Current store" value={`${text(selectedItem.store)} · ${number(selectedItem.onHand).toLocaleString()} on hand`} /></div> : <Empty icon="warehouse" title="No store balance recorded" note="Stock will appear here after the article has a balance in a store." compact />}
          </section>

          <footer style={{ minHeight: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 11.5 }}><span>{text(selectedMajor?.name)} › {text(selectedGroup?.name)}</span><span>·</span><span>{supplierCount} supplier option{supplierCount === 1 ? '' : 's'}</span><span style={{ flex: 1 }} />{lowestQuote && <span>Lowest active quote: <strong style={{ color: 'var(--text)' }}>{money(lowestQuote.price || 0)}</strong></span>}</footer>
        </> : <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}><div><ArticleIcon size={28} /><div style={{ marginTop: 10, color: 'var(--text)', fontWeight: 750 }}>Select an article</div><div style={{ marginTop: 4, fontSize: 12 }}>Choose an article from the explorer to view its master record.</div></div></div>}
      </section>
    </div>
  </div>
}

function Summary({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div style={summaryCard}><div style={summaryLabel}>{label}</div><div style={{ marginTop: 4, color: 'var(--text)', fontSize: 13, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>{sub && <div style={{ marginTop: 2, color: 'var(--text-faint)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}</div>
}
function Info({ label, value }: { label: string; value: string }) { return <div style={summaryCard}><div style={summaryLabel}>{label}</div><div style={{ marginTop: 5, color: 'var(--text)', fontSize: 12.5, fontWeight: 650 }}>{value}</div></div> }
function RelatedWorkspace({ icon, title, value, note, action, onClick }: { icon: string; title: string; value: string; note: string; action: string; onClick: () => void }) { return <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, padding: '12px 13px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}><span style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', flex: 'none', borderRadius: 8, color: 'var(--accent)', background: 'var(--accent-soft)' }}><Icon name={icon} size={19} color="var(--accent)" /></span><span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: 'block', color: 'var(--text)', fontSize: 12.5 }}>{title}</strong><span style={{ display: 'block', marginTop: 3, color: 'var(--text-muted)', fontSize: 11.5 }}>{value}</span><small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)' }}>{note}</small></span><button type="button" onClick={onClick} style={{ ...smallAction, flex: 'none' }}>{action}<Icon name="arrow_forward" size={15} /></button></div> }
function SectionHeader({ title, subtitle, count, action }: { title: string; subtitle: string; count: string; action?: React.ReactNode }) { return <div style={{ minHeight: 54, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', justifyContent: 'space-between', flexWrap: 'wrap' }}><div><div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 750 }}>{title}</div><div style={{ marginTop: 2, color: 'var(--text-faint)', fontSize: 11.5 }}>{subtitle}</div></div><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{action}<span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{count}</span></div></div> }
function Status({ value }: { value: string }) { const active = value.toLowerCase() === 'active' || value.toLowerCase() === 'ok'; return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, color: active ? 'var(--good)' : 'var(--text-muted)', background: active ? 'var(--good-soft)' : 'var(--surface-3)', fontSize: 11.5, fontWeight: 750 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: active ? 'var(--good)' : 'var(--text-faint)' }} />{value || 'Inactive'}</span> }
function Empty({ icon, title, note, compact = false }: { icon: string; title: string; note: string; compact?: boolean }) { return <div style={{ padding: compact ? '18px 14px' : '38px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}><Icon name={icon} size={compact ? 21 : 26} color="var(--text-faint)" /><div style={{ marginTop: 6, color: 'var(--text)', fontWeight: 750 }}>{title}</div><div style={{ marginTop: 3 }}>{note}</div></div> }

const control: CSSProperties = { height: 38, border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 12, outline: 'none' }
const primary: CSSProperties = { minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', border: 0, borderRadius: 7, background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const secondary: CSSProperties = { minHeight: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', font: 'inherit', fontSize: 12, fontWeight: 650, cursor: 'pointer' }
const smallAction: CSSProperties = { minHeight: 30, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--accent)', font: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }
const iconButton: CSSProperties = { width: 34, height: 34, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
const panelHeader: CSSProperties = { minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 13px', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 11.5, fontWeight: 750 }
const treeToggle: CSSProperties = { width: 26, height: 36, display: 'grid', placeItems: 'center', flex: 'none', border: 0, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }
const treeRow: CSSProperties = { minWidth: 0, flex: 1, minHeight: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', border: 0, borderRadius: 7, textAlign: 'left', font: 'inherit', fontSize: 12, background: 'transparent' }
const treeLeaf: CSSProperties = { minHeight: 46, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: 0, borderRadius: 7, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 11.5 }
const summaryCard: CSSProperties = { minWidth: 0, padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }
const summaryLabel: CSSProperties = { color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.035em' }
const headCell: CSSProperties = { minWidth: 0, minHeight: 40, display: 'flex', alignItems: 'center', padding: '0 8px', color: 'var(--text-faint)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }
const bodyCell: CSSProperties = { minWidth: 0, display: 'flex', alignItems: 'center', padding: '8px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-muted)', fontSize: 12 }
