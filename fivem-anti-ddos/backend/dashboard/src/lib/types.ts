// Shapes returned by the backend (see backend/src/routes/*). Kept in one place so the UI stays type-safe.

export interface User {
  id: string
  email: string
  role: 'admin' | 'user'
}

export interface UserRow extends User {
  createdAt: number
  lastLoginAt: number | null
  serverCount: number
}

export type FieldValue = number | boolean | string

export interface IntField {
  type: 'int'
  key: string
  label: string
  help?: string
  unit?: string
  min: number
  max: number
  default: number
}
export interface BoolField {
  type: 'bool'
  key: string
  label: string
  help?: string
  default: boolean
}
export interface SelectField {
  type: 'select'
  key: string
  label: string
  help?: string
  options: { value: string; label: string }[]
  default: string
}
export interface TextField {
  type: 'text'
  key: string
  label: string
  help?: string
  maxLength: number
  default: string
}
export type Field = IntField | BoolField | SelectField | TextField

export interface ModeDef {
  value: string
  label: string
  description: string
}

export interface ProtectionDef {
  id: string
  group: 'connections' | 'ingame'
  title: string
  summary: string
  requiresOneSync?: boolean
  caveat?: string
  modes: ModeDef[]
  defaultMode: string
  fields: Field[]
}

export interface Config {
  v: number
  general: Record<string, FieldValue>
  protections: Record<string, Record<string, FieldValue>>
  messages: Record<string, string>
}

export interface Catalog {
  version: number
  general: Field[]
  messages: TextField[]
  protections: ProtectionDef[]
  presets: { id: string; name: string; description: string; config: Config }[]
  defaults: Config
}

export interface Summary24h {
  attempts: number
  blocked: number
  monitored: number
  cancelled: number
  kicked: number
  banned: number
}

export interface ServerStatus {
  online: boolean
  lastSeenAt: number | null
  lastIp: string | null
  resourceVersion: string | null
  serverName: string | null
  players: number | null
  maxPlayers: number | null
  tickMs: number | null
  onesync: string | null
  build: string | null
  endpointPrivacy: boolean | null
  attack: { active: boolean; since: number | null }
}

export interface Server {
  id: string
  name: string
  enabled: boolean
  createdAt: number
  keyPrefix: string
  ownerId: string
  ownerEmail: string | null
  status: ServerStatus
  configRev: number
  appliedConfigRev: number
  listsRev: number
  appliedListsRev: number
  summary24h: Summary24h
  config?: Config
}

export interface StatsBucket {
  t: number
  attempts: number
  allowed: number
  blocked: number
  monitored: number
  kicked: number
  banned: number
  cancelled: number
}

export interface Stats {
  range: StatsRange
  from: number
  to: number
  step: number
  buckets: StatsBucket[]
  totals: Omit<StatsBucket, 't'>
  byRule: { rule: string; blocked: number; monitored: number }[]
}

export type StatsRange = '1h' | '6h' | '24h' | '7d'

export interface EventItem {
  id: number
  ts: number
  type: string
  rule: string | null
  severity: 'info' | 'warn' | 'critical'
  action: 'logged' | 'blocked' | 'cancelled' | 'kicked' | 'banned'
  ip: string | null
  identifier: string | null
  name: string | null
  detail: string | null
  count: number
}

export interface EventsPage {
  items: EventItem[]
  nextBefore: number | null
}

export interface ListEntry {
  id: string
  list: 'block' | 'allow'
  kind: 'ip' | 'cidr' | 'identifier'
  value: string
  reason: string | null
  createdAt: number
  expiresAt: number | null
}

export interface AddListResult {
  added: number
  skipped: { value: string; error: string }[]
}
