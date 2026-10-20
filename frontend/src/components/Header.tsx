import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import CommandPalette from './CommandPalette'
import { canSwitchModules, isStoresManager } from '../lib/access'
import {
  errorMessage,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRecord,
} from '../lib/api'

export default function Header() {
  const app = useApp()
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(true)
  const [notificationsError, setNotificationsError] = useState('')

  const storesManager = isStoresManager(app.user)
  const moduleName = storesManager ? 'Stores & Inventory' : app.activeModule === 'hr' ? 'Human Resources' : 'Hotel Operations'
  const pageTitle = titleForRoute(app.route, app.crumb)
  const pageDescription = descriptionForRoute(app.route, app.user.role)
  const unread = notifications.filter((notification) => !notification.is_read).length
  const propertyName = app.currentBranch || app.user.branchName || app.user.departmentName || 'Current property'

  const loadNotifications = useCallback(async (withLoading = true) => {
    if (withLoading) setNotificationsLoading(true)
    setNotificationsError('')
    try {
      setNotifications(await fetchNotifications())
    } catch (error) {
      setNotificationsError(errorMessage(error))
    } finally {
      setNotificationsLoading(false)
    }
  }, [app.user.id])

  useEffect(() => {
    void loadNotifications()
    const timer = window.setInterval(() => void loadNotifications(false), 60_000)
    return () => window.clearInterval(timer)
  }, [loadNotifications])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setProfileOpen(false)
        setNotificationsOpen(false)
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  const readNotification = async (notification: NotificationRecord) => {
    if (notification.is_read) return
    setNotifications((rows) => rows.map((row) => row.id === notification.id ? { ...row, is_read: true } : row))
    try {
      await markNotificationRead(notification.id)
    } catch (error) {
      setNotifications((rows) => rows.map((row) => row.id === notification.id ? { ...row, is_read: false } : row))
      setNotificationsError(errorMessage(error))
    }
  }

  const readAll = async () => {
    const previous = notifications
    setNotifications((rows) => rows.map((row) => ({ ...row, is_read: true })))
    try {
      await markAllNotificationsRead()
    } catch (error) {
      setNotifications(previous)
      setNotificationsError(errorMessage(error))
    }
  }

  const openMobileNavigation = () => window.dispatchEvent(new Event('tafiti-sidebar-open'))

  return <>
    <header className="neo-header">
      <div className="neo-header-page">
        <button className="neo-mobile-menu" type="button" onClick={openMobileNavigation} aria-label="Open navigation"><Icon name="menu" size={20} /></button>
        <div className="neo-page-copy">
          <div className="neo-breadcrumb"><span>{moduleName}</span><Icon name="chevron_right" size={12} /><strong>{pageTitle}</strong></div>
          <div className="neo-page-title-row"><h1>{pageTitle}</h1><span>{pageDescription}</span></div>
        </div>
      </div>

      <button type="button" className="neo-search" onClick={() => setSearchOpen(true)} aria-label="Open global search">
        <Icon name="search" size={18} />
        <span>Search records, suppliers, LPOs…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="neo-header-actions">
        <span className={`neo-sync-state is-${app.apiStatus}`} title={`API status: ${app.apiStatus}`}><i />{app.apiStatus === 'live' ? 'Live' : app.apiStatus === 'loading' ? 'Syncing' : app.apiStatus === 'offline' ? 'Offline' : 'Connecting'}</span>
        <span className="neo-property-chip"><Icon name="business" size={15} />{propertyName}</span>

        <div className="neo-popover-anchor">
          <button type="button" className="neo-header-icon" onClick={() => {
            setProfileOpen(false)
            setNotificationsOpen((open) => {
              if (!open) void loadNotifications(false)
              return !open
            })
          }} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={notificationsOpen}>
            <Icon name={unread ? 'notifications_active' : 'notifications'} size={19} />
            {unread > 0 && <b>{unread > 9 ? '9+' : unread}</b>}
          </button>

          {notificationsOpen && <>
            <button className="neo-popover-backdrop" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)} />
            <section className="neo-notification-panel" aria-label="Notifications">
              <header><div><strong>Notifications</strong><span>{unread ? `${unread} unread` : 'All caught up'}</span></div><button className="neo-icon-button" onClick={() => void loadNotifications()} aria-label="Refresh notifications"><Icon name="refresh" size={17} /></button></header>
              <div className="neo-notification-list">
                {notificationsLoading && <NotificationState icon="progress_activity" title="Loading notifications" />}
                {!notificationsLoading && notificationsError && <NotificationState icon="error" title="Could not load notifications" detail={notificationsError} action={() => void loadNotifications()} />}
                {!notificationsLoading && !notificationsError && notifications.length === 0 && <NotificationState icon="notifications_none" title="No notifications yet" detail="Workflow updates and assigned tasks will appear here." />}
                {!notificationsLoading && !notificationsError && notifications.map((notification) => <button key={notification.id} className={`neo-notification-item ${notification.is_read ? 'is-read' : ''}`} onClick={() => void readNotification(notification)}>
                  <span className="neo-notification-icon"><Icon name={notification.is_read ? 'notifications' : 'notification_important'} size={17} /></span>
                  <span><strong>{notification.title}</strong><small>{notification.message}</small><time>{notificationTime(notification.created_at)}</time></span>
                  {!notification.is_read && <i />}
                </button>)}
              </div>
              {notifications.length > 0 && <footer><button type="button" onClick={() => void readAll()} disabled={!unread}>Mark all as read</button></footer>}
            </section>
          </>}
        </div>

        <div className="neo-popover-anchor">
          <button type="button" className="neo-profile-trigger" onClick={() => {
            setNotificationsOpen(false)
            setProfileOpen((open) => !open)
          }} aria-expanded={profileOpen}>
            <Avatar src={app.user.photoUrl} name={app.user.name} size={34} radius={10} />
            <span><strong>{app.user.name}</strong><small>{app.user.role}</small></span>
            <Icon name="expand_more" size={15} />
          </button>
          {profileOpen && <>
            <button className="neo-popover-backdrop" aria-label="Close profile menu" onClick={() => setProfileOpen(false)} />
            <div className="neo-profile-menu">
              <div className="neo-profile-summary"><Avatar src={app.user.photoUrl} name={app.user.name} size={42} radius={12} /><span><strong>{app.user.name}</strong><small>{app.user.designation || app.user.role}</small></span></div>
              <button type="button" onClick={app.toggleMode}><Icon name={app.mode === 'dark' ? 'light_mode' : 'dark_mode'} size={17} /><span>{app.mode === 'dark' ? 'Light appearance' : 'Dark appearance'}</span></button>
              {canSwitchModules(app.user) && <button type="button" onClick={app.gotoModules}><Icon name="apps" size={17} /><span>Switch workspace</span></button>}
              <button type="button" className="is-danger" onClick={app.logout}><Icon name="logout" size={17} /><span>Sign out</span></button>
            </div>
          </>}
        </div>
      </div>
    </header>

    <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
  </>
}

