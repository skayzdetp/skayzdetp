import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations.js'

// Loaded lazily (not via a static import) so that quiet-warnings.ts can hide Node's
// "SQLite is an experimental feature" notice before the module is first touched.
const nodeRequire = createRequire(import.meta.url)

export type Param = null | number | bigint | string

/**
 * node:sqlite binds every JS number as REAL – so `bucket / ?` would be a floating-point division instead of an
 * integer one. Whole numbers are therefore bound as BigInt, which SQLite stores / compares as INTEGER.
 */
function bind(params: Param[]): (null | number | bigint | string)[] {
  return params.map((p) => (typeof p === 'number' && Number.isSafeInteger(p) ? BigInt(p) : p))
}

/**
 * Thin wrapper around Node's built-in SQLite (`node:sqlite`).
 * No native dependency, so `npm install` works the same on Windows, Linux and macOS.
 */
export class Db {
  readonly raw: DatabaseSync
  private readonly cache = new Map<string, StatementSync>()
  private inTx = false

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
    const { DatabaseSync: Database } = nodeRequire('node:sqlite') as typeof import('node:sqlite')
    this.raw = new Database(file)
    this.raw.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;',
    )
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql)
    if (!s) {
      s = this.raw.prepare(sql)
      this.cache.set(sql, s)
    }
    return s
  }

  get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql).get(...bind(params)) as T | undefined
  }

  all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...bind(params)) as T[]
  }

  run(sql: string, ...params: Param[]): { changes: number } {
    const r = this.stmt(sql).run(...bind(params))
    return { changes: Number(r.changes) }
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  /** Run `fn` inside a write transaction (re-entrant: nested calls join the outer one). */
  tx<T>(fn: () => T): T {
    if (this.inTx) return fn()
    this.raw.exec('BEGIN IMMEDIATE')
    this.inTx = true
    try {
      const result = fn()
      this.raw.exec('COMMIT')
      return result
    } catch (err) {
      this.raw.exec('ROLLBACK')
      throw err
    } finally {
      this.inTx = false
    }
  }

  close(): void {
    this.cache.clear()
    this.raw.close()
  }
}

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const done = new Set(db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version))
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue
    db.tx(() => {
      db.exec(m.sql)
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', m.version, Math.floor(Date.now() / 1000))
    })
  }
}

export function openDatabase(file: string): Db {
  const db = new Db(file)
  migrate(db)
  return db
}
