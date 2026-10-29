const configuredOrigin = (
  process.env.BACKEND_ORIGIN ||
  (process.env.NODE_ENV !== 'production' ? (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000') : '')
).trim()

const backendOrigin = configuredOrigin.replace(/\/+$/, '')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Django REST Framework routes conventionally retain their trailing slash.
  // Disabling Next's canonical slash redirect prevents /api redirect loops.
  skipTrailingSlashRedirect: true,
  // Keep Turbopack scoped to this deployable app even when a developer has
  // unrelated lockfiles higher in their home directory.
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    if (!backendOrigin) {
      console.warn('[hotel-erp] BACKEND_ORIGIN is required to proxy Django API calls.')
      return []
    }
    return [
      // The API client and DRF URLconf both use canonical slash-terminated
      // endpoints. Keep that slash on the proxied destination.
      { source: '/api/:path*', destination: `${backendOrigin}/api/:path*/` },
      { source: '/media/:path*', destination: `${backendOrigin}/media/:path*` },
    ]
  },
}

export default nextConfig
