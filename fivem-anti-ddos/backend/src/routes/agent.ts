/**
 * Agent API – spoken by the FiveM resource, authenticated with the server's API key.
 * Protocol description: docs/agent-protocol.md
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppContext, ServerRow } from '../context.js'
import { HttpError } from '../errors.js'
import { FixedWindowLimiter } from '../limiter.js'
import { sha256Hex } from '../security.js'
import { storedConfig } from '../serverAccess.js'
import { cleanIdentifier, cleanIp, cleanText } from '../validate.js'

export const PROTOCOL_VERSION = 1
const MAX_EVENTS_PER_SYNC = 200

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the onRequest hook of the agent routes once the API key was verified. */
    agentServer: ServerRow | null
  }
}

const RULE_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/
const TYPE_RE = /^[a-z][a-z0-9_]{0,31}$/

/** Clamp instead of reject: a slightly odd number from a game server must not fail the whole sync. */
const num = (min: number, max: number) =>
  z
    .number()
    .finite()
    .transform((n) => Math.min(max, Math.max(min, Math.trunc(n))))

/** FiveM's json.encode turns empty Lua tables into `[]` – accept that wherever an object is expected. */
const emptyArrayToObject = (v: unknown): unknown => (Array.isArray(v) && v.length === 0 ? {} : v)

const rootSchema = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  resource: z.object({
    version: z.string().max(32).default('unknown'),
    session: z.string().min(4).max(64),
    seq: num(0, 2_147_483_647),
  }),
  state: z.object({
    configRev: num(0, 2_147_483_647).default(0),
    listsRev: num(0, 2_147_483_647).default(0),
    attack: z.boolean().default(false),
  }),
  server: z.unknown().optional(),
  stats: z.unknown().optional(),
  events: z.array(z.unknown()).max(500).optional(),
})

const serverInfoSchema = z.object({
  name: z.string().max(300).optional(),
  players: num(0, 100_000).optional(),
  maxPlayers: num(0, 100_000).optional(),
  tickMs: z.number().finite().min(0).max(1_000_000).optional(),
  onesync: z.string().max(32).optional(),
  build: z.string().max(300).optional(),
  endpointPrivacy: z.boolean().optional(),
})

const ruleCountsSchema = z.object({ blocked: num(0, 1e9).default(0), monitored: num(0, 1e9).default(0) })

const statsSchema = z.object({
  attempts: num(0, 1e9).default(0),
  allowed: num(0, 1e9).default(0),
  blocked: num(0, 1e9).default(0),
  monitored: num(0, 1e9).default(0),
  kicked: num(0, 1e9).default(0),
  banned: num(0, 1e9).default(0),
  cancelled: num(0, 1e9).default(0),
  byRule: z.unknown().optional(),
})

const eventSchema = z.object({
  ts: z.number().finite().optional(),
  type: z.string().regex(TYPE_RE),
  rule: z.string().regex(RULE_RE).optional(),
  severity: z.enum(['info', 'warn', 'critical']).catch('info'),
  action: z.enum(['logged', 'blocked', 'cancelled', 'kicked', 'banned']).catch('logged'),
  ip: z.string().max(64).optional(),
  identifier: z.string().max(140).optional(),
  name: z.string().max(300).optional(),
  detail: z.string().max(2000).optional(),
  count: num(1, 1_000_000).optional(),
})

function bearerKey(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null
  const key = h.slice(7).trim()
  return key.length > 0 && key.length <= 200 ? key : null
}

