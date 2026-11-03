export class ApiHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiHttpError'
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 401
}
