import { existsSync } from 'node:fs'
import path from 'node:path'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify'
import { resolveSession } from './auth.js'
import type { AppConfig } from './config.js'
import type { AppContext } from './context.js'
import type { Db } from './db.js'
import { HttpError } from './errors.js'
import { agentRoutes } from './routes/agent.js'
import { authRoutes } from './routes/auth.js'
import { insightRoutes } from './routes/insights.js'
import { listRoutes } from './routes/lists.js'
import { metaRoutes } from './routes/meta.js'
import { serverRoutes } from './routes/servers.js'
import { userRoutes } from './routes/users.js'
import { randomToken } from './security.js'

export interface BuildOptions {
  config: AppConfig
  db: Db
  /** Clock in unix seconds – injectable for tests. */
  now?: () => number
  logger?: boolean
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const NO_DASHBOARD_HTML = `<!doctype html><meta charset="utf-8"><title>FX Shield</title>
<body style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1>FX Shield backend is running</h1>
<p>The dashboard has not been built yet. Run <code>npm run build</code> in the <code>backend</code> folder and restart,
or use <code>npm run dev:dashboard</code> for development.</p>
<p>API health: <a href="/api/health">/api/health</a></p></body>`

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { config, db } = opts
  const ctx: AppContext = {
    config,
    db,
    now: opts.now ?? (() => Math.floor(Date.now() / 1000)),
    setup: { token: null },
  }

  // No account yet → the first visitor must prove server access with a one-time token from the log.
  const users = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n
  if (users === 0) ctx.setup.token = config.setupToken ?? randomToken(18)

  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024, // dashboard API; the agent sync route raises it to 512 KiB for itself
    // the resource syncs every few seconds – per-request access logs would only be noise
    logController: new LogController({ disableRequestLogging: true }),
  })

  app.decorateRequest('user', null)
  app.decorateRequest('sessionId', null)

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Radix / Recharts set inline style attributes
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    strictTransportSecurity: config.cookieSecure,
    crossOriginEmbedderPolicy: false,
  })
  await app.register(cookie)

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) })
    }
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message })
    }
    req.log.error(err)
    return reply.code(500).send({ error: 'internal_error', message: 'Internal server error' })
  })

  // ── dashboard API (cookie session) ──────────────────────────────────────────
  await app.register(
    async (api) => {
      await api.register(rateLimit, { max: 600, timeWindow: '1 minute' })

      api.addHook('onRequest', async (req, reply) => resolveSession(ctx, req, reply))

      // CSRF defence in depth (cookies are already SameSite=Strict): reject cross-origin state changes.
      api.addHook('onRequest', async (req: FastifyRequest) => {
        if (!UNSAFE_METHODS.has(req.method)) return
        const origin = req.headers.origin
        if (!origin) return // non-browser client (curl, scripts): no cookie ambient authority to abuse
        let originHost: string
        try {
          originHost = new URL(origin).host
        } catch {
          throw new HttpError(403, 'bad_origin', 'Invalid Origin header.')
        }
        const allowed = new Set<string>([String(req.headers.host ?? '')])
        if (config.publicUrl) allowed.add(new URL(config.publicUrl).host)
        if (!allowed.has(originHost)) throw new HttpError(403, 'bad_origin', 'Cross-origin request blocked.')
      })

      api.get('/health', async () => ({ ok: true, name: 'fxshield-backend', protocol: 1 }))

      await api.register(authRoutes(ctx), { prefix: '/auth' })
      await api.register(userRoutes(ctx), { prefix: '/users' })
      await api.register(serverRoutes(ctx), { prefix: '/servers' })
      await api.register(listRoutes(ctx), { prefix: '/servers' })
      await api.register(insightRoutes(ctx), { prefix: '/servers' })
      await api.register(metaRoutes(ctx), { prefix: '/meta' })
    },
    { prefix: '/api' },
  )

  // ── agent API (API key, spoken by the FiveM resource) ───────────────────────
  await app.register(
    async (agent) => {
      // generous per-IP ceiling (several game servers may share one host); per-key limits live in the route
      await agent.register(rateLimit, { max: 1200, timeWindow: '1 minute' })
      await agent.register(agentRoutes(ctx), { prefix: '/v1' })
    },
    { prefix: '/api/agent' },
  )

  // ── dashboard (static SPA) ──────────────────────────────────────────────────
  const hasDashboard = existsSync(path.join(config.dashboardDir, 'index.html'))
  if (hasDashboard) {
    await app.register(fastifyStatic, {
      root: config.dashboardDir,
      wildcard: false,
      setHeaders(reply, filePath) {
        reply.header(
          'Cache-Control',
          filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
        )
      },
    })
  }

  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api/') || req.url === '/api'
    if (req.method === 'GET' && !isApi) {
      if (hasDashboard) return reply.header('Cache-Control', 'no-cache').sendFile('index.html') // SPA routes
      return reply.code(200).type('text/html; charset=utf-8').send(NO_DASHBOARD_HTML)
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found' })
  })

  return { app, ctx }
}
