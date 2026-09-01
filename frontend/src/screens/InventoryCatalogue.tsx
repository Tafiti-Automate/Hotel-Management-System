import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { errorMessage, importItems } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

const id = (value: unknown) => String(value || '')
const num = (value: unknown) => Number(value || 0)

type TreeSelection = { type: 'category' | 'item' | 'unassigned'; id: string }


function FolderTreeIcon({ open = false, color = 'currentColor', size = 18 }: { open?: boolean; color?: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block' }}>
    <path d="M3.4 6.2c0-1 .8-1.8 1.8-1.8h4.2l2 2.1h7.4c1 0 1.8.8 1.8 1.8v1.1H3.4V6.2Z" fill={color} opacity={open ? .72 : .62} />
    {open
      ? <path d="M3.7 9.1h16.8c.8 0 1.4.8 1.1 1.6l-2.5 7.2c-.2.7-.9 1.2-1.7 1.2H5.7c-.8 0-1.5-.6-1.7-1.4L2.7 10.6c-.1-.8.4-1.5 1-1.5Z" fill={color} />
      : <path d="M3.4 8.7h17.2v8.6c0 1-.8 1.8-1.8 1.8H5.2c-1 0-1.8-.8-1.8-1.8V8.7Z" fill={color} />}
  </svg>
}

function ItemTreeIcon({ color = 'currentColor', size = 17 }: { color?: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flex: 'none', display: 'block' }}>
    <path d="M5 7.2 12 3l7 4.2v9.6L12 21l-7-4.2V7.2Z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
    <path d="m5.3 7.4 6.7 4 6.7-4M12 11.4V21" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
}

function stockPresentation(item: Row) {
  const stock = num(item.onHand)
  const reorder = num(item.reorder)
  if (stock <= 0) return { label: 'Out of stock', icon: 'cancel', color: 'var(--bad)', background: 'var(--bad-soft)' }
  if (stock <= reorder) return { label: 'Low stock', icon: 'warning', color: 'var(--warn)', background: 'var(--warn-soft)' }
  return { label: 'In stock', icon: 'check_circle', color: 'var(--good)', background: 'var(--good-soft)' }
}

