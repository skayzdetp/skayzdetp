import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
  clearSessionCookie,
  createSession,
  destroySession,
  destroyUserSessions,
  requireUser,
  setSessionCookie,
} from '../auth.js'
import type { AppContext } from '../context.js'
import { HttpError } from '../errors.js'
import { emailSchema, parse, passwordSchema } from '../http.js'
import { hashPassword, newId, safeEqual, verifyPassword } from '../security.js'

interface UserRow {
  id: string
  email: string
  password_hash: string
  role: 'admin' | 'user'
}

let dummyHash: Promise<string> | null = null

export const authRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    const userCount = () => ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n

    app.get('/me', async (req) => ({
      user: req.user,
      needsSetup: userCount() === 0,
    }))

    // First-run: create the initial administrator. Protected by the one-time token printed in the server log.
    app.post(
      '/setup',
      { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
      async (req, reply) => {
        const body = parse(
          z.object({ setupToken: z.string().min(1).max(200), email: emailSchema, password: passwordSchema }),
          req.body,
        )
        if (userCount() > 0 || !ctx.setup.token) throw new HttpError(409, 'already_setup', 'Setup was already completed.')
        if (!safeEqual(body.setupToken.trim(), ctx.setup.token)) {
          throw new HttpError(403, 'invalid_setup_token', 'The setup token is wrong. Check the server log.')
        }

        const passwordHash = await hashPassword(body.password, ctx.config.scryptN)
        const id = newId('usr')
        ctx.db.tx(() => {
          // re-check inside the transaction: two parallel setup requests must not create two admins
          if (userCount() > 0) throw new HttpError(409, 'already_setup', 'Setup was already completed.')
          ctx.db.run(
            'INSERT INTO users (id, email, password_hash, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)',
            id,
            body.email,
            passwordHash,
            'admin',
            ctx.now(),
            ctx.now(),
          )
        })
        ctx.setup.token = null

        const session = createSession(ctx, id, req)
        setSessionCookie(ctx, reply, session.token, session.expiresAt)
        return { user: { id, email: body.email, role: 'admin' as const } }
      },
    )

    app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const body = parse(z.object({ email: emailSchema, password: z.string().min(1).max(200) }), req.body)
      const user = ctx.db.get<UserRow>('SELECT id, email, password_hash, role FROM users WHERE email = ?', body.email)

      // Always run a full scrypt verification so response time does not reveal whether the account exists.
      dummyHash ??= hashPassword('fxshield-dummy-password', ctx.config.scryptN)
      const ok = await verifyPassword(body.password, user?.password_hash ?? (await dummyHash))
      if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'Invalid email or password.')

      ctx.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', ctx.now(), user.id)
      const session = createSession(ctx, user.id, req)
      setSessionCookie(ctx, reply, session.token, session.expiresAt)
      return { user: { id: user.id, email: user.email, role: user.role } }
    })

    app.post('/logout', async (req, reply) => {
      if (req.sessionId) destroySession(ctx, req.sessionId)
      clearSessionCookie(ctx, reply)
      return { ok: true }
    })

    app.post('/password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const user = requireUser(req)
      const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }), req.body)
      const row = ctx.db.get<UserRow>('SELECT id, email, password_hash, role FROM users WHERE id = ?', user.id)
      if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
        throw new HttpError(403, 'invalid_credentials', 'Current password is wrong.')
      }
      const hash = await hashPassword(body.newPassword, ctx.config.scryptN)
      ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id)
      destroyUserSessions(ctx, user.id, req.sessionId) // sign out everywhere else
      return { ok: true }
    })
  }