export const agentRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    const keyLimiter = new FixedWindowLimiter()
    const failLimiter = new FixedWindowLimiter()

    /** Resolve the API key to its server row; counts failures per IP so keys cannot be guessed. */
    function authenticate(req: FastifyRequest): ServerRow {
      const key = bearerKey(req)
      const row = key ? ctx.db.get<ServerRow>('SELECT * FROM servers WHERE key_hash = ?', sha256Hex(key)) : undefined
      if (!row) {
        if (!failLimiter.allow(req.ip, ctx.now(), 30, 60)) throw new HttpError(429, 'rate_limited', 'Too many failed attempts.')
        throw new HttpError(401, 'invalid_key', 'Unknown or revoked API key.')
      }
      if (row.enabled !== 1) throw new HttpError(403, 'server_disabled', 'This server is disabled in the dashboard.')
      return row
    }

    // Authenticate BEFORE the body is read and parsed: requests with a bad key are rejected cheaply, so junk
    // bodies cannot be used to burn CPU on the backend.
    app.decorateRequest('agentServer', null)
    app.addHook('onRequest', async (req) => {
      req.agentServer = authenticate(req)
    })

    // Lightweight credential check (handy with curl when setting up).
    app.get('/whoami', async (req) => {
      const server = req.agentServer!
      return { ok: true, protocol: PROTOCOL_VERSION, serverId: server.id, name: server.name }
    })

    app.post('/sync', { bodyLimit: 512 * 1024 }, async (req, reply) => {
      const server = req.agentServer!
      if (!keyLimiter.allow(server.id, ctx.now(), ctx.config.agentRateLimitPerMin, 60)) {
        reply.header('retry-after', '30')
        throw new HttpError(429, 'rate_limited', 'Syncing too often. Increase the sync interval.')
      }

      const parsed = rootSchema.safeParse(req.body)
      if (!parsed.success) {
        const first = parsed.error.issues[0]
        const msg = first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'invalid payload'
        // an old/unknown protocol deserves a clear answer
        const protocolIssue = (req.body as { protocol?: unknown } | null)?.protocol !== PROTOCOL_VERSION
        throw new HttpError(protocolIssue ? 426 : 400, protocolIssue ? 'unsupported_protocol' : 'invalid_payload', msg)
      }
      const body = parsed.data
      const now = ctx.now()

      const info = serverInfoSchema.safeParse(emptyArrayToObject(body.server ?? {}))
      const serverInfo = info.success ? info.data : {}
      const st = statsSchema.safeParse(emptyArrayToObject(body.stats ?? {}))
      const stats = st.success ? st.data : statsSchema.parse({})

      // A batch is new unless this exact (session, seq) was already processed (retry after a lost response).
      const seq = body.resource.seq
      const fresh = seq > 0 && !(body.resource.session === server.last_session && seq <= server.last_seq)

      ctx.db.tx(() => {
        const attackSince = body.state.attack ? (server.attack_active === 1 ? (server.attack_since ?? now) : now) : null
        ctx.db.run(
          `UPDATE servers SET
             last_seen_at = ?, last_ip = ?, resource_version = ?,
             server_name = COALESCE(?, server_name), players = COALESCE(?, players), max_players = COALESCE(?, max_players),
             tick_ms = COALESCE(?, tick_ms), onesync = COALESCE(?, onesync), build = COALESCE(?, build),
             endpoint_privacy = COALESCE(?, endpoint_privacy),
             attack_active = ?, attack_since = ?, applied_config_rev = ?, applied_lists_rev = ?
           WHERE id = ?`,
          now,
          req.ip,
          cleanText(body.resource.version, 32),
          serverInfo.name !== undefined ? cleanText(serverInfo.name, 120) : null,
          serverInfo.players ?? null,
          serverInfo.maxPlayers ?? null,
          serverInfo.tickMs ?? null,
          serverInfo.onesync !== undefined ? cleanText(serverInfo.onesync, 16) : null,
          serverInfo.build !== undefined ? cleanText(serverInfo.build, 120) : null,
          serverInfo.endpointPrivacy === undefined ? null : serverInfo.endpointPrivacy ? 1 : 0,
          body.state.attack ? 1 : 0,
          attackSince,
          body.state.configRev,
          body.state.listsRev,
          server.id,
        )

        if (!fresh) return
        ctx.db.run('UPDATE servers SET last_session = ?, last_seq = ? WHERE id = ?', body.resource.session, seq, server.id)
        ingestStats(ctx, server.id, now, stats)
        ingestEvents(ctx, server.id, now, body.events ?? [])
      })

      const config = storedConfig(server)
      const response: Record<string, unknown> = {
        ok: true,
        protocol: PROTOCOL_VERSION,
        serverTime: now,
        pollIntervalSec: config.general.pollIntervalSec,
        ackSeq: seq,
        configRev: server.config_rev,
        listsRev: server.lists_rev,
      }
      if (body.state.configRev !== server.config_rev) response.config = config
      if (body.state.listsRev !== server.lists_rev) response.lists = buildLists(ctx, server.id, now)
      return response
    })
  }

