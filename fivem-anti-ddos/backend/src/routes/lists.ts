import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { notFound } from '../errors.js'
import { parse } from '../http.js'
import { newId } from '../security.js'
import { getServerFor } from '../serverAccess.js'
import { parseListValue, splitListInput } from '../validate.js'

export const MAX_ENTRIES_PER_LIST = 5000

interface EntryRow {
  id: string
  list: 'block' | 'allow'
  kind: 'ip' | 'cidr' | 'identifier'
  value: string
  reason: string | null
  created_at: number
  expires_at: number | null
}

const serialize = (r: EntryRow) => ({
  id: r.id,
  list: r.list,
  kind: r.kind,
  value: r.value,
  reason: r.reason,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
})

const idParams = z.object({ id: z.string().min(1).max(100) })

export const listRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.get('/:id/lists', async (req) => {
      const { id } = parse(idParams, req.params)
      getServerFor(ctx, req, id)
      const rows = ctx.db.all<EntryRow>(
        `SELECT id, list, kind, value, reason, created_at, expires_at FROM list_entries
          WHERE server_id = ? AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY created_at DESC, value ASC`,
        id,
        ctx.now(),
      )
      return { items: rows.map(serialize), limit: MAX_ENTRIES_PER_LIST }
    })

    // Add one or many entries. `value` may contain several IPs / CIDR ranges / identifiers separated by
    // newlines, commas or spaces; each one is classified automatically.
    app.post('/:id/lists', async (req) => {
      const { id } = parse(idParams, req.params)
      const server = getServerFor(ctx, req, id)
      const body = parse(
        z.object({
          list: z.enum(['block', 'allow']),
          value: z.string().min(1).max(60_000),
          reason: z.string().trim().max(120).optional(),
          ttlSec: z.number().int().min(60).max(365 * 86400).nullable().optional(),
        }),
        req.body,
      )

      const now = ctx.now()
      const expiresAt = body.ttlSec ? now + body.ttlSec : null
      const skipped: { value: string; error: string }[] = []
      let added = 0

      ctx.db.tx(() => {
        let count = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM list_entries WHERE server_id = ? AND list = ?', id, body.list)!.n

        for (const token of splitListInput(body.value)) {
          const parsed = parseListValue(token)
          if ('error' in parsed) {
            skipped.push({ value: token.slice(0, 80), error: parsed.error })
            continue
          }
          const existing = ctx.db.get<{ id: string }>(
            'SELECT id FROM list_entries WHERE server_id = ? AND list = ? AND kind = ? AND value = ?',
            id,
            body.list,
            parsed.kind,
            parsed.value,
          )
          if (existing) {
            ctx.db.run('UPDATE list_entries SET reason = ?, expires_at = ? WHERE id = ?', body.reason ?? null, expiresAt, existing.id)
            added++
            continue
          }
          if (count >= MAX_ENTRIES_PER_LIST) {
            skipped.push({ value: token.slice(0, 80), error: `list is full (max. ${MAX_ENTRIES_PER_LIST} entries)` })
            continue
          }
          ctx.db.run(
            'INSERT INTO list_entries (id, server_id, list, kind, value, reason, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            newId('ent'),
            id,
            body.list,
            parsed.kind,
            parsed.value,
            body.reason ?? null,
            now,
            expiresAt,
          )
          count++
          added++
        }

        if (added > 0) ctx.db.run('UPDATE servers SET lists_rev = lists_rev + 1 WHERE id = ?', server.id)
      })

      return { added, skipped }
    })

    app.delete('/:id/lists/:entryId', async (req) => {
      const params = parse(z.object({ id: z.string().min(1).max(100), entryId: z.string().min(1).max(100) }), req.params)
      getServerFor(ctx, req, params.id)
      const res = ctx.db.run('DELETE FROM list_entries WHERE id = ? AND server_id = ?', params.entryId, params.id)
      if (res.changes === 0) throw notFound('entry')
      ctx.db.run('UPDATE servers SET lists_rev = lists_rev + 1 WHERE id = ?', params.id)
      return { ok: true }
    })
  }
