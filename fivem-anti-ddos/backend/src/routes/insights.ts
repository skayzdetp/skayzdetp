import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { parse } from '../http.js'
import { getServerFor } from '../serverAccess.js'
import type { Param } from '../db.js'

const RANGES = {
  '1h': { seconds: 3600, step: 60 },
  '6h': { seconds: 6 * 3600, step: 300 },
  '24h': { seconds: 24 * 3600, step: 900 },
  '7d': { seconds: 7 * 86400, step: 3600 },
} as const

interface BucketRow {
  t: number
  attempts: number
  allowed: number
  blocked: number
  monitored: number
  kicked: number
  banned: number
  cancelled: number
}

interface EventRow {
  id: number
  ts: number
  type: string
  rule: string | null
  severity: string
  action: string
  ip: string | null
  identifier: string | null
  player_name: string | null
  detail: string | null
  count: number
}

const idParams = z.object({ id: z.string().min(1).max(100) })

export const insightRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.get('/:id/stats', async (req) => {
      const { id } = parse(idParams, req.params)
      getServerFor(ctx, req, id)
      const { range } = parse(z.object({ range: z.enum(['1h', '6h', '24h', '7d']).default('24h') }), req.query)
      const { seconds, step } = RANGES[range]

      const now = ctx.now()
      const start = Math.floor((now - seconds) / step) * step
      const rows = ctx.db.all<BucketRow>(
        `SELECT (bucket / ?) * ? AS t,
                SUM(attempts) AS attempts, SUM(allowed) AS allowed, SUM(blocked) AS blocked, SUM(monitored) AS monitored,
                SUM(kicked) AS kicked, SUM(banned) AS banned, SUM(cancelled) AS cancelled
           FROM stats_minute WHERE server_id = ? AND bucket >= ? GROUP BY t ORDER BY t`,
        step,
        step,
        id,
        start,
      )
      const byT = new Map(rows.map((r) => [r.t, r]))

      // continuous series (empty buckets = 0) so the chart axis is stable
      const buckets: BucketRow[] = []
      const totals = { attempts: 0, allowed: 0, blocked: 0, monitored: 0, kicked: 0, banned: 0, cancelled: 0 }
      for (let t = start; t <= now; t += step) {
        const r = byT.get(t) ?? { t, attempts: 0, allowed: 0, blocked: 0, monitored: 0, kicked: 0, banned: 0, cancelled: 0 }
        buckets.push(r)
        totals.attempts += r.attempts
        totals.allowed += r.allowed
        totals.blocked += r.blocked
        totals.monitored += r.monitored
        totals.kicked += r.kicked
        totals.banned += r.banned
        totals.cancelled += r.cancelled
      }

      const byRule = ctx.db.all<{ rule: string; blocked: number; monitored: number }>(
        `SELECT rule, SUM(blocked) AS blocked, SUM(monitored) AS monitored
           FROM stats_rule_minute WHERE server_id = ? AND bucket >= ?
          GROUP BY rule ORDER BY SUM(blocked) + SUM(monitored) DESC LIMIT 20`,
        id,
        start,
      )

      return { range, from: start, to: now, step, buckets, totals, byRule }
    })

    app.get('/:id/events', async (req) => {
      const { id } = parse(idParams, req.params)
      getServerFor(ctx, req, id)
      const q = parse(
        z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          before: z.coerce.number().int().min(1).optional(),
          severity: z.enum(['info', 'warn', 'critical']).optional(),
          type: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).optional(),
          rule: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/).optional(),
        }),
        req.query,
      )

      const where = ['server_id = ?']
      const params: Param[] = [id]
      if (q.before) {
        where.push('id < ?')
        params.push(q.before)
      }
      if (q.severity) {
        where.push('severity = ?')
        params.push(q.severity)
      }
      if (q.type) {
        where.push('type = ?')
        params.push(q.type)
      }
      if (q.rule) {
        where.push('rule = ?')
        params.push(q.rule)
      }

      const rows = ctx.db.all<EventRow>(
        `SELECT id, ts, type, rule, severity, action, ip, identifier, player_name, detail, count
           FROM events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
        ...params,
        q.limit + 1,
      )
      const hasMore = rows.length > q.limit
      const page = hasMore ? rows.slice(0, q.limit) : rows

      return {
        items: page.map((r) => ({
          id: r.id,
          ts: r.ts,
          type: r.type,
          rule: r.rule,
          severity: r.severity,
          action: r.action,
          ip: r.ip,
          identifier: r.identifier,
          name: r.player_name,
          detail: r.detail,
          count: r.count,
        })),
        nextBefore: hasMore ? page[page.length - 1]!.id : null,
      }
    })
  }
