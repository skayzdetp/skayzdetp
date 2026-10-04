import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth.js'
import { defaultConfig, mergeConfig, normalizeConfig, type Config } from '../catalog.js'
import type { AppContext, ServerRow } from '../context.js'
import { HttpError } from '../errors.js'
import { parse, serverNameSchema } from '../http.js'
import { apiKeyPrefix, generateApiKey, newId, sha256Hex } from '../security.js'
import {
  EMPTY_SUMMARY,
  getServerFor,
  serializeServer,
  storedConfig,
  type ServerSummary,
} from '../serverAccess.js'

const MAX_SERVERS_PER_USER = 25

type ServerWithOwner = ServerRow & { owner_email: string }

const idParams = z.object({ id: z.string().min(1).max(100) })

export const serverRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    function saveConfig(row: ServerRow, next: Config) {
      const changed = JSON.stringify(next) !== JSON.stringify(storedConfig(row))
      if (changed) {
        ctx.db.run('UPDATE servers SET config_json = ?, config_rev = config_rev + 1 WHERE id = ?', JSON.stringify(next), row.id)
      }
      return { config: next, configRev: changed ? row.config_rev + 1 : row.config_rev, changed }
    }

    app.get('/', async (req) => {
      const user = requireUser(req)
      const rows =
        user.role === 'admin'
          ? ctx.db.all<ServerWithOwner>(
              'SELECT s.*, u.email AS owner_email FROM servers s JOIN users u ON u.id = s.owner_id ORDER BY s.created_at DESC',
            )
          : ctx.db.all<ServerWithOwner>(
              'SELECT s.*, u.email AS owner_email FROM servers s JOIN users u ON u.id = s.owner_id WHERE s.owner_id = ? ORDER BY s.created_at DESC',
              user.id,
            )

      const since = ctx.now() - 86400
      const sums = new Map<string, ServerSummary>()
      for (const r of ctx.db.all<ServerSummary & { server_id: string }>(
        `SELECT server_id, SUM(attempts) AS attempts, SUM(blocked) AS blocked, SUM(monitored) AS monitored,
                SUM(cancelled) AS cancelled, SUM(kicked) AS kicked, SUM(banned) AS banned
           FROM stats_minute WHERE bucket >= ? GROUP BY server_id`,
        since,
      )) {
        sums.set(r.server_id, r)
      }

      return {
        items: rows.map((row) => serializeServer(ctx, row, { ownerEmail: row.owner_email, summary: sums.get(row.id) ?? EMPTY_SUMMARY })),
      }
    })

    app.post('/', async (req, reply) => {
      const user = requireUser(req)
      const body = parse(z.object({ name: serverNameSchema }), req.body)

      if (user.role !== 'admin') {
        const n = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM servers WHERE owner_id = ?', user.id)!.n
        if (n >= MAX_SERVERS_PER_USER) {
          throw new HttpError(403, 'server_limit', `You can create at most ${MAX_SERVERS_PER_USER} servers.`)
        }
      }

      const apiKey = generateApiKey()
      const id = newId('srv')
      ctx.db.run(
        'INSERT INTO servers (id, owner_id, name, key_hash, key_prefix, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id,
        user.id,
        body.name,
        sha256Hex(apiKey),
        apiKeyPrefix(apiKey),
        JSON.stringify(defaultConfig()),
        ctx.now(),
      )
      const row = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', id)!
      reply.code(201)
      // The plain API key is returned exactly once – only its hash is stored.
      return { server: serializeServer(ctx, row, { ownerEmail: user.email, includeConfig: true }), apiKey }
    })

    app.get('/:id', async (req) => {
      const { id } = parse(idParams, req.params)
      const row = getServerFor(ctx, req, id)
      const owner = ctx.db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', row.owner_id)
      return { server: serializeServer(ctx, row, { ownerEmail: owner?.email ?? null, includeConfig: true }) }
    })

    app.patch('/:id', async (req) => {
      const { id } = parse(idParams, req.params)
      const row = getServerFor(ctx, req, id)
      const body = parse(z.object({ name: serverNameSchema.optional(), enabled: z.boolean().optional() }), req.body)
      if (body.name !== undefined) ctx.db.run('UPDATE servers SET name = ? WHERE id = ?', body.name, id)
      if (body.enabled !== undefined) ctx.db.run('UPDATE servers SET enabled = ? WHERE id = ?', body.enabled ? 1 : 0, id)
      const next = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', row.id)!
      return { server: serializeServer(ctx, next, { includeConfig: true }) }
    })

    app.delete('/:id', async (req) => {
      const { id } = parse(idParams, req.params)
      getServerFor(ctx, req, id)
      ctx.db.run('DELETE FROM servers WHERE id = ?', id) // cascades to lists, events and statistics
      return { ok: true }
    })

    // Replace the API key. The old key stops working immediately.
    app.post('/:id/rotate-key', async (req) => {
      const { id } = parse(idParams, req.params)
      getServerFor(ctx, req, id)
      const apiKey = generateApiKey()
      ctx.db.run('UPDATE servers SET key_hash = ?, key_prefix = ? WHERE id = ?', sha256Hex(apiKey), apiKeyPrefix(apiKey), id)
      return { apiKey, keyPrefix: apiKeyPrefix(apiKey) }
    })

    // Save the full configuration (what the "Protections" page does).
    app.put('/:id/config', async (req) => {
      const { id } = parse(idParams, req.params)
      const row = getServerFor(ctx, req, id)
      const body = parse(z.object({ config: z.record(z.string(), z.unknown()) }), req.body)
      return saveConfig(row, normalizeConfig(body.config))
    })

    // Merge a partial change (used by quick actions such as the attack-mode panic switch).
    app.patch('/:id/config', async (req) => {
      const { id } = parse(idParams, req.params)
      const row = getServerFor(ctx, req, id)
      const body = parse(z.object({ patch: z.record(z.string(), z.unknown()) }), req.body)
      return saveConfig(row, mergeConfig(storedConfig(row), body.patch))
    })
  }
