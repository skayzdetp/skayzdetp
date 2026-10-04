import { z } from 'zod'
import { HttpError } from './errors.js'

/** Validate `data` against a Zod schema; throws a 400 HttpError with a readable message. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  const first = issues[0]
  throw new HttpError(
    400,
    'validation_error',
    first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid input',
    issues,
  )
}

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'))
export const passwordSchema = z.string().min(10, 'Password must be at least 10 characters').max(200, 'Password is too long')
export const serverNameSchema = z.string().trim().min(1, 'Name is required').max(60, 'Name is too long')

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
