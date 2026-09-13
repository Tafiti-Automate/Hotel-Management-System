import { useCallback, useEffect, useState, type CSSProperties } from 'react'
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
  const [now, setNow] = useState(() => new Date())
  const storesManager = isStoresManager(app.user)
  const departmentLabel = app.user.departmentName || app.user.role
  const moduleName = storesManager ? 'Stores & Inventory' : app.activeModule === 'hr' ? 'Human Resources' : departmentLabel
  const pageDescription = routeDescription(app.route, moduleName)
  const notificationCount = notifications.filter((notification) => !notification.is_read).length

  const loadNotifications = useCallback(async (showLoading = true) => {
    if (showLoading) setNotificationsLoading(true)
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
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!notificationsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [notificationsOpen])

  const openNotifications = () => {
    setProfileOpen(false)
    setNotificationsOpen((open) => {
      if (!open) void loadNotifications(false)
      return !open
    })
  }

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

  const readAllNotifications = async () => {
    const previous = notifications
    setNotifications((rows) => rows.map((row) => ({ ...row, is_read: true })))
    try {
      await markAllNotificationsRead()
    } catch (error) {
      setNotifications(previous)
      setNotificationsError(errorMessage(error))
    }
  }

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [])

  return (
    <header className="app-header" style={{ height: 96, flex: 'none', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <div className="app-header-top" style={{ height: 58, display: 'flex', alignItems: 'center', gap: 18, padding: '0 24px' }}>
        <button className="global-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Open global search">
          <Icon name="search" size={19} />
          <span className="header-search-label">Search</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="header-page-context">
          <strong>{app.crumb || 'Dashboard'}</strong>
          <span>{pageDescription}</span>
        </div>

        <div className="header-clock" aria-label={`Local time ${formatClock(now)}`}>
          <i aria-hidden="true" />
          <span><small>{formatClockDate(now)}</small><strong>{formatClock(now)}</strong></span>
          <Icon name="schedule" size={17} color="var(--accent)" />
        </div>

        <div className="header-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className={`header-live-state ${app.apiStatus === 'live' ? 'is-live' : app.apiStatus === 'offline' ? 'is-offline' : ''}`}><i />{app.apiStatus === 'live' ? 'Live' : app.apiStatus === 'loading' ? 'Syncing' : app.apiStatus === 'offline' ? 'Offline' : 'Connecting'}</span>
          <span className="header-role-chip">{app.user.isSuperuser ? 'Admin' : app.user.role}</span>
          <button onClick={app.toggleMode} title={app.mode === 'dark' ? 'Use light appearance' : 'Use dark appearance'} aria-label={app.mode === 'dark' ? 'Use light appearance' : 'Use dark appearance'} className="header-theme-trigger hover-surface2" style={iconAction}><Icon name={app.mode === 'dark' ? 'light_mode' : 'dark_mode'} size={19} /></button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={openNotifications}
              title="Notifications"
              aria-label={`Notifications${notificationCount ? `, ${notificationCount} unread` : ''}`}
              aria-expanded={notificationsOpen}
              className="header-notification-trigger hover-surface2"
              style={{ ...iconAction, position: 'relative' }}
            >
              <Icon name={notificationCount ? 'notifications_active' : 'notifications'} size={20} />
              {notificationCount > 0 && <span style={{ position: 'absolute', right: 5, top: 4, minWidth: 17, height: 17, padding: '0 3px', display: 'grid', placeItems: 'center', borderRadius: 9, background: 'var(--bad)', color: '#fff', fontSize: 11.5, fontWeight: 750, border: '2px solid var(--surface)' }}>{notificationCount > 99 ? '99+' : notificationCount}</span>}
            </button>
            {notificationsOpen && <>
              <div className="notification-backdrop" onClick={() => setNotificationsOpen(false)} />
              <section className="notification-panel" aria-label="Notifications">
                <header style={{ padding: '15px 16px 12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 750 }}>Notifications</div>
                    <div style={{ marginTop: 2, color: 'var(--text-faint)', fontSize: 12 }}>{notificationCount ? `${notificationCount} unread` : 'You are all caught up'}</div>
                  </div>
                  <button onClick={() => void loadNotifications()} title="Refresh notifications" aria-label="Refresh notifications" className="hover-surface2" style={smallIconAction}><Icon name="refresh" size={17} /></button>
                  <button onClick={() => setNotificationsOpen(false)} title="Close notifications" aria-label="Close notifications" className="hover-surface2" style={smallIconAction}><Icon name="close" size={17} /></button>
                </header>

                <div className="notification-list">
                  {notificationsLoading && <NotificationState icon="progress_activity" text="Loading your notifications…" />}
                  {!notificationsLoading && notificationsError && <NotificationState icon="error" text="Notifications could not be loaded." detail={notificationsError} action={() => void loadNotifications()} />}
                  {!notificationsLoading && !notificationsError && notifications.length === 0 && <NotificationState icon="notifications_none" text="No notifications yet" detail="Workflow updates and assigned tasks will appear here." />}
                  {!notificationsLoading && !notificationsError && notifications.map((notification) => (
                    <button
                      key={notification.id}
                      onClick={() => void readNotification(notification)}
                      className="notification-item hover-surface2"
                      aria-label={`${notification.title}${notification.is_read ? '' : ', unread'}`}
                    >
                      <span style={{ width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 8, color: notification.is_read ? 'var(--text-faint)' : 'var(--accent)', background: notification.is_read ? 'var(--surface-2)' : 'var(--accent-soft)' }}><Icon name={notification.is_read ? 'notifications' : 'notification_important'} size={18} /></span>
                      <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{ flex: 1, color: 'var(--text)', fontSize: 12, lineHeight: 1.35, fontWeight: notification.is_read ? 600 : 750 }}>{notification.title}</span>
                          {!notification.is_read && <span aria-hidden="true" style={{ width: 7, height: 7, flex: 'none', marginTop: 4, borderRadius: '50%', background: 'var(--accent)' }} />}
                        </span>
                        <span style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.45 }}>{notification.message}</span>
                        <span style={{ display: 'block', marginTop: 6, color: 'var(--text-faint)', fontSize: 11.5 }}>{notificationTime(notification.created_at)}</span>
                      </span>
                    </button>
                  ))}
                </div>

                {notifications.length > 0 && <footer style={{ padding: '10px 14px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  <button onClick={() => void readAllNotifications()} disabled={!notificationCount} style={{ border: 0, background: 'transparent', color: notificationCount ? 'var(--accent)' : 'var(--text-faint)', cursor: notificationCount ? 'pointer' : 'default', fontSize: 12, fontWeight: 700 }}>Mark all as read</button>
                </footer>}
              </section>
            </>}
          </div>

          <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 8px' }} />
          <div style={{ position: 'relative' }}>
            <button onClick={() => setProfileOpen((open) => !open)} style={{ height: 40, display: 'flex', alignItems: 'center', gap: 9, border: 0, background: 'transparent', borderRadius: 7, padding: '0 4px 0 7px', cursor: 'pointer', font: 'inherit' }} className="header-profile-trigger hover-surface2">
              <Avatar className="header-avatar" src={app.user.photoUrl} name={app.user.name} size={31} radius={7} />
              <span className="header-user-copy" style={{ textAlign: 'left' }}><span style={{ display: 'block', color: 'var(--text)', fontSize: 12.5, fontWeight: 600 }}>{app.user.name}</span><span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 12, marginTop: 1 }}>{departmentLabel}</span></span>
              <Icon name="expand_more" size={17} color="var(--text-faint)" />
            </button>
            {profileOpen && <>
              <div onClick={() => setProfileOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', right: 0, top: '100%', width: 220, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow)', padding: 6 }}>
                <button onClick={app.toggleMode} className="hover-surface2" style={menuAction}><Icon name={app.mode === 'dark' ? 'light_mode' : 'dark_mode'} size={18} />{app.mode === 'dark' ? 'Light appearance' : 'Dark appearance'}</button>
                {canSwitchModules(app.user) && <button onClick={app.gotoModules} className="hover-surface2" style={menuAction}><Icon name="apps" size={18} />Switch module</button>}
                <button onClick={app.logout} className="hover-surface2" style={{ ...menuAction, color: 'var(--bad)' }}><Icon name="logout" size={18} />Sign out</button>
              </div>
            </>}
          </div>
        </div>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  )
}