function titleForRoute(route: string, crumb: string) {
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    'hr-dashboard': 'People dashboard',
    'workflow-stores': 'Stores workflow',
    'stock-on-hand': 'Stock on hand',
    'store-transfers': 'Transfers',
    'store-inventory': 'Manage inventory',
    'store-analysis': 'Stock analysis',
    'store-usage': 'Usage',
    'store-purchase-requests': 'Purchase requests',
    'workflow-procure': 'Procurement workbench',
    'workflow-pay': 'Finance workbench',
    suppliers: 'Suppliers',
    supplierItems: 'Supplier quotations',
    categories: 'Item categories',
    items: 'Articles',
    uoms: 'Units & conversions',
    itemUnits: 'Units & conversions',
    locations: 'Stores',
    employees: 'Employees',
    departments: 'Departments',
    reports: 'Reports',
    reportview: 'Report details',
    'audit-log': 'Audit trail',
    'access-management': 'User access',
    'hotel-profile': 'Settings',
  }
  return titles[route] || crumb || 'Workspace'
}

function descriptionForRoute(route: string, role: string) {
  const descriptions: Record<string, string> = {
    dashboard: 'Live operational priorities and recent activity',
    'hr-dashboard': 'People, departments and workforce activity',
    'workflow-stores': 'Request, approval and issue control',
    'stock-on-hand': 'Live quantities by store and article',
    'store-transfers': 'Inter-store movement and receipt control',
    'store-inventory': 'Stock count and inventory control',
    'store-analysis': 'Store registers, stock position and movement analysis',
    'store-usage': 'Consumption and usage analysis',
    'store-purchase-requests': 'Shortage-driven purchasing requests',
    'workflow-procure': 'Requisitions, sourcing, LPOs and receiving',
    'workflow-pay': 'Invoices, matching and supplier payments',
    suppliers: 'Supplier accounts and trading status',
    supplierItems: 'Supplier pricing and quotation history',
    categories: 'Catalogue structure and item classification',
    items: 'Article master data and inventory setup',
    uoms: 'Purchasing, base and issue unit conversions',
    itemUnits: 'Purchasing, base and issue unit conversions',
    reports: 'Operational and management reporting',
    'audit-log': 'System activity and accountability',
    'access-management': 'Roles, accounts and permissions',
    'hotel-profile': 'Property and application configuration',
  }
  return descriptions[route] || role || 'Operations'
}

function NotificationState({ icon, title, detail, action }: { icon: string; title: string; detail?: string; action?: () => void }) {
  return <div className="neo-notification-state"><Icon name={icon} size={22} /><strong>{title}</strong>{detail && <span>{detail}</span>}{action && <button onClick={action}>Try again</button>}</div>
}

function notificationTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Kampala' }).format(date)
}
