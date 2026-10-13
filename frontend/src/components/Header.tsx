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
  const storesManager = isStoresManager(app.user)
  const departmentLabel = app.user.departmentName || app.user.role
  const moduleName = storesManager ? 'Stores & Inventory' : app.activeModule === 'hr' ? 'Human Resources' : departmentLabel
  const pageDescription = routeDescription(app.route, moduleName)
  const notificationCount = notifications.filter((notification) => !notification.is_read).length
  const branchLabel = app.currentBranch || app.user.branchName || 'Current property'

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [])

  const openMobileNavigation = () => window.dispatchEvent(new Event('tafiti-sidebar-open'))

  return (
    <header className="app-header tafiti-app-header tafiti-school-header">
      <div className="app-header-top tafiti-app-header-top tafiti-school-header-top">
        <div className="tafiti-header-left tafiti-school-header-left">
          <button
            type="button"
            className="tafiti-school-mobile-menu"
            onClick={openMobileNavigation}
            aria-label="Open navigation"
            title="Open navigation"
          >
            <Icon name="menu" size={17} />
          </button>
          <button
            className="global-search-trigger tafiti-header-menu tafiti-school-search"
            onClick={() => setSearchOpen(true)}
            aria-label="Open global search"
            title="Search anything (Ctrl K)"
          >
            <Icon name="search" size={15} />
            <span className="header-search-label">Search anything…</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>

        <div className="header-actions tafiti-header-actions tafiti-school-header-actions">
          <span className="tafiti-school-context-chip">{branchLabel}</span>
          <span className={`header-live-state ${app.apiStatus === 'live' ? 'is-live' : app.apiStatus === 'offline' ? 'is-offline' : ''}`}>
            <i />
            {app.apiStatus === 'live' ? 'Live' : app.apiStatus === 'loading' ? 'Syncing' : app.apiStatus === 'offline' ? 'Offline' : 'Connecting'}
          </span>
          <span className="header-role-chip">{app.user.isSuperuser ? 'Admin' : app.user.role}</span>

          <div className="tafiti-header-popover-anchor">
            <button
              onClick={openNotifications}
              title="Notifications"
              aria-label={`Notifications${notificationCount ? `, ${notificationCount} unread` : ''}`}
              aria-expanded={notificationsOpen}
              className="header-notification-trigger tafiti-school-icon-button"
              style={iconAction}
            >
              <Icon name={notificationCount ? 'notifications_active' : 'notifications'} size={16} />
              {notificationCount > 0 && (
                <span className="tafiti-notification-badge">{notificationCount > 9 ? '9+' : notificationCount}</span>
              )}
            </button>

            {notificationsOpen && <>
              <div className="notification-backdrop" onClick={() => setNotificationsOpen(false)} />
              <section className="notification-panel" aria-label="Notifications">
                <header className="tafiti-notification-header">
                  <div className="tafiti-notification-title">
                    <div>Notifications</div>
                    <span>{notificationCount ? `${notificationCount} unread` : 'You are all caught up'}</span>
                  </div>
                  <button onClick={() => void loadNotifications()} title="Refresh notifications" aria-label="Refresh notifications" style={smallIconAction}>
                    <Icon name="refresh" size={17} />
                  </button>
                  <button onClick={() => setNotificationsOpen(false)} title="Close notifications" aria-label="Close notifications" style={smallIconAction}>
                    <Icon name="close" size={17} />
                  </button>
                </header>

                <div className="notification-list">
                  {notificationsLoading && <NotificationState icon="progress_activity" text="Loading your notifications…" />}
                  {!notificationsLoading && notificationsError && <NotificationState icon="error" text="Notifications could not be loaded." detail={notificationsError} action={() => void loadNotifications()} />}
                  {!notificationsLoading && !notificationsError && notifications.length === 0 && <NotificationState icon="notifications_none" text="No notifications yet" detail="Workflow updates and assigned tasks will appear here." />}
                  {!notificationsLoading && !notificationsError && notifications.map((notification) => (
                    <button
                      key={notification.id}
                      onClick={() => void readNotification(notification)}
                      className="notification-item"
                      aria-label={`${notification.title}${notification.is_read ? '' : ', unread'}`}
                    >
                      <span className={`tafiti-notification-icon ${notification.is_read ? 'is-read' : ''}`}>
                        <Icon name={notification.is_read ? 'notifications' : 'notification_important'} size={18} />
                      </span>
                      <span className="tafiti-notification-copy">
                        <span className="tafiti-notification-row-title">
                          <span className={notification.is_read ? 'is-read' : ''}>{notification.title}</span>
                          {!notification.is_read && <i aria-hidden="true" />}
                        </span>
                        <span className="tafiti-notification-message">{notification.message}</span>
                        <span className="tafiti-notification-time">{notificationTime(notification.created_at)}</span>
                      </span>
                    </button>
                  ))}
                </div>

                {notifications.length > 0 && (
                  <footer className="tafiti-notification-footer">
                    <button onClick={() => void readAllNotifications()} disabled={!notificationCount}>Mark all as read</button>
                  </footer>
                )}
              </section>
            </>}
          </div>

          <div className="tafiti-header-popover-anchor">
            <button
              onClick={() => setProfileOpen((open) => !open)}
              className="header-profile-trigger tafiti-header-profile-trigger tafiti-school-profile"
            >
              <Avatar className="header-avatar" src={app.user.photoUrl} name={app.user.name} size={32} radius={16} />
              <span className="header-user-copy tafiti-header-user-copy">
                <span>{app.user.name}</span>
                <small>{departmentLabel}</small>
              </span>
              <Icon name="expand_more" size={13} />
            </button>

            {profileOpen && <>
              <div onClick={() => setProfileOpen(false)} className="tafiti-popover-backdrop" />
              <div className="tafiti-profile-menu">
                <div className="tafiti-profile-summary">
                  <strong>{app.user.name}</strong>
                  <span>{app.user.role}</span>
                </div>
                <button onClick={app.toggleMode} style={menuAction}>
                  <Icon name={app.mode === 'dark' ? 'light_mode' : 'dark_mode'} size={17} />
                  {app.mode === 'dark' ? 'Light appearance' : 'Dark appearance'}
                </button>
                {canSwitchModules(app.user) && (
                  <button onClick={app.gotoModules} style={menuAction}>
                    <Icon name="apps" size={17} />
                    Switch workspace
                  </button>
                )}
                <button onClick={app.logout} style={{ ...menuAction, color: 'var(--bad)' }}>
                  <Icon name="logout" size={17} />
                  Sign out
                </button>
              </div>
            </>}
          </div>
        </div>
      </div>

      <div className="tafiti-school-breadcrumb-bar">
        <div className="tafiti-school-breadcrumb">
          <button type="button" onClick={() => app.navTo('dashboard', 'Dashboard')}>Home</button>
          <Icon name="chevron_right" size={11} />
          <strong>{app.crumb || 'Dashboard'}</strong>
          <span>{pageDescription}</span>
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
    reportview: 'Detailed operational report',
    'audit-log': 'System activity and accountability',
    'access-management': 'Roles, permissions and user access',
    'hotel-profile': 'System configuration',
  }
  return descriptions[route] || moduleName
}

function NotificationState({ icon, text, detail, action }: { icon: string; text: string; detail?: string; action?: () => void }) {
  return (
    <div className="tafiti-notification-state">
      <div>
        <span><Icon name={icon} size={21} /></span>
        <strong>{text}</strong>
        {detail && <p>{detail}</p>}
        {action && <button onClick={action}>Try again</button>}
      </div>
    </div>
  )
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
  width: 36,
  height: 36,
  border: '1px solid var(--border)',
  borderRadius: 9,
  background: '#fff',
  display: 'grid',
  placeItems: 'center',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  position: 'relative',
}

const smallIconAction: CSSProperties = {
  width: 30,
  height: 30,
  border: 0,
  borderRadius: 7,
  background: 'transparent',
  display: 'grid',
  placeItems: 'center',
  color: 'var(--text-muted)',
  cursor: 'pointer',
}

const menuAction: CSSProperties = {
  width: '100%',
  height: 36,
  border: 0,
  borderRadius: 7,
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '0 10px',
  color: 'var(--text-muted)',
  font: 'inherit',
  fontSize: 12,
  fontWeight: 650,
  cursor: 'pointer',
  textAlign: 'left',
}
