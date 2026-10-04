import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentSync, createServer, makeApp, setupAdmin, type Client, type TestApp } from './helpers.js'

let t: TestApp
let admin: Client
beforeEach(async () => {
  t = await makeApp()
  admin = await setupAdmin(t)
})
afterEach(async () => {
  await t.close()
})

describe('servers & API keys', () => {
  it('creates a server and returns the API key exactly once', async () => {
    const { id, apiKey, server } = await createServer(admin, 'My RP Server')
    expect(apiKey).toMatch(/^fxs_[\w-]{43}$/)
    expect(server.keyPrefix).toBe(apiKey.slice(0, 10))
    expect(server.status.online).toBe(false)
    expect(server.config.protections.connectionFlood.mode).toBe('enforce')

    const detail = await admin.get(`/api/servers/${id}`)
    expect(JSON.stringify(detail.body)).not.toContain(apiKey)
    const list = await admin.get('/api/servers')
    expect(JSON.stringify(list.body)).not.toContain(apiKey)

    // only the hash is stored
    const row = t.db.get<{ key_hash: string }>('SELECT key_hash FROM servers WHERE id = ?', id)!
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.key_hash).not.toContain(apiKey)
  })

  it('validates the name', async () => {
    expect((await admin.post('/api/servers', { name: '   ' })).status).toBe(400)
    expect((await admin.post('/api/servers', { name: 'x'.repeat(61) })).status).toBe(400)
  })

  it('renames and disables a server; a disabled server cannot sync', async () => {
    const { id, apiKey } = await createServer(admin)
    const res = await admin.patch(`/api/servers/${id}`, { name: 'Renamed', enabled: false })
    expect(res.body.server.name).toBe('Renamed')
    expect(res.body.server.enabled).toBe(false)
    expect((await agentSync(t, apiKey)).statusCode).toBe(403)
    await admin.patch(`/api/servers/${id}`, { enabled: true })
    expect((await agentSync(t, apiKey)).statusCode).toBe(200)
  })

  it('rotating the key invalidates the old key immediately', async () => {
    const { id, apiKey } = await createServer(admin)
    expect((await agentSync(t, apiKey)).statusCode).toBe(200)
    const rotated = await admin.post(`/api/servers/${id}/rotate-key`)
    expect(rotated.status).toBe(200)
    const newKey = rotated.body.apiKey as string
    expect(newKey).not.toBe(apiKey)
    expect((await agentSync(t, apiKey)).statusCode).toBe(401)
    expect((await agentSync(t, newKey)).statusCode).toBe(200)
  })

  it('deleting a server removes its data and revokes the key', async () => {
    const { id, apiKey } = await createServer(admin)
    await agentSync(t, apiKey, { seq: 1, stats: { attempts: 5 }, events: [{ type: 'x' }] })
    expect((await admin.del(`/api/servers/${id}`)).status).toBe(200)
    expect((await agentSync(t, apiKey)).statusCode).toBe(401)
    for (const table of ['events', 'stats_minute', 'list_entries']) {
      expect(t.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n).toBe(0)
    }
  })
})

describe('server configuration', () => {
  it('only bumps the revision when something actually changed', async () => {
    const { id, server } = await createServer(admin)
    expect(server.configRev).toBe(1)

    const same = await admin.put(`/api/servers/${id}/config`, { config: server.config })
    expect(same.body).toMatchObject({ changed: false, configRev: 1 })

    const next = structuredClone(server.config)
    next.protections.connectionFlood.maxAttemptsPerIp = 3
    const changed = await admin.put(`/api/servers/${id}/config`, { config: next })
    expect(changed.body).toMatchObject({ changed: true, configRev: 2 })
    expect(changed.body.config.protections.connectionFlood.maxAttemptsPerIp).toBe(3)
  })

  it('normalises whatever the client sends', async () => {
    const { id } = await createServer(admin)
    const res = await admin.put(`/api/servers/${id}/config`, {
      config: { protections: { connectionFlood: { maxAttemptsPerIp: 99999, mode: 'bogus' }, nope: {} }, evil: true },
    })
    expect(res.status).toBe(200)
    expect(res.body.config.protections.connectionFlood).toMatchObject({ maxAttemptsPerIp: 200, mode: 'enforce' })
    expect(res.body.config).not.toHaveProperty('evil')
    expect((await admin.put(`/api/servers/${id}/config`, { config: 'junk' })).status).toBe(400)
  })

  it('patch merges (panic switch)', async () => {
    const { id } = await createServer(admin)
    const res = await admin.patch(`/api/servers/${id}/config`, { patch: { protections: { attackMode: { mode: 'on' } } } })
    expect(res.body.config.protections.attackMode.mode).toBe('on')
    expect(res.body.config.protections.connectionFlood.mode).toBe('enforce')
    expect(res.body.configRev).toBe(2)
  })

  it('serves the protection catalog to signed-in users', async () => {
    const res = await admin.get('/api/meta/catalog')
    expect(res.status).toBe(200)
    expect(res.body.protections.map((p: { id: string }) => p.id)).toContain('connectionFlood')
    expect(res.body.presets.length).toBeGreaterThan(1)
  })
})

