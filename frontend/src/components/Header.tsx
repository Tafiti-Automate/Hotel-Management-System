import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { canAccessRoute, canSwitchModules, isStoresManager } from '../lib/access'
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
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(true)
  const [notificationsError, setNotificationsError] = useState('')
  const storesManager = isStoresManager(app.user)
  const moduleName = storesManager ? 'Stores & Inventory' : app.activeModule === 'hr' ? 'Human Resources' : `${app.user.role} workspace`
  const initials = app.user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const notificationCount = notifications.filter((notification) => !notification.is_read).length
  const hasPermission = (permission: string) => app.user.isSuperuser || app.user.permissions.includes(permission)

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

  const primary = (() => {
    if (canAccessRoute(app.user, 'workflow-stores')) {
      return { label: 'Open stores workbench', icon: 'warehouse', action: () => app.navTo('workflow-stores', 'Stores workbench') }
    }
    if (canAccessRoute(app.user, 'workflow-pay')) {
      return { label: 'Open finance workbench', icon: 'account_balance', action: () => app.navTo('workflow-pay', 'Finance control centre') }
    }
    if (canAccessRoute(app.user, 'workflow-procure')) {
      return { label: 'Open receiving workbench', icon: 'move_to_inbox', action: () => app.navTo('workflow-procure', 'Receiving workbench') }
    }
    if (hasPermission('approvals.change_approvalworkflow')) {
      return { label: 'Review approvals', icon: 'approval', action: () => app.navTo('approvals', 'Approvals') }
    }
    return null
  })()

  return (
    <header className="app-header" style={{ height: 96, flex: 'none', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <div style={{ height: 58, display: 'flex', alignItems: 'center', gap: 18, padding: '0 24px' }}>
        <div className="header-search" style={{ flex: 1, maxWidth: 560, position: 'relative' }}>
          <Icon name="search" size={19} color="var(--text-faint)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input placeholder={storesManager ? 'Search articles, stock, store requests and receipts…' : 'Search articles, suppliers, employees, POs, GRNs…'} style={{ width: '100%', height: 38, border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 7, padding: '0 42px 0 38px', color: 'var(--text)', fontSize: 13, outline: 'none' }} />
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 5px', color: 'var(--text-faint)', fontSize: 10 }}>⌘ K</span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
          <button onClick={primary?.action} className="header-text-action hover-surface2" style={textAction}><Icon name="task_alt" size={18} />Tasks</button>
          <button className="header-text-action hover-surface2" style={textAction}><Icon name="help" size={18} />Help</button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={openNotifications}
              title="Notifications"
              aria-label={`Notifications${notificationCount ? `, ${notificationCount} unread` : ''}`}
              aria-expanded={notificationsOpen}
              className="hover-surface2"
              style={{ ...iconAction, position: 'relative' }}
            >
              <Icon name={notificationCount ? 'notifications_active' : 'notifications'} size={20} />
              {notificationCount > 0 && <span style={{ position: 'absolute', right: 5, top: 4, minWidth: 17, height: 17, padding: '0 3px', display: 'grid', placeItems: 'center', borderRadius: 9, background: 'var(--bad)', color: '#fff', fontSize: 9, fontWeight: 750, border: '2px solid var(--surface)' }}>{notificationCount > 99 ? '99+' : notificationCount}</span>}
            </button>
            {notificationsOpen && <>
              <div className="notification-backdrop" onClick={() => setNotificationsOpen(false)} />
              <section className="notification-panel" aria-label="Notifications">
                <header style={{ padding: '15px 16px 12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 750 }}>Notifications</div>
                    <div style={{ marginTop: 2, color: 'var(--text-faint)', fontSize: 10.5 }}>{notificationCount ? `${notificationCount} unread` : 'You are all caught up'}</div>
                  </div>
                  <button onClick={() => void loadNotifications()} title="Refresh notifications" aria-label="Refresh notifications" className="hover-surface2" style={smallIconAction}><Icon name="refresh" size={17} /></button>
                  <button onClick={() => setNotificationsOpen(false)} title="Close notifications" aria-label="Close notifications" className="hover-surface2" style={smallIconAction}><Icon name="close" size={17} /></button>
                </header>

                <div className="notification-list">
                  {notificationsLoading && <NotificationState icon="progress_activity" text="Loading your notifications…" />}
                  {!notificationsLoading && notificationsError && <NotificationState icon="error" text="Notifications could not be loaded." detail={notificationsError} action={() => void loadNotifications()} />}
                  {!notificationsLoading && !notificationsError && notifications.length === 0 && <NotificationState icon="notifications_none" text="No notifications yet" detail="New tasks and operational alerts will appear here." />}
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
                        <span style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.45 }}>{notification.message}</span>
                        <span style={{ display: 'block', marginTop: 6, color: 'var(--text-faint)', fontSize: 9.5 }}>{notificationTime(notification.created_at)}</span>
                      </span>
                    </button>
                  ))}
                </div>

                {notifications.length > 0 && <footer style={{ padding: '10px 14px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  <button onClick={() => void readAllNotifications()} disabled={!notificationCount} style={{ border: 0, background: 'transparent', color: notificationCount ? 'var(--accent)' : 'var(--text-faint)', cursor: notificationCount ? 'pointer' : 'default', fontSize: 11, fontWeight: 700 }}>Mark all as read</button>
                </footer>}
              </section>
            </>}
          </div>

          <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 8px' }} />
          <div style={{ position: 'relative' }}>
            <button onClick={() => setProfileOpen((open) => !open)} style={{ height: 40, display: 'flex', alignItems: 'center', gap: 9, border: 0, background: 'transparent', borderRadius: 7, padding: '0 4px 0 7px', cursor: 'pointer', font: 'inherit' }} className="hover-surface2">
              <span style={{ width: 31, height: 31, borderRadius: 7, display: 'grid', placeItems: 'center', background: '#E8EEF9', color: '#1D4ED8', fontSize: 11, fontWeight: 700 }}>{initials}</span>
              <span className="header-user-copy" style={{ textAlign: 'left' }}><span style={{ display: 'block', color: 'var(--text)', fontSize: 12.5, fontWeight: 600 }}>{app.user.name}</span><span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 10.5, marginTop: 1 }}>{app.user.role}</span></span>
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

      <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 24px', borderTop: '1px solid var(--border)', background: '#FBFCFD' }}>
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{moduleName}</span>
        <Icon name="chevron_right" size={15} color="var(--text-faint)" />
        <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>{app.crumb}</span>
        {primary && app.route === 'dashboard' && <button onClick={primary.action} className="header-primary-action hover-accent" style={{ marginLeft: 'auto', height: 29, display: 'flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 5, background: 'var(--accent)', color: '#fff', padding: '0 11px', cursor: 'pointer', font: 'inherit', fontSize: 11.5, fontWeight: 600 }}><Icon name={primary.icon} size={16} color="#fff" />{primary.label}</button>}
      </div>
    </header>
  )
}

function NotificationState({ icon, text, detail, action }: { icon: string; text: string; detail?: string; action?: () => void }) {
  return <div style={{ minHeight: 180, padding: 24, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
    <div>
      <span style={{ width: 42, height: 42, margin: '0 auto 10px', display: 'grid', placeItems: 'center', borderRadius: 11, color: 'var(--text-faint)', background: 'var(--surface-2)' }}><Icon name={icon} size={21} /></span>
      <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700 }}>{text}</div>
      {detail && <div style={{ maxWidth: 260, marginTop: 5, color: 'var(--text-faint)', fontSize: 10.5, lineHeight: 1.45 }}>{detail}</div>}
      {action && <button onClick={action} style={{ marginTop: 12, height: 30, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)', padding: '0 11px', cursor: 'pointer', fontSize: 10.5, fontWeight: 650 }}>Try again</button>}
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

const textAction: CSSProperties = {
  height: 38, border: 0, borderRadius: 6, background: 'transparent', padding: '0 9px',
  display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', font: 'inherit',
  fontSize: 12, fontWeight: 500, cursor: 'pointer',
}

const menuAction: CSSProperties = {
  width: '100%', height: 36, border: 0, borderRadius: 5, background: 'transparent',
  display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', color: 'var(--text-muted)',
  font: 'inherit', fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
}
