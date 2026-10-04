/**
 * End-to-end: the REAL Lua resource (run by Lua 5.4 against a mocked FiveM runtime) talks to the REAL backend
 * over HTTP. Dashboard actions are performed through the same HTTP API the browser uses.
 * Skipped automatically when no Lua 5.4 interpreter is installed.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { Db, migrate } from '../src/db.js'
import { normalizeConfig } from '../src/catalog.js'
import { Client, createServer, ADMIN } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const driver = path.resolve(here, '../../resource/tests/e2e_server.lua')

function findLua(): string | null {
  for (const bin of ['lua5.4', 'lua54', 'lua']) {
    const r = spawnSync(bin, ['-v'], { encoding: 'utf8' })
    if (r.status === 0 && /Lua 5\.4/.test(`${r.stdout}${r.stderr}`)) return bin
  }
  return null
}
const lua = findLua()

/** JSON-lines RPC to the Lua driver process. */
class LuaResource {
  private readonly child: ChildProcessWithoutNullStreams
  private buffer = ''
  private readonly waiting: ((line: string) => void)[] = []
  private stderr = ''

  constructor(bin: string, env: Record<string, string>) {
    this.child = spawn(bin, [driver], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], cwd: path.resolve(here, '../..') })
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      let i: number
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i)
        this.buffer = this.buffer.slice(i + 1)
        this.waiting.shift()?.(line)
      }
    })
    this.child.stderr.on('data', (c: Buffer) => (this.stderr += c.toString()))
  }

  async call<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    const line = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Lua driver timed out on "${op}". stderr: ${this.stderr}`)), 25_000)
      this.waiting.push((l) => {
        clearTimeout(timer)
        resolve(l)
      })
    })
    this.child.stdin.write(`${JSON.stringify({ op, ...args })}\n`)
    const reply = JSON.parse(await line) as { ok: boolean; result?: T; error?: string }
    if (!reply.ok) throw new Error(`Lua driver error in "${op}": ${reply.error}`)
    return reply.result as T
  }

  close(): void {
    this.child.stdin.end()
    this.child.kill()
  }
}

describe.skipIf(!lua)('FiveM resource ⇄ backend (end to end, real HTTP)', () => {
  let app: FastifyInstance
  let db: Db
  let port = 0
  let admin: Client
  let serverId = ''
  let apiKey = ''
  let res: LuaResource

  const config = loadConfig({
    SCRYPT_N: '1024',
    LOG_LEVEL: 'silent',
    DASHBOARD_DIR: '/nonexistent-dashboard',
    SETUP_TOKEN: 'e2e-setup-token-123456',
  })

  beforeAll(async () => {
    db = new Db(':memory:')
    migrate(db)
    app = (await buildApp({ config, db, logger: false })).app
    await app.listen({ host: '127.0.0.1', port: 0 })
    port = (app.server.address() as { port: number }).port

    // dashboard side: create the admin and a server through the real HTTP handlers
    admin = new Client(app)
    const setup = await admin.post('/api/auth/setup', { setupToken: 'e2e-setup-token-123456', ...ADMIN })
    expect(setup.status).toBe(200)
    const created = await createServer(admin, 'E2E')
    serverId = created.id
    apiKey = created.apiKey

    res = new LuaResource(lua!, {
      FXS_URL: `http://127.0.0.1:${port}`,
      FXS_KEY: apiKey,
      FXS_EPOCH: String(Math.floor(Date.now() / 1000)),
    })
  })

  afterAll(async () => {
    res?.close()
    await app?.close()
    db?.close()
  })

  const server = async () => (await admin.get(`/api/servers/${serverId}`)).body.server

  it('connects with the API key and receives the default configuration', async () => {
    await res.call('advance', { ms: 5000 }) // first sync + the quick confirmation sync that follows
    const state = await res.call('state')
    expect(state.connected).toBe(true)
    expect(state.configRev).toBe(1)

    const s = await server()
    expect(s.status.online).toBe(true)
    expect(s.status.resourceVersion).toBe('1.0.0')
    expect(s.status.serverName).toBe('E2E Server')
    expect(s.status.maxPlayers).toBe(48)
    expect(s.status.onesync).toBe('on')
    expect(s.appliedConfigRev).toBe(1)
  })

  it('the resource normalises the config exactly like the backend (schema parity)', async () => {
    const state = await res.call('state')
    const backend = (await server()).config
    expect(state.config).toEqual(backend)
    expect(normalizeConfig(state.config)).toEqual(state.config)
  })

  it('a dashboard change reaches the running server within one sync interval and takes effect', async () => {
    const before = await res.call('enter', { src: 1, ip: '203.0.113.50', license: 'aaa', name: 'Alice' })
    expect(before.rejected).toBe(false)

    const put = await admin.patch(`/api/servers/${serverId}/config`, {
      patch: { protections: { connectionFlood: { maxAttemptsPerIp: 2, banSec: 0 } } },
    })
    expect(put.body.configRev).toBe(2)
    expect((await server()).appliedConfigRev).toBe(1) // not yet applied

    await res.call('advance', { ms: 12_000 })
    expect((await res.call('state')).configRev).toBe(2)
    expect((await server()).appliedConfigRev).toBe(2) // the resource confirmed it

    const results = []
    for (let i = 0; i < 4; i++) results.push((await res.call('connect', { src: 10 + i, ip: '203.0.113.60', license: `flood${i}` })).rejected)
    expect(results).toEqual([false, false, true, true])
  })

  it('the exact settings are what the dashboard saved (parity after a full-config PUT)', async () => {
    const current = (await server()).config
    current.protections.playersPerIp.mode = 'enforce'
    current.protections.playersPerIp.maxPlayers = 1
    current.messages.rateLimited = 'Bitte warte kurz – zu viele Verbindungsversuche.'
    await admin.put(`/api/servers/${serverId}/config`, { config: current })
    await res.call('advance', { ms: 12_000 })
    const state = await res.call('state')
    expect(state.config).toEqual((await server()).config)
    expect(state.config.messages.rateLimited).toBe('Bitte warte kurz – zu viele Verbindungsversuche.')

    // and the player sees that message (unicode survives the whole path)
    for (let i = 0; i < 2; i++) await res.call('connect', { src: 20 + i, ip: '203.0.113.70', license: `m${i}` })
    const blocked = await res.call('connect', { src: 30, ip: '203.0.113.70', license: 'm9' })
    expect(blocked).toEqual({ rejected: true, reason: 'Bitte warte kurz – zu viele Verbindungsversuche.' })
  })

  it('blocklist and allowlist entries from the dashboard are enforced', async () => {
    const add = await admin.post(`/api/servers/${serverId}/lists`, {
      list: 'block',
      value: '198.51.100.7\n192.0.2.0/24\nlicense:evilevilevil',
      reason: 'known botnet',
    })
    expect(add.body.added).toBe(3)
    await admin.post(`/api/servers/${serverId}/lists`, { list: 'allow', value: 'license:myself' })
    await res.call('advance', { ms: 12_000 })

    const state = await res.call('state')
    expect(state.blocked).toBe(3)
    expect(state.allowed).toBe(1)
    expect(state.listsRev).toBe((await server()).listsRev)

    expect((await res.call('connect', { src: 40, ip: '198.51.100.7', license: 'x1' })).rejected).toBe(true)
    expect((await res.call('connect', { src: 41, ip: '192.0.2.99', license: 'x2' })).rejected).toBe(true)
    expect((await res.call('connect', { src: 42, ip: '10.1.1.1', license: 'evilevilevil' })).rejected).toBe(true)
    expect((await res.call('connect', { src: 43, ip: '10.1.1.2', license: 'harmless' })).rejected).toBe(false)
    // allowlisted → bypasses everything, even a blocked range
    expect((await res.call('connect', { src: 44, ip: '192.0.2.50', license: 'myself' })).rejected).toBe(false)

    // removing an entry takes effect after the next sync
    const entry = (await admin.get(`/api/servers/${serverId}/lists`)).body.items.find((e: { value: string }) => e.value === '198.51.100.7')
    await admin.del(`/api/servers/${serverId}/lists/${entry.id}`)
    await res.call('advance', { ms: 12_000 })
    expect((await res.call('connect', { src: 45, ip: '198.51.100.7', license: 'x3' })).rejected).toBe(false)
  })

  it('statistics and events flow back and show up in the dashboard API', async () => {
    await res.call('flush')
    const stats = (await admin.get(`/api/servers/${serverId}/stats?range=1h`)).body
    // every connection attempt of the tests above, counted exactly once:
    //   flood test 5 (1 enter + 4 connect), settings test 3, list test 6  = 14 attempts
    //   blocked: 2 (flood) + 1 (flood, custom message) + 3 (blocklist)     = 6
    expect(stats.totals.attempts).toBe(14)
    expect(stats.totals.blocked).toBe(6)
    const rules = Object.fromEntries(stats.byRule.map((r: { rule: string }) => [r.rule, r]))
    expect(rules.connectionFlood.blocked).toBeGreaterThan(0)
    expect(rules.blocklist.blocked).toBeGreaterThan(0)

    const events = (await admin.get(`/api/servers/${serverId}/events?limit=100`)).body.items as any[]
    const flood = events.find((e) => e.type === 'connection_blocked' && e.rule === 'connectionFlood' && e.ip === '203.0.113.60')
    expect(flood).toBeTruthy()
    expect(flood.ip).toBe('203.0.113.60')
    expect(flood.action).toBe('blocked')
    expect(events.some((e) => e.type === 'resource_started')).toBe(true)
  })

  it('attack mode: the panic switch in the dashboard is mirrored back', async () => {
    expect((await server()).status.attack.active).toBe(false)
    await admin.patch(`/api/servers/${serverId}/config`, { patch: { protections: { attackMode: { mode: 'on', newPlayers: 'block' } } } })
    await res.call('advance', { ms: 14_000 })
    expect((await res.call('state')).attack).toBe(true)
    await res.call('flush')
    expect((await server()).status.attack.active).toBe(true)

    const stranger = await res.call('connect', { src: 60, ip: '10.9.9.9', license: 'stranger' })
    expect(stranger.rejected).toBe(true)
    // returning players (joined earlier in this test run) still get in
    expect((await res.call('connect', { src: 61, ip: '203.0.113.51', license: 'aaa' })).rejected).toBe(false)

    await admin.patch(`/api/servers/${serverId}/config`, { patch: { protections: { attackMode: { mode: 'auto' } } } })
    await res.call('advance', { ms: 14_000 })
    await res.call('flush')
    expect((await server()).status.attack.active).toBe(false)
  })

  it('in-game guard: explosion spam is cancelled and reported', async () => {
    await res.call('enter', { src: 70, ip: '203.0.113.80', license: 'cheater', name: 'Cheater' })
    let cancelled = 0
    for (let i = 0; i < 20; i++) {
      const r = await res.call('fire', { event: 'explosionEvent', src: 70, args: [70, {}] })
      if (r.cancelled) cancelled++
    }
    expect(cancelled).toBe(5) // limit 15 → the 16th..20th are cancelled
    await res.call('flush')
    const events = (await admin.get(`/api/servers/${serverId}/events?type=event_flood`)).body.items as any[]
    expect(events[0]).toMatchObject({ rule: 'gameEventFlood', action: 'cancelled', identifier: 'license:cheater' })
  })

  it('an invalid key stops syncing but never the protection; a wrong key is reported clearly', async () => {
    await admin.post(`/api/servers/${serverId}/rotate-key`) // the running resource still has the old key
    await res.call('advance', { ms: 12_000 })
    const state = await res.call('state')
    expect(state.connected).toBe(false)
    expect(state.lastError).toMatch(/API key/)
    // still enforcing the last known config
    expect((await res.call('connect', { src: 80, ip: '192.0.2.5', license: 'z' })).rejected).toBe(true)
    expect((await res.call('log')) as string).toContain('rejected the API key')
  })
})

