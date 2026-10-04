import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { destroyUserSessions, requireAdmin } from '../auth.js'
import type { AppContext } from '../context.js'
import { HttpError, notFound } from '../errors.js'
import { emailSchema, parse, passwordSchema } from '../http.js'
import { hashPassword, newId } from '../security.js'

interface UserListRow {
  id: string
  email: string
  role: 'admin' | 'user'
  created_at: number
  last_login_at: number | null
  server_count: number
}

const serialize = (r: UserListRow) => ({
  id: r.id,
  email: r.email,
  role: r.role,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
  serverCount: r.server_count,
})

const roleSchema = z.enum(['admin', 'user'])

export const userRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    const list = () =>
      ctx.db.all<UserListRow>(
        `SELECT u.id, u.email, u.role, u.created_at, u.last_login_at,
                (SELECT COUNT(*) FROM servers s WHERE s.owner_id = u.id) AS server_count
           FROM users u ORDER BY u.created_at ASC`,
      )
    const one = (id: string) => list().find((u) => u.id === id)
    const adminCount = () => ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")!.n

    app.get('/', async (req) => {
      requireAdmin(req)
      return { items: list().map(serialize) }
    })

    app.post('/', async (req, reply) => {
      requireAdmin(req)
      const body = parse(z.object({ email: emailSchema, password: passwordSchema, role: roleSchema.default('user') }), req.body)
      if (ctx.db.get('SELECT 1 FROM users WHERE email = ?', body.email)) {
        throw new HttpError(409, 'email_taken', 'An account with this email already exists.')
      }
      const id = newId('usr')
      const hash = await hashPassword(body.password, ctx.config.scryptN)
      ctx.db.run(
        'INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
        id,
        body.email,
        hash,
        body.role,
        ctx.now(),
      )
      reply.code(201)
      return { user: serialize(one(id)!) }
    })

    app.patch('/:id', async (req) => {
      const admin = requireAdmin(req)
      const { id } = parse(z.object({ id: z.string().min(1).max(100) }), req.params)
      const body = parse(z.object({ password: passwordSchema.optional(), role: roleSchema.optional() }), req.body)
      const target = one(id)
      if (!target) throw notFound('user')

      if (body.role && body.role !== target.role) {
        if (target.id === admin.id) throw new HttpError(400, 'cannot_change_self', 'You cannot change your own role.')
        if (target.role === 'admin' && adminCount() <= 1) throw new HttpError(400, 'last_admin', 'At least one administrator is required.')
        ctx.db.run('UPDATE users SET role = ? WHERE id = ?', body.role, id)
      }
      if (body.password) {
        const hash = await hashPassword(body.password, ctx.config.scryptN)
        ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, id)
        destroyUserSessions(ctx, id)
      }
      return { user: serialize(one(id)!) }
    })

    app.delete('/:id', async (req) => {
      const admin = requireAdmin(req)
      const { id } = parse(z.object({ id: z.string().min(1).max(100) }), req.params)
      const target = one(id)
      if (!target) throw notFound('user')
      if (target.id === admin.id) throw new HttpError(400, 'cannot_delete_self', 'You cannot delete your own account.')
      if (target.role === 'admin' && adminCount() <= 1) throw new HttpError(400, 'last_admin', 'At least one administrator is required.')
      ctx.db.run('DELETE FROM users WHERE id = ?', id) // cascades to sessions and servers
      return { ok: true }
    })
  }