function routeDescription(route: string, moduleName: string) {
  const descriptions: Record<string, string> = {
    dashboard: 'System at a glance',
    'hr-dashboard': 'People and workforce overview',
    'workflow-stores': 'Requests, stock and store handoffs',
    'store-purchase-requests': 'Purchase requests from Stores',
    'workflow-procure': 'Purchasing and supplier workflow',
    'workflow-pay': 'Supplier invoices and payments',
    suppliers: 'Manage supplier accounts',
    supplierItems: 'Prices, quotations and supplied articles',
    categories: 'Catalogue groups and item structure',
    items: 'Goods, services and stock articles',
    uoms: 'Units and article conversions',
    itemUnits: 'Units and article conversions',
    locations: 'Stores and stock locations',
    employees: 'Employee records and assignments',
    departments: 'Teams and operational departments',
    reports: 'Analytics and operational insights',
    'audit-log': 'System activity and accountability',
    'access-management': 'Roles, permissions and user access',
    'hotel-profile': 'Property identity and configuration',
  }
  return descriptions[route] || moduleName
}

function formatClockDate(date: Date) {
  return new Intl.DateTimeFormat('en-UG', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala',
  }).format(date).toUpperCase()
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-UG', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Africa/Kampala',
  }).format(date)
}

function NotificationState({ icon, text, detail, action }: { icon: string; text: string; detail?: string; action?: () => void }) {
  return <div style={{ minHeight: 180, padding: 24, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
    <div>
      <span style={{ width: 42, height: 42, margin: '0 auto 10px', display: 'grid', placeItems: 'center', borderRadius: 11, color: 'var(--text-faint)', background: 'var(--surface-2)' }}><Icon name={icon} size={21} /></span>
      <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700 }}>{text}</div>
      {detail && <div style={{ maxWidth: 260, marginTop: 5, color: 'var(--text-faint)', fontSize: 12, lineHeight: 1.45 }}>{detail}</div>}
      {action && <button onClick={action} style={{ marginTop: 12, height: 30, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', padding: '0 11px', cursor: 'pointer', fontSize: 12, fontWeight: 650 }}>Try again</button>}
    </div>
  </div>
}

function notificationTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-UG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Kampala',
  }).format(date)
}

const iconAction: CSSProperties = {
  width: 38, height: 38, border: 0, borderRadius: 6, background: 'transparent',
  display: 'grid', placeItems: 'center', color: 'var(--text-muted)', cursor: 'pointer',
}

const smallIconAction: CSSProperties = {
  width: 30, height: 30, border: 0, borderRadius: 6, background: 'transparent',
  display: 'grid', placeItems: 'center', color: 'var(--text-muted)', cursor: 'pointer',
}


const menuAction: CSSProperties = {
  width: '100%', height: 36, border: 0, borderRadius: 5, background: 'transparent',
  display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', color: 'var(--text-muted)',
  font: 'inherit', fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
}
