import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = path.dirname(fileURLToPath(import.meta.url))

export interface AppConfig {
  host: string
  port: number
  databasePath: string
  /** Public base URL of the backend (no trailing slash) or null. */
  publicUrl: string | null
  trustProxy: boolean
  cookieSecure: boolean
  sessionTtlSec: number
  eventRetentionDays: number
  statsRetentionDays: number
  agentRateLimitPerMin: number
  logLevel: string
  dashboardDir: string
  /** Preset one-time setup token (otherwise a random one is generated on first start). */
  setupToken: string | null
  /** scrypt cost parameter N (lowered in tests only). */
  scryptN: number
}

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return fallback
      return ['true', '1', 'yes', 'on'].includes(v.toLowerCase())
    })

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_PATH: z.string().default('./data/fxshield.db'),
  PUBLIC_URL: z.string().url().optional(),
  TRUST_PROXY: bool(false),
  COOKIE_SECURE: z.string().default('auto'),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(24 * 90).default(168),
  EVENT_RETENTION_DAYS: z.coerce.number().min(1).max(365).default(14),
  STATS_RETENTION_DAYS: z.coerce.number().min(1).max(365).default(30),
  AGENT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(6).max(6000).default(60),
  SETUP_TOKEN: z.string().min(12).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DASHBOARD_DIR: z.string().optional(),
  SCRYPT_N: z.coerce.number().int().min(1024).max(2 ** 20).default(32768),
})

/** Load a `.env` file from the current directory (existing env vars win). */
export function loadDotEnv(file = '.env'): void {
  if (existsSync(file)) process.loadEnvFile(file)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Treat empty strings (e.g. "PUBLIC_URL=") like "not set".
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v.trim() !== '') cleaned[k] = v.trim()
  }

  const parsed = envSchema.safeParse(cleaned)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
    throw new Error(`Invalid configuration (.env / environment):\n${problems}`)
  }
  const e = parsed.data

  const publicUrl = e.PUBLIC_URL ? e.PUBLIC_URL.replace(/\/+$/, '') : null
  const cookieSecure =
    e.COOKIE_SECURE === 'auto' ? Boolean(publicUrl?.startsWith('https://')) : ['true', '1', 'yes', 'on'].includes(e.COOKIE_SECURE.toLowerCase())

  return {
    host: e.HOST,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    publicUrl,
    trustProxy: e.TRUST_PROXY,
    cookieSecure,
    sessionTtlSec: Math.round(e.SESSION_TTL_HOURS * 3600),
    eventRetentionDays: e.EVENT_RETENTION_DAYS,
    statsRetentionDays: e.STATS_RETENTION_DAYS,
    agentRateLimitPerMin: e.AGENT_RATE_LIMIT_PER_MIN,
    logLevel: e.LOG_LEVEL,
    dashboardDir: e.DASHBOARD_DIR ? path.resolve(e.DASHBOARD_DIR) : path.resolve(here, '../dashboard/dist'),
    setupToken: e.SETUP_TOKEN ?? null,
    scryptN: e.SCRYPT_N,
  }
}
