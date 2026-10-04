import type { FastifyRequest } from 'fastify'
import { requireUser } from './auth.js'
import { normalizeConfig, type Config } from './catalog.js'
import type { AppContext, ServerRow } from './context.js'
import { notFound } from './errors.js'
import { safeJson } from './http.js'

/** Load a server the signed-in user may access (admins: all, users: own). 404 otherwise – never leaks existence. */
export function getServerFor(ctx: AppContext, req: FastifyRequest, id: string): ServerRow {
  const user = requireUser(req)
  const row = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', id)
  if (!row || (user.role !== 'admin' && row.owner_id !== user.id)) throw notFound('server')
  return row
}

export function storedConfig(row: Pick<ServerRow, 'config_json'>): Config {
  return normalizeConfig(safeJson(row.config_json))
}

export interface ServerSummary {
  attempts: number
  blocked: number
  monitored: number
  cancelled: number
  kicked: number
  banned: number
}

export const EMPTY_SUMMARY: ServerSummary = { attempts: 0, blocked: 0, monitored: 0, cancelled: 0, kicked: 0, banned: 0 }

/** A server counts as online while it keeps syncing (3x the poll interval, at least 30 s). */
export function isOnline(ctx: AppContext, row: ServerRow, config: Config): boolean {
  if (row.last_seen_at === null) return false
  const poll = Number(config.general.pollIntervalSec ?? 10)
  return ctx.now() - row.last_seen_at <= Math.max(30, poll * 3)
}

export function serializeServer(
  ctx: AppContext,
  row: ServerRow,
  opts: { ownerEmail?: string | null; summary?: ServerSummary; includeConfig?: boolean } = {},
) {
  const config = storedConfig(row)
  const online = isOnline(ctx, row, config)
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    keyPrefix: row.key_prefix,
    ownerId: row.owner_id,
    ownerEmail: opts.ownerEmail ?? null,
    status: {
      online,
      lastSeenAt: row.last_seen_at,
      lastIp: row.last_ip,
      resourceVersion: row.resource_version,
      serverName: row.server_name,
      players: row.players,
      maxPlayers: row.max_players,
      tickMs: row.tick_ms,
      onesync: row.onesync,
      build: row.build,
      endpointPrivacy: row.endpoint_privacy === null ? null : row.endpoint_privacy === 1,
      attack: { active: online && row.attack_active === 1, since: row.attack_active === 1 ? row.attack_since : null },
    },
    configRev: row.config_rev,
    appliedConfigRev: row.applied_config_rev,
    listsRev: row.lists_rev,
    appliedListsRev: row.applied_lists_rev,
    summary24h: opts.summary ?? EMPTY_SUMMARY,
    ...(opts.includeConfig ? { config } : {}),
  }
}
