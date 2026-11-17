import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const SESSION_COOKIE = 'hms_server_session'
const backendOrigin = () => (
  process.env.BACKEND_ORIGIN ||
  (process.env.NODE_ENV !== 'production'
    ? (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000')
    : '')
).replace(/\/+$/, '')

const cookieOptions = (req: NextRequest) => ({
  httpOnly: true as const,
  secure: req.nextUrl.protocol === 'https:',
  sameSite: 'lax' as const,
  path: '/',
})

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  return !origin || origin === req.nextUrl.origin
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ detail: 'Invalid request origin.' }, { status: 403 })
  }
  const json: unknown = await request.json().catch(() => null)
  const body = json && typeof json === 'object' && !Array.isArray(json)
    ? json as Record<string, unknown> : {}
  const token = body.token
  if (typeof token !== 'string' || !/^[a-zA-Z0-9]{32,128}$/.test(token)) {
    return NextResponse.json({ detail: 'Invalid session token.' }, { status: 400 })
  }
  const origin = backendOrigin()
  if (!origin) return NextResponse.json({ detail: 'Backend origin not configured.' }, { status: 503 })
  try {
    const response = await fetch(origin + '/api/v1/auth/me/', {
      method: 'GET', cache: 'no-store',
      headers: { Authorization: 'Token ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return NextResponse.json({ detail: 'Session was not accepted by Django.' }, { status: 401 })
    const identity = await response.json() as { id?: string }
    if (!identity?.id) return NextResponse.json({ detail: 'No authenticated user.' }, { status: 401 })
    const result = NextResponse.json({ authenticated: true })
    result.cookies.set(SESSION_COOKIE, token, {
      ...cookieOptions(request),
      ...(body.remember === false ? {} : { maxAge: 60 * 60 * 24 }),
    })
    result.headers.set('Cache-Control', 'no-store')
    return result
  } catch {
    return NextResponse.json({ detail: 'Unable to verify server session.' }, { status: 503 })
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ detail: 'Invalid request origin.' }, { status: 403 })
  const result = NextResponse.json({ authenticated: false })
  result.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(request), maxAge: 0 })
  result.headers.set('Cache-Control', 'no-store')
  return result
}
