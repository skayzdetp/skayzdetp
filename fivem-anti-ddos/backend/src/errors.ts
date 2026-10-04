export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code)
    this.name = 'HttpError'
  }
}

export const notFound = (what = 'resource') => new HttpError(404, 'not_found', `${what} not found`)
