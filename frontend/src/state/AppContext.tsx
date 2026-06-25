import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  cfg, nextId, itemStatus,
  type EntityKey, type Row,
} from '../lib/data'
import {
  decideRequisition,
  deleteBackendRecord,
  errorMessage,
  fetchBackendData,
  getStoredUser,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  saveBackendRecord,
  type ApiStatus,
  type AuthUser,
} from '../lib/api'
import type { AccentName, Density, Mode } from '../lib/theme'

export type Screen = 'login' | 'launchpad' | 'app'
export type Tab = 'overview' | 'procurement' | 'inventory'

export interface User { name: string; role: string; id: string; isStaff: boolean }

interface FormTarget { entity: EntityKey; id: string | null }
interface ConfirmTarget { entity: EntityKey; id: string; name: string }
interface DetailTarget { entity: EntityKey; id: string; from: string }

interface AppState {
  screen: Screen
  route: string
  navActive: string
  tab: Tab
  mode: Mode
  accentName: AccentName
  density: Density
  branchOpen: boolean
  settingsOpen: boolean
  currentBranch: string
  crumb: string
  searchTerm: string
  form: FormTarget | null
  confirm: ConfirmTarget | null
  detail: DetailTarget | null
  reportId: string | null
  toast: string | null
  apiStatus: ApiStatus
  apiMessage: string | null
}