function ingestStats(ctx: AppContext, serverId: string, now: number, stats: z.output<typeof statsSchema>): void {
  const bucket = Math.floor(now / 60) * 60
  const { attempts, allowed, blocked, monitored, kicked, banned, cancelled } = stats
  if (attempts + allowed + blocked + monitored + kicked + banned + cancelled > 0) {
    ctx.db.run(
      `INSERT INTO stats_minute (server_id, bucket, attempts, allowed, blocked, monitored, kicked, banned, cancelled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, bucket) DO UPDATE SET
         attempts = attempts + excluded.attempts, allowed = allowed + excluded.allowed,
         blocked = blocked + excluded.blocked, monitored = monitored + excluded.monitored,
         kicked = kicked + excluded.kicked, banned = banned + excluded.banned, cancelled = cancelled + excluded.cancelled`,
      serverId,
      bucket,
      attempts,
      allowed,
      blocked,
      monitored,
      kicked,
      banned,
      cancelled,
    )
  }

  const rawRules = emptyArrayToObject(stats.byRule ?? {})
  if (typeof rawRules !== 'object' || rawRules === null) return
  let n = 0
  for (const [rule, value] of Object.entries(rawRules as Record<string, unknown>)) {
    if (n++ >= 32 || !RULE_RE.test(rule)) continue
    const counts = ruleCountsSchema.safeParse(value)
    if (!counts.success || counts.data.blocked + counts.data.monitored === 0) continue
    ctx.db.run(
      `INSERT INTO stats_rule_minute (server_id, bucket, rule, blocked, monitored) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(server_id, bucket, rule) DO UPDATE SET
         blocked = blocked + excluded.blocked, monitored = monitored + excluded.monitored`,
      serverId,
      bucket,
      rule,
      counts.data.blocked,
      counts.data.monitored,
    )
  }
}

function ingestEvents(ctx: AppContext, serverId: string, now: number, events: unknown[]): void {
  let stored = 0
  for (const raw of events) {
    if (stored >= MAX_EVENTS_PER_SYNC) break
    const parsed = eventSchema.safeParse(raw)
    if (!parsed.success) continue
    const e = parsed.data
    // trust the game server's clock only within a sane window
    const ts = Math.min(now, Math.max(now - 86400, Math.trunc(e.ts ?? now)))
    ctx.db.run(
      `INSERT INTO events (server_id, ts, type, rule, severity, action, ip, identifier, player_name, detail, count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      serverId,
      ts,
      e.type,
      e.rule ?? null,
      e.severity,
      e.action,
      cleanIp(e.ip),
      cleanIdentifier(e.identifier),
      e.name ? cleanText(e.name, 64) : null,
      e.detail ? cleanText(e.detail, 300) : null,
      e.count ?? 1,
    )
    stored++
  }
}

interface EntryRow {
  list: 'block' | 'allow'
  kind: string
  value: string
  reason: string | null
  expires_at: number | null
}

/** Full snapshot of both lists. `ttl` is "seconds left" so the game server's clock never matters. */
function buildLists(ctx: AppContext, serverId: string, now: number) {
  const rows = ctx.db.all<EntryRow>(
    `SELECT list, kind, value, reason, expires_at FROM list_entries
      WHERE server_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
    serverId,
    now,
  )
  const map = (list: 'block' | 'allow') =>
    rows
      .filter((r) => r.list === list)
      .map((r) => ({
        kind: r.kind,
        value: r.value,
        ...(r.reason ? { reason: r.reason } : {}),
        ttl: r.expires_at === null ? null : r.expires_at - now,
      }))
  return { block: map('block'), allow: map('allow') }
}
