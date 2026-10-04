import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentSync, createServer, makeApp, setupAdmin, syncBody, type Client, type TestApp } from './helpers.js'

let t: TestApp
let admin: Client
let id: string
let key: string
beforeEach(async () => {
  t = await makeApp()
  admin = await setupAdmin(t)
  ;({ id, apiKey: key } = await createServer(admin, 'Agent Test'))
})
afterEach(async () => {
  await t.close()
})

describe('agent authentication', () => {
  it('rejects missing, malformed and unknown keys', async () => {
    const raw = (headers: Record<string, string>) =>
      t.app.inject({ method: 'POST', url: '/api/agent/v1/sync', headers, payload: syncBody() })
    expect((await raw({})).statusCode).toBe(401)
    expect((await raw({ authorization: 'Basic abc' })).statusCode).toBe(401)
    expect((await raw({ authorization: 'Bearer fxs_doesnotexist' })).statusCode).toBe(401)
    expect((await raw({ authorization: `Bearer ${key}` })).statusCode).toBe(200)
  })

  it('rejects a bad key before the body is parsed (a junk body gives 401, not 400)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/agent/v1/sync',
      headers: { authorization: 'Bearer fxs_nope', 'content-type': 'application/json' },
      payload: '{this is not json',
    })
    expect(res.statusCode).toBe(401)
  })

  it('whoami validates the key', async () => {
    const ok = await t.app.inject({ method: 'GET', url: '/api/agent/v1/whoami', headers: { authorization: `Bearer ${key}` } })
    expect(ok.json()).toMatchObject({ ok: true, serverId: id, name: 'Agent Test' })
    expect((await t.app.inject({ method: 'GET', url: '/api/agent/v1/whoami' })).statusCode).toBe(401)
  })

  it('throttles repeated failed key attempts per IP', async () => {
    let last = 0
    for (let i = 0; i < 40; i++) {
      last = (await t.app.inject({ method: 'GET', url: '/api/agent/v1/whoami', headers: { authorization: 'Bearer fxs_bad' } })).statusCode
    }
    expect(last).toBe(429)
  })

  it('throttles syncing too often per key', async () => {
    const t2 = await makeApp({ AGENT_RATE_LIMIT_PER_MIN: '6' })
    try {
      const a = await setupAdmin(t2)
      const s = await createServer(a)
      const codes: number[] = []
      for (let i = 0; i < 8; i++) codes.push((await agentSync(t2, s.apiKey)).statusCode)
      expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true)
      expect(codes[7]).toBe(429)
    } finally {
      await t2.close()
    }
  })
})

describe('sync: status, config and lists', () => {
  it('delivers the full config on first contact and nothing when up to date', async () => {
    const first = (await agentSync(t, key)).json()
    expect(first).toMatchObject({ ok: true, protocol: 1, configRev: 1, listsRev: 1, pollIntervalSec: 10 })
    expect(first.config.protections.connectionFlood.mode).toBe('enforce')
    expect(first.lists).toEqual({ block: [], allow: [] })

    const second = (await agentSync(t, key, { configRev: 1, listsRev: 1 })).json()
    expect(second.config).toBeUndefined()
    expect(second.lists).toBeUndefined()
  })

  it('delivers dashboard changes on the next sync and records what the server has applied', async () => {
    await agentSync(t, key, { configRev: 1, listsRev: 1 })
    await admin.patch(`/api/servers/${id}/config`, { patch: { protections: { connectionFlood: { maxAttemptsPerIp: 2 } } } })

    let server = (await admin.get(`/api/servers/${id}`)).body.server
    expect(server.configRev).toBe(2)
    expect(server.appliedConfigRev).toBe(1) // pending

    const sync = (await agentSync(t, key, { configRev: 1, listsRev: 1 })).json()
    expect(sync.configRev).toBe(2)
    expect(sync.config.protections.connectionFlood.maxAttemptsPerIp).toBe(2)

    await agentSync(t, key, { configRev: 2, listsRev: 1 }) // the resource reports it applied rev 2
    server = (await admin.get(`/api/servers/${id}`)).body.server
    expect(server.appliedConfigRev).toBe(2)
  })

  it('tracks live status, online detection and attack state', async () => {
    expect((await admin.get(`/api/servers/${id}`)).body.server.status.online).toBe(false)

    await agentSync(t, key, { attack: true, server: { name: 'RP City', players: 12, maxPlayers: 48, tickMs: 7.5, onesync: 'on', build: 'FXServer 1.0', endpointPrivacy: true } })
    const s = (await admin.get(`/api/servers/${id}`)).body.server
    expect(s.status).toMatchObject({
      online: true,
      serverName: 'RP City',
      players: 12,
      maxPlayers: 48,
      tickMs: 7.5,
      onesync: 'on',
      endpointPrivacy: true,
      resourceVersion: '1.0.0',
    })
    expect(s.status.attack.active).toBe(true)
    expect(s.status.lastIp).toBeTruthy()

    t.clock.t += 120 // no sync for 2 minutes
    expect((await admin.get(`/api/servers/${id}`)).body.server.status.online).toBe(false)
  })

  it('keeps the attack start time while the attack lasts and clears it afterwards', async () => {
    await agentSync(t, key, { attack: true })
    const since = (await admin.get(`/api/servers/${id}`)).body.server.status.attack.since
    t.clock.t += 20
    await agentSync(t, key, { attack: true })
    expect((await admin.get(`/api/servers/${id}`)).body.server.status.attack.since).toBe(since)
    await agentSync(t, key, { attack: false })
    expect((await admin.get(`/api/servers/${id}`)).body.server.status.attack).toEqual({ active: false, since: null })
  })
})