export interface AppContextValue extends AppState {
  user: User
  data: Record<EntityKey, Row[]>
  refreshData: () => void
  // auth
  login: (username: string, password: string) => Promise<void>
  // navigation
  enterLaunch: () => void
  enterApp: () => void
  logout: () => void
  gotoModules: () => void
  navTo: (route: string, label: string) => void
  setTab: (tab: Tab) => void
  // appearance
  toggleMode: () => void
  setMode: (mode: Mode) => void
  setAccent: (accent: AccentName) => void
  setDensity: (density: Density) => void
  toggleBranch: () => void
  selectBranch: (branch: string) => void
  toggleSettings: () => void
  closePop: () => void
  // list / search
  setSearchTerm: (term: string) => void
  // forms + crud
  openCreate: (entity?: EntityKey, label?: string) => void
  openEdit: (id: string) => void
  closeForm: () => void
  saveForm: (values: Row) => void
  requestDelete: (id: string) => void
  closeConfirm: () => void
  doDelete: () => void
  // detail / approvals
  openDetail: (entity: EntityKey, id: string, from: string) => void
  backFromDetail: () => void
  approveReq: () => void
  rejectReq: () => void
  // reports
  openReport: (id: string) => void
  backFromReport: () => void
  // toast
  showToast: (msg: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)
const entityKeys: EntityKey[] = [
  'items',
  'categories',
  'uoms',
  'locations',
  'suppliers',
  'departments',
  'employees',
  'balances',
  'ledgers',
  'batches',
  'reorderRules',
  'storeRequisitions',
  'stockIssues',
  'storeReturns',
  'requisitions',
  'orders',
  'grns',
  'inspections',
  'supplierReturns',
]

function emptyData(): Record<EntityKey, Row[]> {
  return entityKeys.reduce((data, key) => {
    data[key] = []
    return data
  }, {} as Record<EntityKey, Row[]>)
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export function AppProvider({ children }: { children: ReactNode }) {
  const dataRef = useRef<Record<EntityKey, Row[]>>(emptyData())
  const [, forceTick] = useState(0)
  const bumpData = useCallback(() => forceTick((n) => n + 1), [])
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const didInitialSync = useRef(false)

  const GUEST: User = { name: 'Guest', role: '—', id: '', isStaff: false }
  const toUser = (u: AuthUser | null): User => (u ? { name: u.name, role: u.role, id: u.id, isStaff: Boolean(u.is_staff) } : GUEST)
  const storedUser = getStoredUser()
  const [user, setUser] = useState<User>(toUser(storedUser))
  const hasSession = Boolean(getToken() && storedUser)

  const [state, setState] = useState<AppState>({
    screen: hasSession ? 'launchpad' : 'login',
    route: 'dashboard',
    navActive: 'dashboard',
    tab: 'overview',
    mode: 'light',
    accentName: 'Violet',
    density: 'Airy',
    branchOpen: false,
    settingsOpen: false,
    currentBranch: 'Backend Property',
    crumb: 'Dashboard',
    searchTerm: '',
    form: null,
    confirm: null,
    detail: null,
    reportId: null,
    toast: null,
    apiStatus: 'idle',
    apiMessage: null,
  })

  const patch = useCallback((p: Partial<AppState>) => setState((s) => ({ ...s, ...p })), [])

  const showToast = useCallback((msg: string) => {
    patch({ toast: msg })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => patch({ toast: null }), 2200)
  }, [patch])

  const applyBackendData = useCallback((incoming: Partial<Record<EntityKey, Row[]>>) => {
    const next = emptyData()
    entityKeys.forEach((key) => {
      next[key] = incoming[key] || []
    })
    dataRef.current = next
    bumpData()
  }, [bumpData])

  const refreshData = useCallback(async (silent = false) => {
    patch({ apiStatus: 'loading', apiMessage: null })
    try {
      const result = await fetchBackendData()
      applyBackendData(result.data)
      const rowsLoaded = Object.values(result.data).reduce((sum, rows) => sum + (rows?.length || 0), 0)
      patch({ apiStatus: 'live', apiMessage: result.warnings[0] || `Backend connected; ${rowsLoaded} records loaded` })
      if (!silent) showToast('Backend synced')
    } catch (error) {
      dataRef.current = emptyData()
      bumpData()
      patch({ apiStatus: 'offline', apiMessage: errorMessage(error) })
      if (!silent) showToast('Backend unavailable')
    }
  }, [applyBackendData, bumpData, patch, showToast])

  useEffect(() => {
    if (state.screen === 'app' && !didInitialSync.current) {
      didInitialSync.current = true
      void refreshData(true)
    }
  }, [refreshData, state.screen])

  const saveForm = useCallback((values: Row) => {
    const target = state.form
    setState((s) => {
      const f = s.form
      if (!f) return s
      const arr = dataRef.current[f.entity]
      if (f.id) {
        const r = arr.find((x) => x.id === f.id)
        if (r) {
          Object.assign(r, values)
          if (f.entity === 'items') r.status = itemStatus(r)
        }
      } else {
        const nu: Row = { id: nextId(f.entity, dataRef.current), ...values }
        if (f.entity === 'items') nu.status = itemStatus(nu)
        if (f.entity === 'categories') { nu.itemsCount = 0; nu.parent = nu.parent || '—' }
        if (f.entity === 'uoms') nu.itemsCount = 0
        if (f.entity === 'locations') nu.itemsCount = 0
        if (f.entity === 'suppliers') nu.rating = nu.rating || 4.0
        if (f.entity === 'requisitions') {
          nu.date = nu.expected_date || new Date().toISOString().slice(0, 10)
          nu.dept = nu.dept || (nu.request_type === 'hotel_purchase' ? 'Hotel purchase' : '—')
          nu.status = 'Draft'
          nu.lines = []
          nu.count = 0
          nu.total = 0
        }
        arr.unshift(nu)
      }
      const created = !f.id ? (cfg[f.entity].singular || 'Record') + ' created' : 'Changes saved'
      showToast(created)
      return { ...s, form: null }
    })
    bumpData()

    if (target) {
      void saveBackendRecord(target.entity, target.id, values, dataRef.current)
        .then(() => refreshData(true))
        .catch((error) => {
          patch({ apiStatus: 'offline', apiMessage: errorMessage(error) })
          showToast('Saved locally; backend sync failed')
        })
    }
  }, [bumpData, patch, refreshData, showToast, state.form])

  const doDelete = useCallback(() => {
    const target = state.confirm
    setState((s) => {
      const c = s.confirm
      if (c) {
        const arr = dataRef.current[c.entity]
        const i = arr.findIndex((x) => x.id === c.id)
        if (i >= 0) arr.splice(i, 1)
      }
      return { ...s, confirm: null }
    })
    bumpData()
    showToast('Record deleted')

    if (target) {
      void deleteBackendRecord(target.entity, target.id)
        .then(() => refreshData(true))
        .catch((error) => {
          patch({ apiStatus: 'offline', apiMessage: errorMessage(error) })
          showToast('Deleted locally; backend sync failed')
        })
    }
  }, [bumpData, patch, refreshData, showToast, state.confirm])

  const approveReq = useCallback(() => {
    const target = state.detail
    setState((s) => {
      const d = s.detail
      if (!d) return s
      const r = dataRef.current.requisitions.find((x) => x.id === d.id)
      if (r) r.status = 'Approved'
      showToast('Requisition ' + d.id + ' approved')
      return { ...s, route: d.from || 'approvals', detail: null }
    })
    bumpData()

    if (target) {
      void decideRequisition(target.id, 'approve')
        .then(() => refreshData(true))
        .catch((error) => {
          patch({ apiStatus: 'offline', apiMessage: errorMessage(error) })
          showToast('Approved locally; backend sync failed')
        })
    }
  }, [bumpData, patch, refreshData, showToast, state.detail])

  const rejectReq = useCallback(() => {
    const target = state.detail
    setState((s) => {
      const d = s.detail
      if (!d) return s
      const r = dataRef.current.requisitions.find((x) => x.id === d.id)
      if (r) r.status = 'Rejected'
      showToast('Requisition ' + d.id + ' rejected')
      return { ...s, route: d.from || 'approvals', detail: null }
    })
    bumpData()

    if (target) {
      void decideRequisition(target.id, 'reject')
        .then(() => refreshData(true))
        .catch((error) => {
          patch({ apiStatus: 'offline', apiMessage: errorMessage(error) })
          showToast('Rejected locally; backend sync failed')
        })
    }
  }, [bumpData, patch, refreshData, showToast, state.detail])

  const requestDelete = useCallback((id: string) => {
    setState((s) => {
      const row = dataRef.current[s.route as EntityKey]?.find((x) => x.id === id)
      return { ...s, confirm: { entity: s.route as EntityKey, id, name: (row && (row.name || row.id)) || id } }
    })
  }, [])

  const value = useMemo<AppContextValue>(() => ({
    ...state,
    user,
    data: dataRef.current,
    refreshData: () => { void refreshData() },
    login: async (username: string, password: string) => {
      const authed = await apiLogin(username, password)
      setUser(toUser(authed))
      didInitialSync.current = false
      patch({ screen: 'launchpad', branchOpen: false, settingsOpen: false })
    },
    enterLaunch: () => patch({ screen: 'launchpad', branchOpen: false, settingsOpen: false }),
    enterApp: () => patch({ screen: 'app', route: 'dashboard', navActive: 'dashboard', crumb: 'Dashboard' }),
    logout: () => {
      void apiLogout()
      setUser(GUEST)
      didInitialSync.current = false
      dataRef.current = emptyData()
      patch({ screen: 'login' })
    },
    gotoModules: () => patch({ screen: 'launchpad' }),
    navTo: (route, label) => patch({ route, navActive: route, crumb: label || '', searchTerm: '', detail: null }),
    setTab: (tab) => patch({ tab }),
    toggleMode: () => setState((s) => ({ ...s, mode: s.mode === 'dark' ? 'light' : 'dark' })),
    setMode: (mode) => patch({ mode }),
    setAccent: (accentName) => patch({ accentName }),
    setDensity: (density) => patch({ density }),
    toggleBranch: () => setState((s) => ({ ...s, branchOpen: !s.branchOpen, settingsOpen: false })),
    selectBranch: (currentBranch) => patch({ currentBranch, branchOpen: false }),
    toggleSettings: () => setState((s) => ({ ...s, settingsOpen: !s.settingsOpen, branchOpen: false })),
    closePop: () => patch({ branchOpen: false, settingsOpen: false }),
    setSearchTerm: (searchTerm) => patch({ searchTerm }),
    openCreate: (entity, label) => {
      const target = (typeof entity === 'string' ? entity : state.route) as EntityKey
      const next: Partial<AppState> = {
        form: { entity: target, id: null },
        branchOpen: false,
        settingsOpen: false,
      }
      if (typeof entity === 'string') {
        next.route = target
        next.navActive = target
        next.crumb = label || cfg[target]?.title || ''
        next.searchTerm = ''
        next.detail = null
      }
      patch(next)
    },
    openEdit: (id) => patch({ form: { entity: state.route as EntityKey, id } }),
    closeForm: () => patch({ form: null }),
    saveForm,
    requestDelete,
    closeConfirm: () => patch({ confirm: null }),
    doDelete,
    openDetail: (entity, id, from) => patch({ route: 'detail', detail: { entity, id, from } }),
    backFromDetail: () => patch({ route: (state.detail && state.detail.from) || 'requisitions', detail: null }),
    approveReq,
    rejectReq,
    openReport: (reportId) => patch({ route: 'reportview', reportId }),
    backFromReport: () => patch({ route: 'reports', reportId: null }),
    showToast,
  }), [state, user, refreshData, patch, saveForm, requestDelete, doDelete, approveReq, rejectReq, showToast])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
