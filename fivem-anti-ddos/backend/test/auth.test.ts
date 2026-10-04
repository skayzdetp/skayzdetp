import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN, Client, createServer, createUserClient, makeApp, setupAdmin, type TestApp } from './helpers.js'

let t: TestApp
beforeEach(async () => {
  t = await makeApp()
})
afterEach(async () => {
  await t.close()
})

describe('first-run setup', () => {
  it('reports that setup is needed and has a one-time token', async () => {
    const c = new Client(t.app)
    const me = await c.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body).toEqual({ user: null, needsSetup: true })
    expect(t.ctx.setup.token).toMatch(/^[\w-]{20,}$/)
  })

  it('rejects a wrong setup token', async () => {
    const c = new Client(t.app)
    const res = await c.post('/api/auth/setup', { setupToken: 'nope-nope-nope-nope', ...ADMIN })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('invalid_setup_token')
  })

  it('creates the admin with the right token, signs in, and then locks setup', async () => {
    const c = await setupAdmin(t)
    const me = await c.get('/api/auth/me')
    expect(me.body.user).toMatchObject({ email: ADMIN.email, role: 'admin' })
    expect(me.body.needsSetup).toBe(false)
    expect(t.ctx.setup.token).toBeNull()

    const again = await new Client(t.app).post('/api/auth/setup', { setupToken: 'whatever-token-123', email: 'x@example.com', password: 'another-long-password' })
    expect(again.status).toBe(409)
  })

  it('validates email and password', async () => {
    const c = new Client(t.app)
    const bad = await c.post('/api/auth/setup', { setupToken: t.ctx.setup.token, email: 'not-an-email', password: 'short' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('validation_error')
  })

  it('never stores the password in plain text', async () => {
    await setupAdmin(t)
    const row = t.db.get<{ password_hash: string }>('SELECT password_hash FROM users')!
    expect(row.password_hash.startsWith('scrypt$')).toBe(true)
    expect(row.password_hash).not.toContain(ADMIN.password)
  })
})

describe('login / logout / sessions', () => {
  it('logs in with correct credentials and rejects wrong ones with the same error', async () => {
    await setupAdmin(t)
    const c = new Client(t.app)
    const wrongPw = await c.post('/api/auth/login', { email: ADMIN.email, password: 'wrong-password-123' })
    const noUser = await c.post('/api/auth/login', { email: 'ghost@example.com', password: 'wrong-password-123' })
    expect(wrongPw.status).toBe(401)
    expect(noUser.status).toBe(401)
    expect(noUser.body).toEqual(wrongPw.body) // no user enumeration

    const ok = await c.post('/api/auth/login', ADMIN)
    expect(ok.status).toBe(200)
    expect((await c.get('/api/auth/me')).body.user.email).toBe(ADMIN.email)
  })

  it('sets an HttpOnly, SameSite=Strict cookie and stores only a hash of the token', async () => {
    const admin = await setupAdmin(t)
    const login = await new Client(t.app).req('POST', '/api/auth/login', ADMIN)
    const raw = String(login.headers['set-cookie'])
    expect(raw).toMatch(/HttpOnly/i)
    expect(raw).toMatch(/SameSite=Strict/i)
    const token = /fxs_session=([^;]+)/.exec(raw)![1]!
    const stored = t.db.all<{ id: string }>('SELECT id FROM sessions').map((r) => r.id)
    expect(stored).not.toContain(token)
    expect(admin.cookie).toContain('fxs_session=')
  })

  it('logout invalidates the session', async () => {
    const c = await setupAdmin(t)
    expect((await c.post('/api/auth/logout')).status).toBe(200)
    expect((await c.get('/api/auth/me')).body.user).toBeNull()
    expect((await c.get('/api/servers')).status).toBe(401)
  })

  it('expires sessions after the configured lifetime', async () => {
    const c = await setupAdmin(t)
    expect((await c.get('/api/servers')).status).toBe(200)
    t.clock.t += t.ctx.config.sessionTtlSec + 5
    expect((await c.get('/api/servers')).status).toBe(401)
  })

  it('changing the password signs out other sessions', async () => {
    const a = await setupAdmin(t)
    const b = new Client(t.app)
    await b.post('/api/auth/login', ADMIN)
    expect((await b.get('/api/servers')).status).toBe(200)

    const wrong = await a.post('/api/auth/password', { currentPassword: 'bad-bad-bad-bad', newPassword: 'brand-new-password' })
    expect(wrong.status).toBe(403)
    const ok = await a.post('/api/auth/password', { currentPassword: ADMIN.password, newPassword: 'brand-new-password' })
    expect(ok.status).toBe(200)

    expect((await a.get('/api/servers')).status).toBe(200) // current session survives
    expect((await b.get('/api/servers')).status).toBe(401) // other session is gone
    expect((await new Client(t.app).post('/api/auth/login', { email: ADMIN.email, password: 'brand-new-password' })).status).toBe(200)
  })

  it('requires authentication for the dashboard API', async () => {
    const c = new Client(t.app)
    for (const url of ['/api/servers', '/api/users', '/api/meta/catalog']) {
      expect((await c.get(url)).status).toBe(401)
    }
  })
})

describe('CSRF / origin check', () => {
  it('blocks state-changing requests from a foreign origin', async () => {
    const c = await setupAdmin(t)
    const res = await c.req('POST', '/api/servers', { name: 'evil' }, { origin: 'https://evil.example', host: 'shield.test' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('bad_origin')
  })

  it('allows same-origin requests', async () => {
    const c = await setupAdmin(t)
    const res = await c.req('POST', '/api/servers', { name: 'ok' }, { origin: 'http://shield.test', host: 'shield.test' })
    expect(res.status).toBe(201)
  })
})

describe('accounts and isolation', () => {
  it('only admins can manage accounts', async () => {
    const admin = await setupAdmin(t)
    const user = await createUserClient(t, admin, 'user@example.com')
    expect((await user.get('/api/users')).status).toBe(403)
    expect((await user.post('/api/users', { email: 'x@example.com', password: 'long-enough-password' })).status).toBe(403)
    expect((await admin.get('/api/users')).body.items).toHaveLength(2)
  })

  it('rejects duplicate emails (case-insensitive)', async () => {
    const admin = await setupAdmin(t)
    await createUserClient(t, admin, 'dup@example.com')
    const res = await admin.post('/api/users', { email: 'DUP@example.com', password: 'long-enough-password' })
    expect(res.status).toBe(409)
  })

  it('keeps servers private between accounts (404, not 403)', async () => {
    const admin = await setupAdmin(t)
    const alice = await createUserClient(t, admin, 'alice@example.com')
    const bob = await createUserClient(t, admin, 'bob@example.com')
    const { id } = await createServer(alice, 'Alice RP')

    expect((await bob.get(`/api/servers/${id}`)).status).toBe(404)
    expect((await bob.put(`/api/servers/${id}/config`, { config: {} })).status).toBe(404)
    expect((await bob.del(`/api/servers/${id}`)).status).toBe(404)
    expect((await bob.get('/api/servers')).body.items).toHaveLength(0)
    expect((await alice.get('/api/servers')).body.items).toHaveLength(1)
    expect((await admin.get('/api/servers')).body.items).toHaveLength(1) // admins see everything
  })

  it('protects the last administrator and the own account', async () => {
    const admin = await setupAdmin(t)
    const me = (await admin.get('/api/auth/me')).body.user
    expect((await admin.del(`/api/users/${me.id}`)).status).toBe(400)
    expect((await admin.patch(`/api/users/${me.id}`, { role: 'user' })).status).toBe(400)
  })

  it('deleting a user removes their servers', async () => {
    const admin = await setupAdmin(t)
    const alice = await createUserClient(t, admin, 'alice@example.com')
    await createServer(alice)
    const users = (await admin.get('/api/users')).body.items as { id: string; email: string }[]
    const aliceId = users.find((u) => u.email === 'alice@example.com')!.id
    expect((await admin.del(`/api/users/${aliceId}`)).status).toBe(200)
    expect(t.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM servers')!.n).toBe(0)
    expect((await alice.get('/api/servers')).status).toBe(401) // sessions are gone too
  })
})
