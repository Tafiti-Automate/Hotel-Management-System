/**
 * Canonical API resource names are owned by the Django router.
 * Keep display/workspace collection keys unchanged while translating legacy
 * frontend names at the HTTP boundary.
 */
export function resolveBackendResourcePath(path: string): string {
  const [resource, ...rest] = path.split('/')
  // Django registers apps.vendors.urls as /api/v1/vendors/, not /suppliers/.
  const canonicalResource = resource === 'suppliers' ? 'vendors' : resource
  return [canonicalResource, ...rest].join('/')
}
