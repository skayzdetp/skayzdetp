import './quiet-warnings.js'
import { buildApp } from './app.js'
import { loadConfig, loadDotEnv } from './config.js'
import { openDatabase } from './db.js'
import { startMaintenance } from './services/maintenance.js'

async function main() {
  loadDotEnv()
  const config = loadConfig()
  const db = openDatabase(config.databasePath)
  const { app, ctx } = await buildApp({ config, db })

  const stopMaintenance = startMaintenance(ctx, (err) => app.log.error(err, 'maintenance failed'))

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`)
    stopMaintenance()
    try {
      await app.close()
      db.close()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: config.host, port: config.port })

  const local = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`
  const url = config.publicUrl ?? local
  if (ctx.setup.token) {
    const lines = [
      '',
      '┌─────────────────────────────────────────────────────────────┐',
      '│  FX Shield – first start                                    │',
      `│  1. Open ${url}`.padEnd(62) + '│',
      '│  2. Create the administrator account with this setup token: │',
      `│     ${ctx.setup.token}`.padEnd(62) + '│',
      '└─────────────────────────────────────────────────────────────┘',
      '',
    ]
    console.log(lines.join('\n'))
  } else {
    console.log(`FX Shield backend ready on ${url}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
