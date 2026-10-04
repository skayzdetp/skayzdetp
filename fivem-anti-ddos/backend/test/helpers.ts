import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { Db, migrate } from '../src/db.js'
import type { AppContext } from '../src/context.js'

export interface TestApp {
  app: FastifyInstance
  ctx: AppContext
  db: Db
  clock: { t: number }
  close: () => Promise<void>
}

export async function makeApp(env: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({
    SCRYPT_N: '1024', // cheap hashing – tests create many accounts
    LOG_LEVEL: 'silent',
    DASHBOARD_DIR: '/nonexistent-dashboard',
    ...env,
  })
  const db = new Db(':memory:')
  migrate(db)
  const clock = { t: 1_700_000_000 }
  const { app, ctx } = await buildApp({ config, db, now: () => clock.t, logger: false })
  return {
    app,
    ctx,
    db,
    clock,
    close: async () => {
      await app.close()
      db.close()
    },
  }
}

export interface Res<T = any> {
  status: number
  body: T
  headers: Record<string, unknown>
}

/** A tiny cookie-aware HTTP client on top of fastify.inject(). */
export class Client {
  cookie = ''
  constructor(private readonly app: FastifyInstance) {}

  async req<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Res<T>> {
    const res = await this.app.inject({
      method,
      url,
      payload: payload as object | undefined,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    })
    const setCookie = res.headers['set-cookie']
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
    for (const c of cookies) {
      const m = /^fxs_session=([^;]*)/.exec(c)
      if (m) this.cookie = m[1] ? `fxs_session=${m[1]}` : ''
    }
    let body: any = null
    try {
      body = res.json()
    } catch {
      body = res.body
    }
    return { status: res.statusCode, body, headers: res.headers }
  }

  get = <T = any>(url: string, headers?: Record<string, string>) => this.req<T>('GET', url, undefined, headers)
  post = <T = any>(url: string, body?: unknown, headers?: Record<string, string>) => this.req<T>('POST', url, body ?? {}, headers)
  put = <T = any>(url: string, body?: unknown) => this.req<T>('PUT', url, body ?? {})
  patch = <T = any>(url: string, body?: unknown) => this.req<T>('PATCH', url, body ?? {})
  del = <T = any>(url: string) => this.req<T>('DELETE', url)
}

export const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery' }

/** Create the first admin through the real setup endpoint and return a signed-in client. */
export async function setupAdmin(t: TestApp): Promise<Client> {
  const c = new Client(t.app)
  const res = await c.post('/api/auth/setup', { setupToken: t.ctx.setup.token, ...ADMIN })
  if (res.status !== 200) throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.body)}`)
  return c
}

/** Admin creates a regular user; returns a client signed in as that user. */
export async function createUserClient(t: TestApp, admin: Client, email: string, password = 'another-long-password'): Promise<Client> {
  const res = await admin.post('/api/users', { email, password, role: 'user' })
  if (res.status !== 201) throw new Error(`create user failed: ${res.status} ${JSON.stringify(res.body)}`)
  const c = new Client(t.app)
  const login = await c.post('/api/auth/login', { email, password })
  if (login.status !== 200) throw new Error(`login failed: ${login.status}`)
  return c
}

export async function createServer(c: Client, name = 'Test Server'): Promise<{ id: string; apiKey: string; server: any }> {
  const res = await c.post('/api/servers', { name })
  if (res.status !== 201) throw new Error(`create server failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { id: res.body.server.id, apiKey: res.body.apiKey, server: res.body.server }
}

export interface SyncOptions {
  session?: string
  seq?: number
  configRev?: number
  listsRev?: number
  attack?: boolean
  server?: unknown
  stats?: unknown
  events?: unknown[]
}

export function syncBody(o: SyncOptions = {}) {
  return {
    protocol: 1,
    resource: { version: '1.0.0', session: o.session ?? 'sess-1234', seq: o.seq ?? 0 },
    server: o.server ?? { name: 'Test', players: 3, maxPlayers: 64, tickMs: 4.2, onesync: 'on', endpointPrivacy: false },
    state: { configRev: o.configRev ?? 0, listsRev: o.listsRev ?? 0, attack: o.attack ?? false },
    stats: o.stats ?? {},
    events: o.events ?? [],
  }
}

export function agentSync(t: TestApp, apiKey: string, o: SyncOptions = {}, raw?: unknown) {
  return t.app.inject({
    method: 'POST',
    url: '/api/agent/v1/sync',
    headers: { authorization: `Bearer ${apiKey}` },
    payload: (raw ?? syncBody(o)) as object,
  })
}
