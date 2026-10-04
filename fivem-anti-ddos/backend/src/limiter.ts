/** Tiny in-memory fixed-window rate limiter (used for per-API-key throttling). */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>()
  private lastSweep = 0

  /** Returns true when the call is within `limit` calls per `windowSec`. */
  allow(key: string, nowSec: number, limit: number, windowSec: number): boolean {
    this.sweep(nowSec, windowSec)
    const h = this.hits.get(key)
    if (!h || nowSec - h.start >= windowSec) {
      this.hits.set(key, { start: nowSec, count: 1 })
      return true
    }
    h.count++
    return h.count <= limit
  }

  private sweep(nowSec: number, windowSec: number): void {
    if (nowSec - this.lastSweep < 60) return
    this.lastSweep = nowSec
    for (const [k, h] of this.hits) if (nowSec - h.start >= windowSec) this.hits.delete(k)
  }
}
