import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { branches } from '../lib/data'

interface NavItem { route: string; label: string; icon: string; count?: number }
interface NavGroup { heading: string; items: NavItem[] }

const groups: NavGroup[] = [
  { heading: 'OVERVIEW', items: [{ route: 'dashboard', label: 'Dashboard', icon: 'grid_view' }] },
  {
    heading: 'INVENTORY',
    items: [
      { route: 'items', label: 'Items', icon: 'inventory_2' },
      { route: 'categories', label: 'Categories', icon: 'category' },
      { route: 'uoms', label: 'Units of Measure', icon: 'straighten' },
      { route: 'locations', label: 'Store Locations', icon: 'warehouse' },
      { route: 'balances', label: 'Stock Balances', icon: 'equalizer' },
      { route: 'ledgers', label: 'Stock Ledgers', icon: 'menu_book' },
      { route: 'batches', label: 'Inventory Batches', icon: 'layers' },
    ],
  },
  {
    heading: 'PROCUREMENT',
    items: [
      { route: 'requisitions', label: 'Requisitions', icon: 'request_quote' },
      { route: 'approvals', label: 'Approvals', icon: 'approval' },
      { route: 'orders', label: 'Purchase Orders', icon: 'receipt_long' },
      { route: 'grns', label: 'Goods Receipts', icon: 'move_to_inbox' },
      { route: 'suppliers', label: 'Suppliers', icon: 'local_shipping' },
    ],
  },
  { heading: 'INSIGHTS', items: [{ route: 'reports', label: 'Reports', icon: 'bar_chart' }] },
  { heading: 'ADMINISTRATION', items: [{ route: 'hotel-profile', label: 'Hotel Profile', icon: 'domain' }] },
]

export default function Sidebar() {
  const app = useApp()
  const initials = app.user.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()

  const navBtn = (item: NavItem): CSSProperties => {
    const on = item.route === app.navActive
    return {
      display: 'flex', alignItems: 'center', gap: 11, width: '100%', border: 'none', cursor: 'pointer',
      background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--text-muted)',
      font: 'inherit', fontSize: 13, fontWeight: on ? 700 : 500, padding: '8px 10px', borderRadius: 10,
      textAlign: 'left', marginBottom: 1,
    }
  }

  return (
    <aside style={{ width: 266, flex: 'none', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)' }}>
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,var(--accent),var(--accent-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)', flex: 'none' }}>
          <Icon name="inventory_2" size={21} color="#fff" fill weight={500} />
        </div>
        <div style={{ minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.01em' }}>Stock Management</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Hotel Management Software</div>
        </div>
      </div>

      {/* Property switcher */}
      <div style={{ padding: '2px 14px 12px', position: 'relative' }}>
        <button onClick={app.toggleBranch} className="hover-border2" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, padding: '8px 10px', cursor: 'pointer', font: 'inherit' }}>
          <Icon name="apartment" size={18} color="var(--accent)" />
          <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-faint)' }}>PROPERTY</span>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.currentBranch}</span>
          </span>
          <Icon name="unfold_more" size={18} color="var(--text-faint)" />
        </button>
        {app.branchOpen && (
          <>
            <div onClick={app.closePop} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div style={{ position: 'absolute', left: 14, right: 14, top: '100%', marginTop: 6, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow)', padding: 6 }}>
              {branches.map((b) => (
                <button key={b} onClick={() => app.selectBranch(b)} className="hover-surface2" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', borderRadius: 9, padding: '8px 9px', cursor: 'pointer', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', textAlign: 'left' }}>
                  <Icon name="apartment" size={17} color="var(--text-faint)" />
                  <span style={{ flex: 1 }}>{b}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 14px 12px' }}>
        {groups.map((g) => (
          <div key={g.heading}>
            <div style={{ padding: g.heading === 'OVERVIEW' ? '8px 10px 5px' : '14px 10px 5px', fontSize: 10, fontWeight: 800, letterSpacing: '.1em', color: 'var(--text-faint)' }}>{g.heading}</div>
            {g.items.map((item) => {
              const on = item.route === app.navActive
              return (
                <button key={item.route} className={on ? undefined : 'hover-surface2'} onClick={() => app.navTo(item.route, item.label)} style={navBtn(item)}>
                  <Icon name={item.icon} size={20} color={on ? 'var(--accent)' : 'var(--text-faint)'} />
                  <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
                  {item.count != null && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--bad)', padding: '1px 7px', borderRadius: 20 }}>{item.count}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px' }}>
        <button onClick={app.gotoModules} className="hover-surface2" style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)', font: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 10px', borderRadius: 10, textAlign: 'left' }}>
          <Icon name="apps" size={20} color="var(--text-faint)" />
          <span style={{ flex: 1 }}>Switch module</span>
          <Icon name="open_in_new" size={17} color="var(--text-faint)" />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px 4px', marginTop: 2 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>{initials}</div>
          <div style={{ minWidth: 0, lineHeight: 1.25, flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{app.user.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="verified_user" size={12} color="var(--accent)" />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{app.user.role}</span>
            </div>
          </div>
          <button onClick={app.logout} title="Sign out" className="hover-logout" style={{ width: 28, height: 28, border: 'none', background: 'transparent', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-faint)' }}>
            <Icon name="logout" size={18} />
          </button>
        </div>
      </div>
    </aside>
  )
}