describe.skipIf(!lua)('FiveM resource ⇄ backend: backend outage and recovery', () => {
  it('keeps protecting during an outage, retries the same batch and the backend counts it exactly once', async () => {
    const db = new Db(':memory:')
    migrate(db)
    const cfg = loadConfig({ SCRYPT_N: '1024', LOG_LEVEL: 'silent', DASHBOARD_DIR: '/nonexistent-dashboard', SETUP_TOKEN: 'outage-setup-token-123456' })

    let built = await buildApp({ config: cfg, db, logger: false })
    await built.app.listen({ host: '127.0.0.1', port: 0 })
    const port = (built.app.server.address() as { port: number }).port
    const admin = new Client(built.app)
    await admin.post('/api/auth/setup', { setupToken: 'outage-setup-token-123456', ...ADMIN })
    const { id, apiKey } = await createServer(admin, 'Outage')

    const res = new LuaResource(lua!, { FXS_URL: `http://127.0.0.1:${port}`, FXS_KEY: apiKey, FXS_EPOCH: String(Math.floor(Date.now() / 1000)) })
    try {
      await res.call('advance', { ms: 3000 })
      expect((await res.call('state')).connected).toBe(true)

      // 3 connection attempts happen; they are reported with the next sync
      for (let i = 0; i < 3; i++) await res.call('connect', { src: i + 1, ip: `198.51.100.${i + 1}`, license: `o${i}` })

      // the backend goes down before the resource can report them
      await built.app.close()
      await res.call('advance', { ms: 12_000 })
      const down = await res.call('state')
      expect(down.connected).toBe(false)
      expect(down.inflightSeq).toBeGreaterThan(0) // the batch is kept for the retry
      // protection continues: the flood guard still rejects
      for (let i = 0; i < 10; i++) await res.call('connect', { src: 100 + i, ip: '203.0.113.9', license: `d${i}` })
      expect((await res.call('connect', { src: 120, ip: '203.0.113.9', license: 'd9' })).rejected).toBe(true)

      // the backend comes back on the same port with the same database
      built = await buildApp({ config: cfg, db, logger: false })
      await built.app.listen({ host: '127.0.0.1', port })
      // exponential backoff caps at 60 s – give the resource time to retry
      await res.call('advance', { ms: 70_000 })
      expect((await res.call('state')).connected).toBe(true)

      const admin2 = new Client(built.app)
      await admin2.post('/api/auth/login', ADMIN)
      const stats = (await admin2.get(`/api/servers/${id}/stats?range=1h`)).body
      // 3 + 10 + 1 attempts happened in total – every one of them counted exactly once, none lost, none doubled
      expect(stats.totals.attempts).toBe(14)
    } finally {
      res.close()
      await built.app.close()
      db.close()
    }
  })
})