describe('block / allow lists', () => {
  it('adds mixed entries with smart paste and reports invalid ones', async () => {
    const { id } = await createServer(admin)
    const res = await admin.post(`/api/servers/${id}/lists`, {
      list: 'block',
      value: '1.2.3.4\n10.20.30.40/16, license:ABCDEF, nonsense, 1.2.3.4',
      reason: 'botnet',
    })
    expect(res.body.added).toBe(3)
    expect(res.body.skipped).toHaveLength(1)
    expect(res.body.skipped[0].value).toBe('nonsense')

    const list = await admin.get(`/api/servers/${id}/lists`)
    const values = list.body.items.map((i: { kind: string; value: string }) => `${i.kind}:${i.value}`).sort()
    expect(values).toEqual(['cidr:10.20.0.0/16', 'identifier:license:abcdef', 'ip:1.2.3.4'])
  })

  it('bumps the list revision on change and delivers a snapshot to the resource', async () => {
    const { id, apiKey } = await createServer(admin)
    await admin.post(`/api/servers/${id}/lists`, { list: 'block', value: '9.9.9.9', reason: 'x' })
    await admin.post(`/api/servers/${id}/lists`, { list: 'allow', value: 'license:myself' })

    const first = (await agentSync(t, apiKey)).json()
    expect(first.listsRev).toBe(3)
    expect(first.lists.block).toEqual([{ kind: 'ip', value: '9.9.9.9', reason: 'x', ttl: null }])
    expect(first.lists.allow).toEqual([{ kind: 'identifier', value: 'license:myself', ttl: null }])

    // already up to date → no snapshot
    const second = (await agentSync(t, apiKey, { listsRev: 3, configRev: 1 })).json()
    expect(second.lists).toBeUndefined()
  })

  it('supports expiring entries (ttl is "seconds left")', async () => {
    const { id, apiKey } = await createServer(admin)
    await admin.post(`/api/servers/${id}/lists`, { list: 'block', value: '8.8.8.8', ttlSec: 3600 })
    t.clock.t += 600
    const snap = (await agentSync(t, apiKey)).json()
    expect(snap.lists.block[0].ttl).toBe(3000)

    t.clock.t += 3001
    expect((await admin.get(`/api/servers/${id}/lists`)).body.items).toHaveLength(0)
    const after = (await agentSync(t, apiKey, { listsRev: 0 })).json()
    expect(after.lists.block).toHaveLength(0)
  })

  it('deletes entries and bumps the revision', async () => {
    const { id } = await createServer(admin)
    await admin.post(`/api/servers/${id}/lists`, { list: 'block', value: '5.5.5.5' })
    const entry = (await admin.get(`/api/servers/${id}/lists`)).body.items[0]
    const before = (await admin.get(`/api/servers/${id}`)).body.server.listsRev
    expect((await admin.del(`/api/servers/${id}/lists/${entry.id}`)).status).toBe(200)
    expect((await admin.get(`/api/servers/${id}`)).body.server.listsRev).toBe(before + 1)
    expect((await admin.del(`/api/servers/${id}/lists/${entry.id}`)).status).toBe(404)
  })

  it('re-adding an entry refreshes it instead of duplicating', async () => {
    const { id } = await createServer(admin)
    await admin.post(`/api/servers/${id}/lists`, { list: 'block', value: '5.5.5.5', reason: 'a' })
    await admin.post(`/api/servers/${id}/lists`, { list: 'block', value: '5.5.5.5', reason: 'b' })
    const items = (await admin.get(`/api/servers/${id}/lists`)).body.items
    expect(items).toHaveLength(1)
    expect(items[0].reason).toBe('b')
  })

  it('enforces the per-list limit', async () => {
    const { id } = await createServer(admin)
    t.db.tx(() => {
      for (let i = 0; i < 5000; i++) {
        t.db.run(
          "INSERT INTO list_entries (id, server_id, list, kind, value, created_at) VALUES (?, ?, 'block', 'ip', ?, ?)",
          `e${i}`,
          id,
          `10.${(i >> 8) & 255}.${i & 255}.1`,
          t.clock.t,
        )
      }
    })
    const res = await admin.post(`/api/servers/${id}/lists`, { list: 'block', value: '77.77.77.77' })
    expect(res.body.added).toBe(0)
    expect(res.body.skipped[0].error).toMatch(/full/)
  })
})
