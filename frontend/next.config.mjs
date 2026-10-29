const configuredOrigin = (
  process.env.BACKEND_ORIGIN ||
  (process.env.NODE_ENV !== 'production' ? (process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000') : '')
).trim()

const backendOrigin = configuredOrigin.replace(/\/+$/, '')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!backendOrigin) {
      console.warn('[hotel-erp] BACKEND_ORIGIN is required to proxy Django API calls.')
      return []
    }
    return [
      { source: '/api/:path*', destination: `${backendOrigin}/api/:path*` },
      { source: '/media/:path*', destination: `${backendOrigin}/media/:path*` },
    ]
  },
}

export default nextConfig
