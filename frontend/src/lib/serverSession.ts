import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { canAccessRoute } from './access'
import { routeFromPath } from './navigation'

const SESSION_COOKIE = 'hms_server_session'

export async function authorizeWorkspace(pathname: string): Promise<void> {
  const destination = pathname.startsWith('/') && !pathname.startsWith('//')
    ? pathname : '/dashboard'
  const login = '/login?next=' + encodeURIComponent(destination)
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) redirect(login)
  const origin = (
    process.env.BACKEND_ORIGIN ||
    (process.env.NODE_ENV !== 'production'
      ? (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000')
      : '')
  ).replace(/\/+$/, '')
  if (!origin) redirect(login)

  let identity: {
    role?: string
    permissions?: string[]
    is_superuser?: boolean
    id?: string
  } | null = null
  let response: Response
  try {
    response = await fetch(origin + '/api/v1/auth/me/', {
      cache: 'no-store',
      headers: { Authorization: 'Token ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new Error('Unable to validate your hotel session. Please retry.')
  }
  if (!response.ok) redirect(login)
  try { identity = await response.json() } catch { redirect(login) }
  if (!identity?.id || typeof identity.role !== 'string') redirect(login)
  const route = routeFromPath(destination)
  if (!route) redirect('/dashboard')
  const allowed = canAccessRoute({
    role: identity.role,
    permissions: Array.isArray(identity.permissions) ? identity.permissions : [],
    isSuperuser: Boolean(identity.is_superuser),
  }, route)
  if (!allowed) redirect('/dashboard')
}
