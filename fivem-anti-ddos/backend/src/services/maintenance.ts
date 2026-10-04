import type { AppContext } from '../context.js'

/** Delete data that outlived its retention period. Safe to call at any time. */
export function runMaintenance(ctx: AppContext): void {
  const now = ctx.now()
  const { eventRetentionDays, statsRetentionDays } = ctx.config
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM events WHERE ts < ?', now - eventRetentionDays * 86400)
    ctx.db.run('DELETE FROM stats_minute WHERE bucket < ?', now - statsRetentionDays * 86400)
    ctx.db.run('DELETE FROM stats_rule_minute WHERE bucket < ?', now - statsRetentionDays * 86400)
    ctx.db.run('DELETE FROM sessions WHERE expires_at <= ?', now)
    ctx.db.run('DELETE FROM list_entries WHERE expires_at IS NOT NULL AND expires_at <= ?', now)
  })
}

/** Run maintenance now and then every 10 minutes. Returns a function that stops the timer. */
export function startMaintenance(ctx: AppContext, onError: (err: unknown) => void): () => void {
  const tick = () => {
    try {
      runMaintenance(ctx)
    } catch (err) {
      onError(err)
    }
  }
  tick()
  const timer = setInterval(tick, 10 * 60 * 1000)
  timer.unref()
  return () => clearInterval(timer)
}
