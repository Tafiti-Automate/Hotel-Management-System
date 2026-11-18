export class ApiHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiHttpError'
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 401
}

/** Convert common failed reads into actionable, non-technical guidance. */
export function explainReadFailure(path: string, status: number): string {
  const resource = path.split('?')[0].replace(/\//g, ' ').replace(/-/g, ' ').trim() || 'records'
  if (status === 401) return '401: Your session has expired. Sign in again to continue.'
  if (status === 403) return 'Access restricted: your assigned role cannot view ' + resource +
    '. Ask your manager to review your permissions; never use another employee account.'
  if (status === 404) return 'The requested ' + resource + ' resource is not available. Refresh or contact support.'
  if (status >= 500) return 'The server could not load ' + resource + '. Your records have not been changed. Retry once the service recovers.'
  return 'Could not load ' + resource + ' (' + status + '). Check your filters and retry.'
}
