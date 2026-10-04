import type { FastifyPluginAsync } from 'fastify'
import { requireUser } from '../auth.js'
import { catalogForClient } from '../catalog.js'
import type { AppContext } from '../context.js'

export const metaRoutes =
  (_ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    // Everything the dashboard needs to render the protection forms (fields, limits, defaults, presets).
    app.get('/catalog', async (req) => {
      requireUser(req)
      return catalogForClient()
    })
  }
