import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  cfg,
  type EntityKey, type Row,
} from '../lib/data'
import {
  decideRequisition,
  deleteBackendRecord,
  errorMessage,
  fetchBackendData,
  fetchCurrentUser,
  getStoredUser,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  saveBackendRecord,
  type ApiStatus,
  type AuthUser,
} from '../lib/api'
import type { AccentName, Density, Mode } from '../lib/theme'
import { canAccessModule, canAccessRoute, canSwitchModules, operationsLandingFor } from '../lib/access'

export type Screen = 'login' | 'launchpad' | 'app'
export type Tab = 'overview' | 'procurement' | 'inventory'
export type ActiveModule = 'operations' | 'hr'

export interface User { name: string; role: string; id: string; employeeId: string; employeeCode: string; branchId: string; branchName: string; departmentId: string; departmentName: string; isStaff: boolean; isSuperuser: boolean; permissions: string[] }

interface FormTarget { entity: EntityKey; id: string | null }
interface ConfirmTarget { entity: EntityKey; id: string; name: string }
interface DetailTarget { entity: EntityKey; id: string; from: string }
type WorkflowAlertTone = 'failure' | 'warning'
interface WorkflowAlert { title: string; message: string; tone: WorkflowAlertTone }
interface ItemCategoryFilter { id: string; name: string }

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
  itemCategoryFilter: ItemCategoryFilter | null
  form: FormTarget | null
  formSaving: boolean
  confirm: ConfirmTarget | null
  detail: DetailTarget | null
  reportId: string | null
  toast: string | null
  workflowAlert: WorkflowAlert | null
  apiStatus: ApiStatus
  activeModule: ActiveModule
  apiMessage: string | null
  authMessage: string | null
  procurementDraftId: string | null
  inventoryDraftId: string | null
}

export interface AppContextValue extends AppState {
  user: User
  data: Record<EntityKey, Row[]>
  refreshData: () => void
  consumeProcurementDraft: () => void
  consumeInventoryDraft: () => void
  // auth
  login: (username: string, password: string, remember?: boolean) => Promise<void>
  // navigation
  enterLaunch: () => void
  enterApp: () => void
  enterHR: () => void
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
  viewCategoryItems: (category: Row) => void
  clearItemCategoryFilter: () => void
  // forms + crud
  openCreate: (entity?: EntityKey, label?: string) => void
  openEdit: (id: string) => void
  closeForm: () => void
  saveForm: (values: Row) => Promise<void>
  requestDelete: (id: string) => void
  closeConfirm: () => void
  doDelete: () => void
  // detail / approvals
  openDetail: (entity: EntityKey, id: string, from: string) => void
  backFromDetail: () => void
  approveReq: (comments?: string) => void
  rejectReq: (comments: string) => void
  returnReq: (comments: string) => void
  // reports
  openReport: (id: string) => void
  backFromReport: () => void
  // toast
  showToast: (msg: string) => void
  closeToast: () => void
  showWorkflowAlert: (title: string, message: string, tone?: WorkflowAlertTone) => void
  closeWorkflowAlert: () => void
}

const AppContext = createContext<AppContextValue | null>(null)
const GUEST: User = { name: 'Guest', role: '—', id: '', employeeId: '', employeeCode: '', branchId: '', branchName: '', departmentId: '', departmentName: '', isStaff: false, isSuperuser: false, permissions: [] }
const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000
const ACTIVITY_WRITE_INTERVAL_MS = 1000
const LAST_ACTIVITY_KEY = 'hms_last_activity'
const APPEARANCE_KEY = 'hms_appearance'

function toUser(user: AuthUser | null): User {
  return user
    ? { name: user.name, role: user.role, id: user.user_id || user.id, employeeId: user.employee_id || '', employeeCode: user.employee_code || '', branchId: user.branch_id || '', branchName: user.branch_name || '', departmentId: user.department_id || '', departmentName: user.department_name || '', isStaff: Boolean(user.is_staff), isSuperuser: Boolean(user.is_superuser), permissions: user.permissions || [] }
    : GUEST
}


function readAppearance(): { mode: Mode; accentName: AccentName; density: Density } {
  try {
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}')
    return {
      mode: saved.mode === 'dark' ? 'dark' : 'light',
      accentName: saved.accentName || 'Blue',
      density: saved.density === 'Compact' ? 'Compact' : 'Airy',
    }
  } catch {
    return { mode: 'light', accentName: 'Blue', density: 'Airy' }
  }
}