describe('sync: statistics and events', () => {
  const stats = { attempts: 20, allowed: 14, blocked: 5, monitored: 1, kicked: 0, banned: 1, cancelled: 3, byRule: { connectionFlood: { blocked: 4, monitored: 0 }, blocklist: { blocked: 1, monitored: 1 } } }

  it('aggregates counters into per-minute buckets and per-rule totals', async () => {
    await agentSync(t, key, { seq: 1, stats })
    t.clock.t += 10
    await agentSync(t, key, { seq: 2, stats })

    const res = (await admin.get(`/api/servers/${id}/stats?range=1h`)).body
    expect(res.totals).toMatchObject({ attempts: 40, allowed: 28, blocked: 10, monitored: 2, banned: 2, cancelled: 6 })
    expect(res.buckets.length).toBeGreaterThan(50)
    const rules = Object.fromEntries(res.byRule.map((r: { rule: string }) => [r.rule, r]))
    expect(rules.connectionFlood).toMatchObject({ blocked: 8, monitored: 0 })
    expect(rules.blocklist).toMatchObject({ blocked: 2, monitored: 2 })

    const summary = (await admin.get('/api/servers')).body.items[0].summary24h
    expect(summary).toMatchObject({ attempts: 40, blocked: 10 })
  })

  it('aggregates correctly for every time range (integer bucketing)', async () => {
    // minute-level data spread over the last ~20 hours, at times that are NOT aligned to the coarser bucket sizes
    for (let i = 0; i < 6; i++) {
      await agentSync(t, key, { seq: i + 1, stats: { attempts: 10, allowed: 8, blocked: 2 } })
      t.clock.t += 3 * 3600 + 17 * 60 + 23
    }
    for (const range of ['1h', '6h', '24h', '7d'] as const) {
      const res = (await admin.get(`/api/servers/${id}/stats?range=${range}`)).body
      const sum = res.buckets.reduce((n: number, b: { attempts: number }) => n + b.attempts, 0)
      expect(sum, `bucket sum for ${range}`).toBe(res.totals.attempts)
      for (const b of res.buckets) expect(b.t % res.step, `bucket ${b.t} aligned to ${res.step}s for ${range}`).toBe(0)
    }
    const day = (await admin.get(`/api/servers/${id}/stats?range=24h`)).body
    expect(day.totals.attempts).toBeGreaterThan(0)
    expect((await admin.get(`/api/servers/${id}/stats?range=7d`)).body.totals.attempts).toBe(60)
    expect((await admin.get(`/api/servers/${id}/stats?range=1h`)).body.totals.attempts).toBe(0)
  })

  it('does not double count a retried batch (same session + seq) but accepts the next one', async () => {
    await agentSync(t, key, { seq: 1, stats, events: [{ type: 'attack_started' }] })
    await agentSync(t, key, { seq: 1, stats, events: [{ type: 'attack_started' }] }) // lost response → retry
    expect((await admin.get(`/api/servers/${id}/stats?range=1h`)).body.totals.attempts).toBe(20)
    expect((await admin.get(`/api/servers/${id}/events`)).body.items).toHaveLength(1)

    await agentSync(t, key, { seq: 2, stats })
    expect((await admin.get(`/api/servers/${id}/stats?range=1h`)).body.totals.attempts).toBe(40)

    // a restarted resource has a new session id and starts counting from 1 again
    await agentSync(t, key, { session: 'sess-other', seq: 1, stats })
    expect((await admin.get(`/api/servers/${id}/stats?range=1h`)).body.totals.attempts).toBe(60)
  })

  it('stores sanitised events and lists them newest first', async () => {
    await agentSync(t, key, {
      seq: 1,
      events: [
        { ts: t.clock.t - 5, type: 'connection_blocked', rule: 'connectionFlood', severity: 'warn', action: 'blocked', ip: '203.0.113.9', identifier: 'license:ABC123', name: 'Bad\u0000Name', detail: 'x'.repeat(1000), count: 42 },
        { type: 'UPPER-CASE-INVALID' }, // dropped
        { type: 'attack_started', severity: 'nonsense', action: 'weird', ip: 'not-an-ip' }, // severity/action fall back, ip dropped
        'garbage',
      ],
    })
    const items = (await admin.get(`/api/servers/${id}/events`)).body.items
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ type: 'attack_started', severity: 'info', action: 'logged', ip: null })
    expect(items[1]).toMatchObject({ type: 'connection_blocked', rule: 'connectionFlood', ip: '203.0.113.9', identifier: 'license:abc123', name: 'Bad Name', count: 42 })
    expect(items[1].detail).toHaveLength(300)
  })

  it('filters and paginates events', async () => {
    const events = Array.from({ length: 30 }, (_, i) => ({ type: i % 2 ? 'event_flood' : 'connection_blocked', severity: i % 3 === 0 ? 'critical' : 'warn', rule: 'r' }))
    await agentSync(t, key, { seq: 1, events })
    const page1 = (await admin.get(`/api/servers/${id}/events?limit=10`)).body
    expect(page1.items).toHaveLength(10)
    expect(page1.nextBefore).toBeTruthy()
    const page2 = (await admin.get(`/api/servers/${id}/events?limit=10&before=${page1.nextBefore}`)).body
    expect(page2.items[0].id).toBeLessThan(page1.items[9].id)
    const critical = (await admin.get(`/api/servers/${id}/events?severity=critical&limit=100`)).body.items
    expect(critical).toHaveLength(10)
    expect((await admin.get(`/api/servers/${id}/events?type=event_flood&limit=100`)).body.items).toHaveLength(15)
  })

  it('clamps event timestamps from a wrong game-server clock', async () => {
    await agentSync(t, key, { seq: 1, events: [{ type: 'a', ts: t.clock.t + 99999 }, { type: 'b', ts: 5 }] })
    const items = (await admin.get(`/api/servers/${id}/events`)).body.items as { ts: number }[]
    for (const e of items) expect(e.ts).toBeGreaterThanOrEqual(t.clock.t - 86400)
    for (const e of items) expect(e.ts).toBeLessThanOrEqual(t.clock.t)
  })
})

