import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AppContext } from './context.js'
import { HttpError } from './errors.js'
import { randomToken, sha256Hex } from './security.js'

export const SESSION_COOKIE = 'fxs_session'

export interface SessionUser {
  id: string
  email: string
  role: 'admin' | 'user'
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
    sessionId: string | null
  }
}

interface SessionJoin {
  session_id: string
  expires_at: number
  user_id: string
  email: string
  role: 'admin' | 'user'
}

export function createSession(ctx: AppContext, userId: string, req: FastifyRequest): { token: string; expiresAt: number } {
  const token = randomToken(32)
  const now = ctx.now()
  const expiresAt = now + ctx.config.sessionTtlSec
  ctx.db.run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    sha256Hex(token),
    userId,
    now,
    expiresAt,
    req.ip,
    String(req.headers['user-agent'] ?? '').slice(0, 200),
  )
  return { token, expiresAt }
}

export function destroySession(ctx: AppContext, sessionId: string): void {
  ctx.db.run('DELETE FROM sessions WHERE id = ?', sessionId)
}

export function destroyUserSessions(ctx: AppContext, userId: string, exceptSessionId?: string | null): void {
  if (exceptSessionId) ctx.db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', userId, exceptSessionId)
  else ctx.db.run('DELETE FROM sessions WHERE user_id = ?', userId)
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string, expiresAt: number): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: ctx.config.cookieSecure,
    maxAge: Math.max(1, expiresAt - ctx.now()),
  })
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: ctx.config.cookieSecure })
}

/** Resolve the session cookie to a user (and slide the expiry when it is half used up). */
export function resolveSession(ctx: AppContext, req: FastifyRequest, reply: FastifyReply): void {
  req.user = null
  req.sessionId = null
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token || token.length > 200) return

  const id = sha256Hex(token)
  const now = ctx.now()
  const row = ctx.db.get<SessionJoin>(
    `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    id,
  )
  if (!row) return
  if (row.expires_at <= now) {
    destroySession(ctx, id)
    return
  }

  req.user = { id: row.user_id, email: row.email, role: row.role }
  req.sessionId = row.session_id

  if (row.expires_at - now < ctx.config.sessionTtlSec / 2) {
    const expiresAt = now + ctx.config.sessionTtlSec
    ctx.db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', expiresAt, id)
    setSessionCookie(ctx, reply, token, expiresAt)
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'unauthorized', 'Please sign in.')
  return req.user
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const user = requireUser(req)
  if (user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required.')
  return user
}
