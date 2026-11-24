import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../state/AppContext'
import { Icon } from './Icon'
import { Avatar } from './Avatar'
import CommandPalette from './CommandPalette'
import { canAccessRoute, canSwitchBranches, canSwitchModules } from '../lib/access'
import {
  fetchNotifications,
  fetchFiscalPeriodContext,
  type FiscalPeriodContext,
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
  const [unreadOnly,setUnreadOnly]=useState(false)
  const [banners,setBanners]=useState<NotificationRecord[]>([])
  const [quiet,setQuiet]=useState(false)
  const [category,setCategory]=useState('All')
  const [selectedNotice,setSelectedNotice]=useState<NotificationRecord|null>(null)
  const [desktop,setDesktop]=useState(false)
  const desktopRef=useRef(false)
  const known=useRef<Set<string>|null>(null)
  const quietRef=useRef(false)
  const notificationRequest = useRef(0)
  useEffect(()=>{
    let value=false
    try{value=localStorage.getItem('hotel:notification-quiet:'+app.user.id)==='1'}catch{/* storage unavailable */}
    quietRef.current=value;setQuiet(value)
    setSelectedNotice(null);setCategory('All')
    desktopRef.current=false;setDesktop(false)
  },[app.user.id])
  const toggleQuiet=()=>{
    const value=!quietRef.current
    quietRef.current=value;setQuiet(value)
    if(value)setBanners(rows=>rows.filter(row=>row.priority==='critical'))
    try{localStorage.setItem('hotel:notification-quiet:'+app.user.id,value?'1':'0')}catch{/* storage unavailable */}
  }
  const enableDesktop=async()=>{
    if(!('Notification' in window)||!window.isSecureContext){setNotificationsError('Desktop notifications are unavailable in this browser.');return}
    if(desktopRef.current){desktopRef.current=false;setDesktop(false);return}
    try{const permission=await Notification.requestPermission();desktopRef.current=permission==='granted';setDesktop(desktopRef.current);if(!desktopRef.current)setNotificationsError('Desktop notification permission was not granted.')}catch{setNotificationsError('Desktop notifications are unavailable.')}
  }
  const dismissBanner=(id:string)=>setBanners(rows=>rows.filter(row=>row.id!==id))
  const notificationTriggerRef = useRef<HTMLButtonElement>(null)
  const [propertyMenuOpen, setPropertyMenuOpen] = useState(false)
  const [period, setPeriod] = useState<FiscalPeriodContext | null>(null)
  const [periodError, setPeriodError] = useState(false)

  const visibleNotifications=notifications.filter(n=>(!unreadOnly||!n.is_read)&&(category==='All'||(n.category||'General')===category))
  const unread = notifications.filter((notification) => !notification.is_read).length
  const propertyName = app.currentBranch || app.user.branchName || app.user.departmentName || 'Current property'
  const propertyOption = app.data.branches.find((branch) => String(branch.name) === app.currentBranch)
  const selectedBranchId = String(propertyOption?.id || app.user.branchId || '')
  const canSelectProperty = canSwitchBranches(app.user) && app.data.branches.length > 1
  const contextName = (
    String(app.user.role).toLowerCase() === 'store keeper' && app.data.locations.length === 1
      ? String(app.data.locations[0].name)
      : app.user.departmentName || 'Property scope'
  )
  const periodLabel = period?.status === 'open' || period?.status === 'closed'
    ? period.name + ' · ' + (period.status === 'open' ? 'Open' : 'Closed')
    : period?.status === 'unconfigured' ? 'Period not configured'
    : periodError ? 'Period unavailable' : 'Checking period…'

  const loadNotifications = useCallback(async (withLoading = true) => {
    const request = ++notificationRequest.current
    if (withLoading) setNotificationsLoading(true)
    try {
      const next = await fetchNotifications()
      if (request !== notificationRequest.current) return
      const previous=known.current
      if(previous && document.visibilityState==='visible'){
        const incoming=next.filter(row=>!row.is_read&&!previous.has(row.id)&&(!quietRef.current||row.priority==='critical'))
        if(desktopRef.current && 'Notification' in window && Notification.permission==='granted' && incoming.length){
          try{const alert=new Notification('Hotel ERP',{body:'New operational notifications. Open your notification centre to review.',tag:'hotel-erp-inbox'});alert.onclick=()=>{window.focus();setNotificationsOpen(true);alert.close()}}catch{/* browser may require a service worker */}
        }
        if(incoming.length)setBanners(rows=>[...rows,...incoming].filter((row,i,all)=>all.findIndex(r=>r.id===row.id)===i).slice(-3))
      }
      known.current=new Set(next.map(row=>row.id))
      setNotifications(next)
      setBanners(rows=>rows.filter(row=>next.some(n=>n.id===row.id&&!n.is_read)))
      setNotificationsError('')
    } catch {
      if (request === notificationRequest.current) setNotificationsError('Unable to refresh notifications. Please retry.')
    } finally {
      if (request === notificationRequest.current) setNotificationsLoading(false)
    }
  }, [app.user.id])

  useEffect(() => {
    if (app.apiStatus !== 'live') return
    let active = true
    setPeriodError(false)
    void fetchFiscalPeriodContext(selectedBranchId)
      .then((value) => { if (active) setPeriod(value) })
      .catch(() => { if (active) { setPeriod(null); setPeriodError(true) } })
    return () => { active = false }
  }, [app.apiStatus, selectedBranchId])

  useEffect(() => {
    notificationRequest.current += 1
    setNotifications([])
    setBanners([])
    known.current=null
    setNotificationsOpen(false)
    if (app.apiStatus !== 'live') return
    void loadNotifications()
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void loadNotifications(false)
    }
    const timer = window.setInterval(refreshIfVisible, 20_000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)
    // Refresh the bell immediately after a successful local workflow mutation,
    // rather than making staff wait for the next background poll.
    window.addEventListener('hotel-workflow-updated', refreshIfVisible)
    return () => {
      notificationRequest.current += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
      window.removeEventListener('hotel-workflow-updated', refreshIfVisible)
    }
  }, [app.apiStatus, loadNotifications])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setProfileOpen(false)
        setNotificationsOpen(false)
        notificationTriggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [])

  const readNotification = async (notification: NotificationRecord) => {
    dismissBanner(notification.id)
    setSelectedNotice(notification)
    setNotificationsOpen(true)
    if (!notification.is_read) {
      setNotifications((rows) => rows.map((row) => row.id === notification.id ? { ...row, is_read: true } : row))
      try {
        await markNotificationRead(notification.id)
      } catch (error) {
        setNotifications((rows) => rows.map((row) => row.id === notification.id ? { ...row, is_read: false } : row))
        setNotificationsError('Could not mark notification as read. Please retry.')
        return
      }
    }
    // Notifications do not yet carry typed document deep links. Navigate to
    // the correct role workspace instead of guessing a record URL.
    const message = `${notification.title} ${notification.message}`.toLowerCase()
    const role = app.user.role.toLowerCase()
    const target = /supplier payment|invoice|bank settlement|payment instruction/.test(message)
      ? ['accounts payable clerk', 'financial manager', 'general manager'].includes(role) ? 'workflow-pay' : null
      : /lpo|purchase order|quotation|procurement|supplier award/.test(message)
      ? ['procurement manager', 'procurement officer', 'financial manager', 'general manager'].includes(role)
        ? 'workflow-procure' : null
      : /goods receipt|grn|receiving/.test(message)
        ? role === 'receiving clerk' ? 'workflow-procure' : role === 'store keeper' ? 'grn-posting' : null
      : /requisition|department request|pickup|store issue/.test(message)
        ? 'workflow-stores' : /expiry|expired stock|expires today/.test(message) && ['store keeper','cost controller'].includes(role) ? 'stock-on-hand' : null
    if (target && canAccessRoute(app.user,target)) {
      setNotificationsOpen(false)
      setSelectedNotice(null)
      app.navTo(target, target === 'workflow-pay' ? 'Supplier payments' : target === 'workflow-procure' ? 'Procurement' : target === 'stock-on-hand' ? 'Stock on hand' : 'Stores')
    }
  }

  const readAll = async () => {
    const previous = notifications
    setNotifications((rows) => rows.map((row) => ({ ...row, is_read: true })))
    try {
      await markAllNotificationsRead()
      setBanners([])
      void loadNotifications(false)
    } catch (error) {
      setNotifications(previous)
      setNotificationsError('Could not mark notifications as read. Please retry.')
    }
  }

  const openMobileNavigation = () => window.dispatchEvent(new Event('tafiti-sidebar-open'))

  return <>
    <header className="neo-header">
      <div className="erp-topbar-left">
        <button className="neo-mobile-menu" type="button" onClick={openMobileNavigation} aria-label="Open navigation"><Icon name="menu" size={20} /></button>