describe('sync: FiveM / Lua quirks and bad input', () => {
  it('accepts empty tables encoded as [] (json.encode of an empty Lua table)', async () => {
    const res = await agentSync(t, key, { seq: 1, stats: { attempts: 3, byRule: [] }, server: [] as unknown as object })
    expect(res.statusCode).toBe(200)
    const only = await agentSync(t, key, { seq: 2, stats: [] })
    expect(only.statusCode).toBe(200)
  })

  it('accepts floats and clamps absurd numbers', async () => {
    const res = await agentSync(t, key, { seq: 1, stats: { attempts: 5.000000001, blocked: 1e30, allowed: -4 } })
    expect(res.statusCode).toBe(200)
    const totals = (await admin.get(`/api/servers/${id}/stats?range=1h`)).body.totals
    expect(totals.attempts).toBe(5)
    expect(totals.blocked).toBe(1e9)
    expect(totals.allowed).toBe(0)
  })

  it('returns 400 for a malformed payload and 426 for an unknown protocol', async () => {
    const bad = await agentSync(t, key, {}, { protocol: 1, resource: {}, state: {} })
    expect(bad.statusCode).toBe(400)
    const old = await agentSync(t, key, {}, { ...syncBody(), protocol: 99 })
    expect(old.statusCode).toBe(426)
    expect(old.json().error).toBe('unsupported_protocol')
    const notJson = await t.app.inject({ method: 'POST', url: '/api/agent/v1/sync', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, payload: '{nope' })
    expect(notJson.statusCode).toBe(400)
  })

  it('a broken stats section does not stop config delivery', async () => {
    const res = await agentSync(t, key, {}, { ...syncBody(), stats: { attempts: 'lots', byRule: 5 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().config).toBeDefined()
  })

  it('caps stored events per sync', async () => {
    const events = Array.from({ length: 400 }, () => ({ type: 'event_flood' }))
    await agentSync(t, key, { seq: 1, events })
    expect(t.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n).toBe(200)
    // more than 500 in one request is refused outright
    const huge = await agentSync(t, key, { seq: 2, events: Array.from({ length: 501 }, () => ({ type: 'x' })) })
    expect(huge.statusCode).toBe(400)
  })
})

describe('maintenance', () => {
  it('removes expired data', async () => {
    const { runMaintenance } = await import('../src/services/maintenance.js')
    await agentSync(t, key, { seq: 1, stats: { attempts: 1 }, events: [{ type: 'x' }] })
    await admin.post(`/api/servers/${id}/lists`, { list: 'block', value: '1.1.1.1', ttlSec: 60 })
    t.clock.t += 40 * 86400
    runMaintenance(t.ctx)
    for (const table of ['events', 'stats_minute', 'list_entries', 'sessions']) {
      expect(t.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n).toBe(0)
    }
  })
})