function readLastActivity(): number {
  try {
    const value = Number(localStorage.getItem(LAST_ACTIVITY_KEY))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function writeLastActivity(timestamp: number): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp))
  } catch {
    /* storage unavailable */
  }
}

function clearLastActivity(): void {
  try {
    localStorage.removeItem(LAST_ACTIVITY_KEY)
  } catch {
    /* storage unavailable */
  }
}

const entityKeys: EntityKey[] = [
  'branches',
  'items',
  'categories',
  'uoms',
  'itemUnits',
  'locations',
  'suppliers',
  'supplierItems',
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
  const [dataVersion, forceTick] = useState(0)
  const bumpData = useCallback(() => forceTick((n) => n + 1), [])
  const didInitialSync = useRef(false)
  const logoutRequest = useRef<Promise<void> | null>(null)
  const saveFormRequest = useRef<Promise<void> | null>(null)

  const storedUser = getStoredUser()
  const initialUser = toUser(storedUser)
  const [user, setUser] = useState<User>(initialUser)
  const hasSession = Boolean(getToken() && storedUser)
  const initialLanding = operationsLandingFor(initialUser)
  const showInitialLaunchpad = hasSession && canSwitchModules(initialUser)

  const appearance = readAppearance()
  const [state, setState] = useState<AppState>({
    screen: hasSession ? (showInitialLaunchpad ? 'launchpad' : 'app') : 'login',
    route: initialLanding.route,
    navActive: initialLanding.route,
    tab: 'overview',
    mode: appearance.mode,
    accentName: appearance.accentName,
    density: appearance.density,
    branchOpen: false,
    settingsOpen: false,
    currentBranch: '',
    crumb: initialLanding.crumb,
    searchTerm: '',
    itemCategoryFilter: null,
    form: null,
    formSaving: false,
    confirm: null,
    detail: null,
    reportId: null,
    toast: null,
    workflowAlert: null,
    apiStatus: 'idle',
    activeModule: 'operations',
    apiMessage: null,
    authMessage: null,
    procurementDraftId: null,
    inventoryDraftId: null,
  })

  const patch = useCallback((p: Partial<AppState>) => setState((s) => ({ ...s, ...p })), [])

  const showToast = useCallback((msg: string) => {
    patch({ toast: msg, workflowAlert: null })
  }, [patch])

  const showWorkflowAlert = useCallback((title: string, message: string, tone: WorkflowAlertTone = 'failure') => {
    patch({ workflowAlert: { title, message, tone }, toast: null })
  }, [patch])

  const endSession = useCallback((authMessage: string | null = null) => {
    clearLastActivity()
    const request = apiLogout()
    logoutRequest.current = request
    void request.finally(() => {
      if (logoutRequest.current === request) logoutRequest.current = null
    })
    setUser(GUEST)
    didInitialSync.current = false
    dataRef.current = emptyData()
    setState((current) => ({
      ...current,
      screen: 'login',
      route: 'dashboard',
      navActive: 'dashboard',
      currentBranch: '',
      branchOpen: false,
      settingsOpen: false,
      form: null,
      formSaving: false,
      confirm: null,
      detail: null,
      reportId: null,
      toast: null,
      workflowAlert: null,
      apiStatus: 'idle',
      apiMessage: null,
      authMessage,
      procurementDraftId: null,
      inventoryDraftId: null,
    }))
  }, [])

  useEffect(() => {
    if (state.screen === 'login' || !getToken()) return

    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let lastActivityWrite = 0

    const expireSession = () => {
      endSession(null)
    }

    const checkDeadline = () => {
      const lastActivity = readLastActivity()
      if (!lastActivity || Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
        expireSession()
        return
      }
      clearTimeout(idleTimer)
      idleTimer = setTimeout(checkDeadline, IDLE_TIMEOUT_MS - (Date.now() - lastActivity))
    }

    const recordActivity = (event: Event) => {
      if (!event.isTrusted) return
      const now = Date.now()
      const lastActivity = readLastActivity()
      if (lastActivity && now - lastActivity >= IDLE_TIMEOUT_MS) {
        expireSession()
        return
      }
      if (now - lastActivityWrite < ACTIVITY_WRITE_INTERVAL_MS) return
      lastActivityWrite = now
      writeLastActivity(now)
      clearTimeout(idleTimer)
      idleTimer = setTimeout(checkDeadline, IDLE_TIMEOUT_MS)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkDeadline()
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_KEY) return
      if (event.newValue === null) {
        endSession('Your session ended in another browser tab.')
      } else {
        checkDeadline()
      }
    }

    if (!readLastActivity()) writeLastActivity(Date.now())
    checkDeadline()

    const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, { passive: true })
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('storage', handleStorage)

    return () => {
      clearTimeout(idleTimer)
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, recordActivity)
      })
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [endSession, state.screen])

  const applyBackendData = useCallback((incoming: Partial<Record<EntityKey, Row[]>>) => {
    const next = emptyData()
    entityKeys.forEach((key) => {
      next[key] = incoming[key] || []
    })
    dataRef.current = next
    setState((current) => {
      const backendBranches = next.branches || []
      const branchExists = backendBranches.some((branch) => branch.name === current.currentBranch)
      const employeeBranch = backendBranches.find((branch) =>
        (user.branchId && String(branch.id) === user.branchId) ||
        (user.branchName && branch.name === user.branchName),
      )
      const branchScopedEntities: EntityKey[] = [
        'locations', 'employees', 'balances', 'ledgers', 'batches', 'reorderRules',
        'storeRequisitions', 'stockIssues', 'storeReturns', 'requisitions', 'orders',
        'grns', 'inspections', 'supplierReturns',
      ]
      const busiestBranch = backendBranches
        .map((branch) => ({
          branch,
          records: branchScopedEntities.reduce(
            (total, entity) => total + (next[entity] || []).filter((row) => String(row.branchId || '') === String(branch.id)).length,
            0,
          ),
        }))
        .sort((left, right) => right.records - left.records)[0]?.branch
      return {
        ...current,
        currentBranch: branchExists
          ? current.currentBranch
          : String(employeeBranch?.name || busiestBranch?.name || backendBranches[0]?.name || ''),
      }
    })
    bumpData()
  }, [bumpData, user.branchId, user.branchName])

  const refreshData = useCallback(async (silent = false) => {
    patch({ apiStatus: 'loading', apiMessage: null })
    try {
      const authenticatedUser = toUser(await fetchCurrentUser())
      setUser((current) => JSON.stringify(current) === JSON.stringify(authenticatedUser) ? current : authenticatedUser)
      const result = await fetchBackendData()
      applyBackendData(result.data)
      const rowsLoaded = Object.values(result.data).reduce((sum, rows) => sum + (rows?.length || 0), 0)
      const operationalWarning = result.warnings.find((warning) => !/\b(401|403)\b/.test(warning))
      patch({ apiStatus: 'live', apiMessage: operationalWarning || `Backend connected; ${rowsLoaded} accessible records loaded` })
      if (!silent) showToast('Backend synced')
    } catch (error) {
      const message = errorMessage(error)
      if (/\b401\b|session is no longer valid/i.test(message)) {
        endSession()
        return
      }
      dataRef.current = emptyData()
      bumpData()
      patch({ apiStatus: 'offline', apiMessage: message, currentBranch: '' })
      if (!silent) showWorkflowAlert('Backend unavailable', message)
    }
  }, [applyBackendData, bumpData, endSession, patch, showToast, showWorkflowAlert])

  useEffect(() => {
    if (state.screen === 'app' && !didInitialSync.current) {
      didInitialSync.current = true
      void refreshData(true)
    }
  }, [refreshData, state.screen])

  const saveForm = useCallback((values: Row): Promise<void> => {
    if (saveFormRequest.current) return saveFormRequest.current
    const target = state.form
    if (!target) return Promise.resolve()
    const row = target.id
      ? dataRef.current[target.entity].find((record) => record.id === target.id)
      : null
    const backendId = target.id ? String(row?.apiId || target.id) : null
    patch({ formSaving: true })
    let request: Promise<void>
    request = saveBackendRecord(target.entity, backendId, values, dataRef.current)
      .then(async (saved) => {
        await refreshData(true)
        const continueToProcurementLines = (
          !target.id
          && target.entity === 'requisitions'
          && canAccessRoute(user, 'workflow-procure')
        )
        const continueToInventoryLines = (
          !target.id
          && target.entity === 'storeRequisitions'
        )
        if (continueToProcurementLines) {
          patch({
            form: null,
            route: 'workflow-procure',
            navActive: 'workflow-procure',
            crumb: 'Add requisition articles',
            procurementDraftId: String(saved.id || ''),
          })
        } else if (continueToInventoryLines) {
          patch({
            form: null,
            route: 'workflow-stores',
            navActive: 'workflow-stores',
            crumb: 'Add requested articles',
            inventoryDraftId: String(saved.id || saved.apiId || ''),
          })
        } else {
          patch({ form: null })
        }
        showToast(target.id ? 'Changes saved to the backend' : `${cfg[target.entity].singular || 'Record'} created`)
      })
      .catch((error) => {
        showWorkflowAlert('Cannot save this record', errorMessage(error))
      })
      .finally(() => {
        if (saveFormRequest.current === request) saveFormRequest.current = null
        patch({ formSaving: false })
      })
    saveFormRequest.current = request
    return request
  }, [patch, refreshData, showToast, showWorkflowAlert, state.form, user])

  const doDelete = useCallback(() => {
    const target = state.confirm
    if (!target) return
    const row = dataRef.current[target.entity].find((record) => record.id === target.id)
    const backendId = String(row?.apiId || target.id)
    patch({ confirm: null })
    void deleteBackendRecord(target.entity, backendId)
      .then(async () => {
        await refreshData(true)
        showToast('Backend record removed')
      })
      .catch((error) => {
        showWorkflowAlert('Cannot remove this record', errorMessage(error))
      })
  }, [patch, refreshData, showToast, showWorkflowAlert, state.confirm])

  const approveReq = useCallback((comments = '') => {
    const target = state.detail
    if (!target) return
    const row = dataRef.current.requisitions.find((record) => record.id === target.id)
    const backendId = String(row?.apiId || target.id)
    void decideRequisition(backendId, 'approve', comments)
      .then(async () => {
        await refreshData(true)
        patch({ route: target.from || 'approvals', detail: null })
        showToast(`Requisition ${target.id} approved`)
      })
      .catch((error) => showWorkflowAlert('Approval blocked', errorMessage(error)))
  }, [patch, refreshData, showToast, showWorkflowAlert, state.detail])

  const rejectReq = useCallback((comments: string) => {
    const target = state.detail
    if (!target) return
    const row = dataRef.current.requisitions.find((record) => record.id === target.id)
    const backendId = String(row?.apiId || target.id)
    void decideRequisition(backendId, 'reject', comments)
      .then(async () => {
        await refreshData(true)
        patch({ route: target.from || 'approvals', detail: null })
        showToast(`Requisition ${target.id} rejected`)
      })
      .catch((error) => showWorkflowAlert('Rejection blocked', errorMessage(error)))
  }, [patch, refreshData, showToast, showWorkflowAlert, state.detail])

  const returnReq = useCallback((comments: string) => {
    const target = state.detail
    if (!target) return
    const row = dataRef.current.requisitions.find((record) => record.id === target.id)
    const backendId = String(row?.apiId || target.id)
    void decideRequisition(backendId, 'return-for-correction', comments)
      .then(async () => {
        await refreshData(true)
        patch({ route: target.from || 'approvals', detail: null })
        showToast(`Requisition ${target.id} returned for correction`)
      })
      .catch((error) => showWorkflowAlert('Return blocked', errorMessage(error)))
  }, [patch, refreshData, showToast, showWorkflowAlert, state.detail])

  const requestDelete = useCallback((id: string) => {
    setState((s) => {
      const row = dataRef.current[s.route as EntityKey]?.find((x) => x.id === id)
      return { ...s, confirm: { entity: s.route as EntityKey, id, name: (row && (row.name || row.id)) || id } }
    })
  }, [])

  const scopedData = useMemo(() => {
    if (!state.currentBranch) return dataRef.current
    const selected = dataRef.current.branches.find((branch) => branch.name === state.currentBranch)
    const branchId = String(selected?.id || '')
    if (!branchId) return dataRef.current
    const scoped = { ...dataRef.current }
    const branchEntities: EntityKey[] = [
      'locations', 'employees', 'balances', 'ledgers', 'batches', 'reorderRules',
      'storeRequisitions', 'stockIssues', 'storeReturns', 'requisitions', 'orders',
      'grns', 'inspections', 'supplierReturns',
    ]
    branchEntities.forEach((entity) => {
      scoped[entity] = dataRef.current[entity].filter((row) => String(row.branchId || '') === branchId)
    })
    return scoped
  }, [dataVersion, state.currentBranch])

  useEffect(() => {
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ mode: state.mode, accentName: state.accentName, density: state.density })) } catch { /* ignore */ }
    document.documentElement.dataset.theme = state.mode
    document.documentElement.style.colorScheme = state.mode
  }, [state.mode, state.accentName, state.density])

  const value = useMemo<AppContextValue>(() => ({
    ...state,
    user,
    data: scopedData,
    refreshData: () => { void refreshData() },
    login: async (username: string, password: string, remember = true) => {
      if (logoutRequest.current) await logoutRequest.current
      const authed = await apiLogin(username, password, remember)
      const signedInUser = toUser(authed)
      writeLastActivity(Date.now())
      setUser(signedInUser)
      didInitialSync.current = false
      const landing = operationsLandingFor(signedInUser)
      patch({
        screen: canSwitchModules(signedInUser) ? 'launchpad' : 'app',
        activeModule: 'operations',
        route: landing.route,
        navActive: landing.route,
        crumb: landing.crumb,
        branchOpen: false,
        settingsOpen: false,
        toast: null,
        workflowAlert: null,
        authMessage: null,
      })
    },
    enterLaunch: () => {
      const landing = operationsLandingFor(user)
      patch(canSwitchModules(user)
        ? { screen: 'launchpad', branchOpen: false, settingsOpen: false }
        : { screen: 'app', activeModule: 'operations', route: landing.route, navActive: landing.route, crumb: landing.crumb, branchOpen: false, settingsOpen: false })
    },
    enterApp: () => {
      const landing = operationsLandingFor(user)
      patch({ screen: 'app', activeModule: 'operations', route: landing.route, navActive: landing.route, crumb: landing.crumb })
    },
    enterHR: () => {
      if (!canAccessModule(user, 'hr')) {
        showWorkflowAlert('Access restricted', `Human Resources is not part of the ${user.role} role.`, 'warning')
        return
      }
      patch({ screen: 'app', activeModule: 'hr', route: 'hr-dashboard', navActive: 'hr-dashboard', crumb: 'People overview' })
    },
    logout: () => endSession(),
    gotoModules: () => {
      if (canSwitchModules(user)) {
        patch({ screen: 'launchpad' })
        return
      }
      const landing = operationsLandingFor(user)
      patch({ screen: 'app', activeModule: 'operations', route: landing.route, navActive: landing.route, crumb: landing.crumb })
    },
    navTo: (route, label) => {
      if (!canAccessRoute(user, route)) {
        showWorkflowAlert('Access restricted', `${label || 'This area'} is not available to the ${user.role} role.`, 'warning')
        return
      }
      patch({ route, navActive: route, crumb: label || '', searchTerm: '', itemCategoryFilter: null, detail: null })
    },
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
    viewCategoryItems: (category) => patch({
      route: 'items',
      navActive: 'items',
      crumb: 'Article catalogue',
      searchTerm: '',
      itemCategoryFilter: { id: String(category.id), name: String(category.name || 'Category') },
      detail: null,
    }),
    clearItemCategoryFilter: () => patch({ itemCategoryFilter: null }),
    consumeProcurementDraft: () => patch({ procurementDraftId: null }),
    consumeInventoryDraft: () => patch({ inventoryDraftId: null }),
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
    returnReq,
    openReport: (reportId) => patch({ route: 'reportview', reportId }),
    backFromReport: () => patch({ route: 'reports', reportId: null }),
    showToast,
    closeToast: () => patch({ toast: null }),
    showWorkflowAlert,
    closeWorkflowAlert: () => patch({ workflowAlert: null }),
  }), [state, user, scopedData, refreshData, patch, endSession, saveForm, requestDelete, doDelete, approveReq, rejectReq, returnReq, showToast, showWorkflowAlert])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