export default function InventoryCatalogue() {
  const app = useApp()
  const categories = app.data.categories
  const items = app.data.items
  const roots = useMemo(
    () => categories.filter((category) => !category.parentId).sort((a, b) => id(a.name).localeCompare(id(b.name))),
    [categories],
  )
  const childrenByParent = useMemo(() => {
    const result = new Map<string, Row[]>()
    categories.filter((category) => category.parentId).forEach((category) => {
      const key = id(category.parentId)
      result.set(key, [...(result.get(key) || []), category])
    })
    result.forEach((children) => children.sort((a, b) => id(a.name).localeCompare(id(b.name))))
    return result
  }, [categories])
  const itemsByCategory = useMemo(() => {
    const result = new Map<string, Row[]>()
    items.forEach((item) => {
      const key = id(item.categoryId)
      result.set(key, [...(result.get(key) || []), item])
    })
    result.forEach((entries) => entries.sort((a, b) => id(a.name).localeCompare(id(b.name))))
    return result
  }, [items])
  const firstSelectableId = id(childrenByParent.get(id(roots[0]?.id))?.[0]?.id || roots[0]?.id)
  const [selected, setSelected] = useState<TreeSelection>({ type: 'category', id: '' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setExpanded((current) => {
      if (current.size) return current
      const next = new Set<string>()
      roots.forEach((root) => {
        next.add(id(root.id))
        const firstChild = childrenByParent.get(id(root.id))?.[0]
        if (firstChild) next.add(id(firstChild.id))
      })
      return next
    })
    if (!selected.id && firstSelectableId) setSelected({ type: 'category', id: firstSelectableId })
  }, [childrenByParent, firstSelectableId, roots, selected.id])

  const selectedCategory = selected.type === 'category' || selected.type === 'unassigned'
    ? categories.find((category) => id(category.id) === selected.id)
    : categories.find((category) => id(category.id) === id(items.find((item) => id(item.id) === selected.id)?.categoryId))

  const selectedItem = selected.type === 'item'
    ? items.find((item) => id(item.id) === selected.id)
    : null

  const selectedIds = useMemo(() => {
    if (selected.type === 'item') return new Set([id(selectedItem?.id)])
    if (selected.type === 'unassigned') return new Set([selected.id])
    if (!selectedCategory) return new Set<string>()
    if (selectedCategory.parentId) return new Set([id(selectedCategory.id)])
    return new Set([id(selectedCategory.id), ...(childrenByParent.get(id(selectedCategory.id)) || []).map((child) => id(child.id))])
  }, [childrenByParent, selected.type, selectedCategory, selectedItem])

  const normalizedQuery = query.trim().toLowerCase()
  const displayedItems = items.filter((item) => {
    if (normalizedQuery) {
      return [item.sku, item.name, item.category, item.categoryPath]
        .some((value) => id(value).toLowerCase().includes(normalizedQuery))
    }
    if (selected.type === 'item') return id(item.id) === selected.id
    if (selected.type === 'unassigned') return id(item.categoryId) === selected.id
    return selectedIds.size ? selectedIds.has(id(item.categoryId)) : true
  })

  const selectedParent = selectedCategory?.parentId
    ? categories.find((category) => id(category.id) === id(selectedCategory.parentId))
    : null
  const breadcrumb = normalizedQuery
    ? `Search results for “${query.trim()}”`
    : selected.type === 'unassigned'
      ? `${id(selectedCategory?.name)} › Unassigned Items`
      : selectedItem
        ? `${id(selectedItem.categoryPath || selectedCategory?.name)} › ${id(selectedItem.name)}`
        : selectedParent
        ? `${id(selectedParent.name)} › ${id(selectedCategory?.name)}`
        : id(selectedCategory?.name) || 'All inventory'
  const permissionMetadata = app.user.permissions.length > 0
  const canMaintainCategories = app.user.isSuperuser
    || app.user.permissions.includes('inventory.add_category')
    || (!permissionMetadata && app.user.isStaff)
  const canMaintainItems = app.user.isSuperuser
    || app.user.permissions.includes('inventory.add_item')
    || (!permissionMetadata && app.user.isStaff)

  const chooseCategory = (category: Row) => {
    setSelected({ type: 'category', id: id(category.id) })
    setQuery('')
    setSelectedItems(new Set())
  }
  const chooseUnassigned = (root: Row) => {
    const rootId = id(root.id)
    setSelected({ type: 'unassigned', id: rootId })
    setQuery('')
    setSelectedItems(new Set())
    setExpanded((current) => new Set(current).add(rootId))
  }
  const chooseItem = (item: Row) => {
    setSelected({ type: 'item', id: id(item.id) })
    setQuery('')
    setSelectedItems(new Set([id(item.id)]))
    if (item.categoryId) {
      const categoryId = id(item.categoryId)
      const category = categories.find((entry) => id(entry.id) === categoryId)
      setExpanded((current) => {
        const next = new Set(current)
        next.add(categoryId)
        if (category?.parentId) next.add(id(category.parentId))
        return next
      })
    }
  }
  const toggleExpanded = (nodeId: string) => setExpanded((current) => {
    const next = new Set(current)
    next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId)
    return next
  })
  const exportCsv = () => {
    const chosen = selectedItems.size
      ? displayedItems.filter((item) => selectedItems.has(id(item.id)))
      : displayedItems
    const quote = (value: unknown) => `"${id(value).replace(/"/g, '""')}"`
    const rows = [
      ['Major Group', 'Item Group', 'SKU', 'Item Name', 'Current Stock', 'Reorder Level', 'Maximum Level', 'Status'],
      ...chosen.map((item) => {
        const category = categories.find((entry) => id(entry.id) === id(item.categoryId))
        const major = category?.parentId ? categories.find((entry) => id(entry.id) === id(category.parentId)) : category
        return [major?.name, category?.parentId ? category.name : '', item.sku, item.name, item.onHand, item.reorder, item.maximumLevel ?? '', stockPresentation(item).label]
      }),
    ]
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(quote).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  const importFile = async (file?: File) => {
    if (!file) return
    setImporting(true)
    try {
      const result = await importItems(file)
      await app.refreshData()
      app.showToast(`Items imported: ${result.created} added, ${result.updated} updated`)
    } catch (reason) {
      app.showWorkflowAlert('Item import failed', errorMessage(reason), 'warning')
    } finally {
      setImporting(false)
      if (importInput.current) importInput.current.value = ''
    }
  }
  const downloadTemplate = () => {
    const content = 'major_group,item_group,item_name,sku,base_unit,reorder_level,maximum_level,business_type,brand,barcode,batch_tracking,expiry_tracking,is_active\nBeverages,Soft Drinks,Cola,BEV-SD-001,pcs,100,1000,Resale / Revenue Item,Coca Cola,,no,no,yes\n'
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'item-import-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return <div style={{ maxWidth: 1500, margin: '0 auto' }}>
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
      <div><h1 style={{ margin: 0, color: 'var(--text)', fontSize: 24 }}>Inventory Catalogue</h1><p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 12.5 }}>Browse major categories, item groups and the items stored in each group.</p></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canMaintainCategories && <button type="button" onClick={() => app.openCreate('categories', 'Create category')} style={primary}><Icon name="create_new_folder" size={17} />Create Category</button>}
        {canMaintainItems && <button type="button" onClick={() => app.openCreate('items', 'Create item')} style={secondary}><Icon name="inventory_2" size={17} />Create Item</button>}
        {canMaintainItems && <><input ref={importInput} type="file" accept=".csv,.xlsx" hidden onChange={(event) => void importFile(event.target.files?.[0])} /><button type="button" disabled={importing} onClick={() => importInput.current?.click()} style={secondary}><Icon name="upload_file" size={17} />{importing ? 'Importing…' : 'Import Items'}</button><button type="button" onClick={downloadTemplate} title="Download the required CSV column template" style={iconButton}><Icon name="download" size={17} /></button></>}
      </div>
    </header>

    <div style={{ position: 'relative', marginBottom: 12 }}>
      <Icon name="search" size={19} color="var(--text-faint)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
      <input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedItems(new Set()) }} placeholder="Search SKU, item name or group…" style={{ width: '100%', height: 42, padding: '0 38px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none' }} />
      {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear inventory search" style={{ ...iconButton, position: 'absolute', right: 5, top: 5, border: 0 }}><Icon name="close" size={17} /></button>}
    </div>

    <div className="catalogue-layout" style={{ display: 'grid', gridTemplateColumns: '320px minmax(0,1fr)', minHeight: 560, border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden', background: 'var(--surface)' }}>
      <aside style={{ borderRight: '1px solid var(--border)', background: 'var(--surface-2)', minWidth: 0 }}>
        <div style={panelHeader}><span>Catalogue explorer</span><small>{roots.length} major · {categories.length - roots.length} item groups</small></div>
        <div style={{ padding: '8px 7px' }}>
          {roots.map((root) => {
            const rootId = id(root.id)
            const children = childrenByParent.get(rootId) || []
            const rootOpen = expanded.has(rootId)
            const rootSelected = selected.type === 'category' && selected.id === rootId
            const directItems = itemsByCategory.get(rootId) || []
            return <div key={rootId} style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button type="button" onClick={() => toggleExpanded(rootId)} aria-label={`${rootOpen ? 'Collapse' : 'Expand'} ${id(root.name)}`} style={treeToggle}><Icon name={rootOpen ? 'expand_more' : 'chevron_right'} size={18} /></button>
                <button type="button" onClick={() => chooseCategory(root)} style={{ ...treeRow, color: rootSelected ? 'var(--accent)' : 'var(--text)', background: rootSelected ? 'var(--accent-soft)' : 'transparent', fontWeight: 750 }}>
                  <FolderTreeIcon open={rootOpen} size={19} color={rootSelected ? 'var(--accent)' : 'var(--text-muted)'} />
                  <span style={{ flex: 1 }}>{id(root.name)}</span>
                  <small>{children.length} group{children.length === 1 ? '' : 's'} · {num(root.itemsCount)} item{num(root.itemsCount) === 1 ? '' : 's'}</small>
                </button>
              </div>
              {rootOpen && <div>
                {children.map((child) => {
                  const childId = id(child.id)
                  const childOpen = expanded.has(childId)
                  const childSelected = selected.type === 'category' && selected.id === childId
                  const childItems = itemsByCategory.get(childId) || []
                  return <div key={childId}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <button type="button" onClick={() => toggleExpanded(childId)} aria-label={`${childOpen ? 'Collapse' : 'Expand'} ${id(child.name)}`} style={{ ...treeToggle, marginLeft: 18 }}><Icon name={childOpen ? 'expand_more' : 'chevron_right'} size={18} /></button>
                      <button type="button" onClick={() => chooseCategory(child)} style={{ ...treeRow, width: 'calc(100% - 18px)', color: childSelected ? 'var(--accent)' : 'var(--text-muted)', background: childSelected ? 'var(--accent-soft)' : 'transparent', fontWeight: childSelected ? 750 : 650 }}>
                        <FolderTreeIcon open={childOpen} size={18} color={childSelected ? 'var(--accent)' : 'var(--text-faint)'} />
                        <span style={{ flex: 1 }}>{id(child.name)}</span>
                        <small>{childItems.length}</small>
                      </button>
                    </div>
                    {childOpen && childItems.length > 0 && <div style={{ marginLeft: 49, borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
                      {childItems.map((item) => {
                        const active = selected.type === 'item' && selected.id === id(item.id)
                        return <button type="button" key={id(item.id)} onClick={() => chooseItem(item)} style={{ ...treeLeaf, width: 'calc(100% - 10px)', marginLeft: 0, color: active ? 'var(--accent)' : 'var(--text-muted)', background: active ? 'var(--accent-soft)' : 'transparent', fontWeight: active ? 700 : 560 }}>
                          <ItemTreeIcon size={17} color={active ? 'var(--accent)' : 'var(--text-faint)'} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id(item.name)}</span>
                          <small>{num(item.onHand).toLocaleString()}</small>
                        </button>
                      })}
                    </div>}
                    {childOpen && childItems.length === 0 && <div style={{ marginLeft: 62, padding: '4px 8px 8px', color: 'var(--text-faint)', fontSize: 11.5 }}>No items in this group yet.</div>}
                  </div>
                })}
                {directItems.length > 0 && (() => {
                  const directOpen = expanded.has(`unassigned:${rootId}`)
                  const directSelected = selected.type === 'unassigned' && selected.id === rootId
                  return <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <button type="button" onClick={() => toggleExpanded(`unassigned:${rootId}`)} aria-label={`${directOpen ? 'Collapse' : 'Expand'} unassigned items in ${id(root.name)}`} style={{ ...treeToggle, marginLeft: 18 }}><Icon name={directOpen ? 'expand_more' : 'chevron_right'} size={18} /></button>
                      <button type="button" onClick={() => chooseUnassigned(root)} style={{ ...treeRow, width: 'calc(100% - 18px)', color: directSelected ? 'var(--accent)' : 'var(--text-muted)', background: directSelected ? 'var(--accent-soft)' : 'transparent', fontWeight: directSelected ? 750 : 650 }}>
                        <FolderTreeIcon open={directOpen} size={18} color={directSelected ? 'var(--accent)' : 'var(--text-faint)'} />
                        <span style={{ flex: 1 }}>Unassigned Items</span>
                        <small>{directItems.length}</small>
                      </button>
                    </div>
                    {directOpen && <div style={{ marginLeft: 49, borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
                      {directItems.map((item) => {
                        const active = selected.type === 'item' && selected.id === id(item.id)
                        return <button type="button" key={id(item.id)} onClick={() => chooseItem(item)} style={{ ...treeLeaf, width: 'calc(100% - 10px)', marginLeft: 0, color: active ? 'var(--accent)' : 'var(--text-muted)', background: active ? 'var(--accent-soft)' : 'transparent', fontWeight: active ? 700 : 560 }}>
                          <ItemTreeIcon size={17} color={active ? 'var(--accent)' : 'var(--text-faint)'} />
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id(item.name)}</span>
                          <small>{num(item.onHand).toLocaleString()}</small>
                        </button>
                      })}
                    </div>}
                  </div>
                })()}
                {!children.length && !directItems.length && <div style={{ marginLeft: 50, padding: '4px 8px 8px', color: 'var(--text-faint)', fontSize: 11.5 }}>No Item Groups or items yet.</div>}
              </div>}
            </div>
          })}
          {!roots.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No major categories yet.</div>}
        </div>
      </aside>

      <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...panelHeader, minHeight: 54 }}>
          <div>
            <small style={{ display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.05em' }}>{normalizedQuery ? 'Inventory search' : selected.type === 'item' ? 'Selected item' : selected.type === 'unassigned' ? 'Items awaiting group assignment' : 'Viewing'}</small>
            <strong style={{ color: 'var(--text)', fontSize: 13 }}>{breadcrumb}</strong>
          </div>
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11.5 }}>{displayedItems.length} item{displayedItems.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr minmax(190px,1.5fr) .65fr .65fr 1fr 44px', padding: '0 8px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <span style={headCell}><input type="checkbox" checked={displayedItems.length > 0 && displayedItems.every((item) => selectedItems.has(id(item.id)))} onChange={(event) => setSelectedItems(event.target.checked ? new Set(displayedItems.map((item) => id(item.id))) : new Set())} /></span><span style={headCell}>SKU code</span><span style={headCell}>Item name</span><span style={{ ...headCell, justifyContent: 'flex-end' }}>Stock</span><span style={{ ...headCell, justifyContent: 'flex-end' }}>Reorder</span><span style={headCell}>Status</span><span />
            </div>
            {displayedItems.map((item) => {
              const status = stockPresentation(item)
              return <div key={id(item.id)} style={{ display: 'grid', gridTemplateColumns: '42px 1fr minmax(190px,1.5fr) .65fr .65fr 1fr 44px', alignItems: 'center', minHeight: 52, padding: '0 8px', borderBottom: '1px solid var(--border)' }}>
                <span style={bodyCell}><input type="checkbox" checked={selectedItems.has(id(item.id))} onChange={(event) => setSelectedItems((current) => { const next = new Set(current); event.target.checked ? next.add(id(item.id)) : next.delete(id(item.id)); return next })} /></span>
                <span style={{ ...bodyCell, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{id(item.sku)}</span>
                <span style={{ ...bodyCell, display: 'block' }}><strong style={{ display: 'block', color: 'var(--text)' }}>{id(item.name)}</strong><small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)' }}>{id(item.categoryPath)}</small></span>
                <span style={{ ...bodyCell, justifyContent: 'flex-end', color: 'var(--text)', fontWeight: 750 }}>{num(item.onHand).toLocaleString()}</span>
                <span style={{ ...bodyCell, justifyContent: 'flex-end' }}>{num(item.reorder).toLocaleString()}</span>
                <span style={bodyCell}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, color: status.color, background: status.background, fontSize: 10.5, fontWeight: 750 }}><Icon name={status.icon} size={14} color={status.color} />{status.label}</span></span>
                <span style={bodyCell}>{app.user.isSuperuser || app.user.permissions.includes('inventory.change_item') ? <button type="button" onClick={() => app.openEdit(id(item.id), 'items')} title="Edit item" style={iconButton}><Icon name="edit" size={16} /></button> : null}</span>
              </div>
            })}
            {!displayedItems.length && <div style={{ padding: 54, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}><Icon name="inventory_2" size={27} color="var(--text-faint)" /><div style={{ marginTop: 8, color: 'var(--text)', fontWeight: 750 }}>No matching items</div><div style={{ marginTop: 4 }}>{normalizedQuery ? 'Try another SKU, name or group.' : 'Open a category or import items into this group.'}</div></div>}
          </div>
        </div>
        <footer style={{ minHeight: 52, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{selectedItems.size} selected</span><span style={{ flex: 1 }} />
          <button type="button" disabled={!selectedItems.size} onClick={() => app.navTo('reorderRules', 'Reorder rules')} style={{ ...secondary, opacity: selectedItems.size ? 1 : .5 }}><Icon name="shopping_cart" size={16} />Bulk action: Reorder</button>
          <button type="button" disabled={!displayedItems.length} onClick={exportCsv} style={{ ...secondary, opacity: displayedItems.length ? 1 : .5 }}><Icon name="download" size={16} />Export to CSV</button>
        </footer>
      </section>
    </div>
  </div>
}

const primary: CSSProperties = { height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 13px', border: '1px solid var(--accent)', borderRadius: 7, background: 'var(--accent)', color: '#fff', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700 }
const secondary: CSSProperties = { height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 650 }
const iconButton: CSSProperties = { width: 34, height: 34, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer' }
const panelHeader: CSSProperties = { minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 13px', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 11.5, fontWeight: 750 }
const treeToggle: CSSProperties = { width: 26, height: 34, display: 'grid', placeItems: 'center', flex: 'none', border: 0, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }
const treeRow: CSSProperties = { minWidth: 0, flex: 1, minHeight: 36, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', border: 0, borderRadius: 6, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 12 }
const treeLeaf: CSSProperties = { width: 'calc(100% - 62px)', minHeight: 34, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', border: 0, borderRadius: 6, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 11.5 }
const headCell: CSSProperties = { minWidth: 0, minHeight: 38, display: 'flex', alignItems: 'center', padding: '0 9px', color: 'var(--text-faint)', fontSize: 9.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }
const bodyCell: CSSProperties = { minWidth: 0, display: 'flex', alignItems: 'center', padding: '8px 9px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-muted)', fontSize: 11.5 }