<div className="neo-popover-anchor">
          <button type="button" className="neo-property-chip neo-switch-property" disabled={!canSelectProperty} aria-label="Active property" aria-haspopup={canSelectProperty ? 'listbox' : undefined} aria-expanded={canSelectProperty ? propertyMenuOpen : undefined} onClick={() => setPropertyMenuOpen((open) => !open)}>
            <Icon name="business" size={15} /><span>{propertyName}</span>{canSelectProperty && <Icon name="expand_more" size={14} />}
          </button>
          {propertyMenuOpen && <>
            <button type="button" className="neo-popover-backdrop" aria-label="Close property selector" onClick={() => setPropertyMenuOpen(false)} />
            <div className="neo-context-dropdown" role="listbox" aria-label="Select property">
              {app.data.branches.map((branch) => <button type="button" role="option" aria-selected={String(branch.name) === app.currentBranch} key={String(branch.id)} onClick={() => { app.selectBranch(String(branch.name)); setPropertyMenuOpen(false) }}>{String(branch.name)}</button>)}
            </div>
          </>}
        </div>
      </div>

      <button type="button" className="neo-search" onClick={() => setSearchOpen(true)} aria-label="Open global search">
        <Icon name="search" size={18} />
        <span>Search records, suppliers, LPOs…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="neo-header-actions">
        <span className={`neo-sync-state is-${app.apiStatus}`} title={`API status: ${app.apiStatus}`}><i />{app.apiStatus === 'live' ? 'Live' : app.apiStatus === 'loading' ? 'Syncing' : app.apiStatus === 'offline' ? 'Offline' : 'Connecting'}</span>
        <span className="neo-cost-center-chip" title="Active department / cost center"><Icon name="account_tree" size={14} />{contextName}</span>
        <span className={'neo-fiscal-chip' + (period?.status === 'closed' ? ' is-closed' : '')} title="Current fiscal period"><Icon name="calendar_month" size={14} />{periodLabel}</span>

        <div className="neo-popover-anchor">
          <button ref={notificationTriggerRef} type="button" className="neo-header-icon" aria-controls="hotel-notification-panel" onClick={() => {
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
            <button type="button" tabIndex={-1} className="neo-popover-backdrop" aria-label="Close notifications" onClick={() => {setNotificationsOpen(false);notificationTriggerRef.current?.focus()}} />
            <section id="hotel-notification-panel" className="neo-notification-panel" role="region" aria-label="Notifications">
              <header><div><strong>Notifications</strong><span>{unread ? `${unread} unread` : 'No unread notifications'}</span></div><button className="neo-icon-button" onClick={() => void loadNotifications()} aria-label="Refresh notifications"><Icon name="refresh" size={17} /></button></header>
              <div className="hotel-notification-controls">
                <button type="button" aria-pressed={!unreadOnly} onClick={()=>setUnreadOnly(false)}>All</button>
                <button type="button" aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(true)}>Unread ({unread})</button>
                <select aria-label="Notification category" value={category} onChange={e=>setCategory(e.target.value)}>{['All',...new Set(notifications.map(n=>n.category||'General'))].map(c=><option key={c}>{c}</option>)}</select>
                <button type="button" aria-pressed={desktop} onClick={()=>void enableDesktop()}>{desktop?'Desktop: On':'Desktop: Off'}</button>
                <button type="button" aria-pressed={quiet} onClick={toggleQuiet}>{quiet?'Do not disturb: On':'Do not disturb: Off'}</button>
              </div>
              {selectedNotice&&<div className="hotel-notification-controls"><strong>{selectedNotice.title}</strong><p>{selectedNotice.message}</p><button type="button" onClick={()=>setSelectedNotice(null)}>Close details</button></div>}
              <div className="neo-notification-list">
                {notificationsLoading && <NotificationState icon="progress_activity" title="Loading notifications" />}
                {!notificationsLoading && notificationsError && <NotificationState icon="error" title="Notifications may be out of date" detail={notificationsError} action={() => void loadNotifications()} />}
                {!notificationsLoading && !notificationsError && visibleNotifications.length === 0 && <NotificationState icon="notifications_none" title={unreadOnly?"No unread notifications":"No notifications"} />}
                {!notificationsLoading && visibleNotifications.map((notification) => <button key={notification.id} className={`neo-notification-item ${notification.is_read ? 'is-read' : ''}`} onClick={() => void readNotification(notification)}>
                  <span className="neo-notification-icon"><Icon name={notification.is_read ? 'notifications' : 'notification_important'} size={17} /></span>
                  <span><strong>{notification.title}{notification.priority==='critical'?' · Critical':notification.priority==='warning'?' · Warning':''}</strong><small>{notification.message}</small><time>{notificationTime(notification.created_at)}</time></span>
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
    <div className="hotel-notification-banners" aria-label="Incoming notifications">
      {banners.map(notification=><IncomingBanner key={notification.id} notification={notification} onDismiss={()=>dismissBanner(notification.id)} onOpen={()=>void readNotification(notification)}/>)}
    </div>
    <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
  </>
}

function NotificationState({ icon, title, detail, action }: { icon: string; title: string; detail?: string; action?: () => void }) {
  return <div className="neo-notification-state"><Icon name={icon} size={22} /><strong>{title}</strong>{detail && <span>{detail}</span>}{action && <button onClick={action}>Try again</button>}</div>
}

function notificationTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-UG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Kampala' }).format(date)
}

function IncomingBanner({notification,onDismiss,onOpen}:{notification:NotificationRecord;onDismiss:()=>void;onOpen:()=>void}){
  const dismiss=useRef(onDismiss)
  dismiss.current=onDismiss
  const [paused,setPaused]=useState(false)
  const critical=notification.priority==='critical'
  const warning=critical||notification.priority==='warning'||(!notification.priority&&/expir|variance|overdue|awaiting|approval|shortage/i.test(notification.title))
  const duration=warning?8000:6000
  useEffect(()=>{if(paused||critical)return;const timer=window.setTimeout(()=>dismiss.current(),duration);return()=>window.clearTimeout(timer)},[duration,paused,critical])
  return <aside className="hotel-incoming-banner" data-warning={warning} data-critical={critical} onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPaused(false)}}>
    <Icon name={warning?'notification_important':'notifications'} size={21}/>
    <div role="status" aria-live="polite"><strong>{notification.title}</strong><p>{notification.message}</p><button type="button" onClick={onOpen}>View notification</button></div>
    <button type="button" aria-label="Dismiss banner without marking read" onClick={onDismiss}><Icon name="close" size={18}/></button>
  </aside>
}
