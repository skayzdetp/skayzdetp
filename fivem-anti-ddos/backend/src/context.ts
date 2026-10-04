import type { AppConfig } from './config.js'
import type { Db } from './db.js'

export interface AppContext {
  config: AppConfig
  db: Db
  /** Current time in unix seconds (injectable for tests). */
  now: () => number
  /** One-time token for creating the first admin; null once an account exists. */
  setup: { token: string | null }
}

export interface ServerRow {
  id: string
  owner_id: string
  name: string
  key_hash: string
  key_prefix: string
  enabled: number
  config_json: string
  config_rev: number
  lists_rev: number
  created_at: number
  last_seen_at: number | null
  last_ip: string | null
  resource_version: string | null
  server_name: string | null
  players: number | null
  max_players: number | null
  tick_ms: number | null
  onesync: string | null
  build: string | null
  endpoint_privacy: number | null
  attack_active: number
  attack_since: number | null
  applied_config_rev: number
  applied_lists_rev: number
  last_session: string | null
  last_seq: number
}
