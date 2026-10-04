import type { Catalog } from './types'

/** "5 min ago", "3 h ago" … for a unix timestamp in seconds. */
export function timeAgo(unixSec: number | null | undefined, nowMs = Date.now()): string {
  if (!unixSec) return 'never'
  const s = Math.max(0, Math.round(nowMs / 1000 - unixSec))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

/** "in 5 min", "in 2 d" for a future timestamp; "expired" if it passed. */
export function timeUntil(unixSec: number | null | undefined, nowMs = Date.now()): string {
  if (!unixSec) return 'never'
  const s = Math.round(unixSec - nowMs / 1000)
  if (s <= 0) return 'expired'
  if (s < 60) return `in ${s} s`
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`
  if (s < 86400) return `in ${Math.ceil(s / 3600)} h`
  return `in ${Math.ceil(s / 86400)} d`
}

export function formatDateTime(unixSec: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(unixSec * 1000))
}

export function formatDate(unixSec: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(unixSec * 1000))
}

/** 90 -> "1 min 30 s", 3600 -> "1 h", 604800 -> "7 d". */
export function humanDuration(totalSeconds: number): string {
  let s = Math.max(0, Math.round(totalSeconds))
  if (s === 0) return '0 s'
  const parts: string[] = []
  const units: [string, number][] = [
    ['d', 86400],
    ['h', 3600],
    ['min', 60],
    ['s', 1],
  ]
  for (const [label, size] of units) {
    if (s >= size) {
      parts.push(`${Math.floor(s / size)} ${label}`)
      s %= size
    }
    if (parts.length === 2) break
  }
  return parts.join(' ')
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n)
}

// ─── labels for ids the backend / resource send ────────────────────────────

const EXTRA_RULES: Record<string, string> = {
  blocklist: 'Blocklist',
  tempBan: 'Temporary ban',
  endpointPrivacy: 'Endpoint privacy',
}

export function ruleLabel(rule: string | null | undefined, catalog?: Catalog): string {
  if (!rule) return '—'
  return catalog?.protections.find((p) => p.id === rule)?.title ?? EXTRA_RULES[rule] ?? rule
}

export const EVENT_TYPES: Record<string, string> = {
  connection_blocked: 'Connection blocked',
  auto_ban: 'Temporary ban',
  event_flood: 'Event flood',
  entity_spam: 'Entity spam',
  chat_flood: 'Chat flood',
  player_kicked: 'Player kicked',
  attack_started: 'Attack started',
  attack_ended: 'Attack ended',
  resource_started: 'Resource started',
  warning: 'Warning',
  events_dropped: 'Events dropped',
}

export function eventTypeLabel(type: string): string {
  return EVENT_TYPES[type] ?? type.replace(/_/g, ' ')
}

/** Copy text to the clipboard; falls back to a hidden textarea on plain-http origins. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/** The text a server owner pastes into server.cfg. */
export function serverCfgSnippet(apiKey: string): string {
  return [`set fxshield_url "${window.location.origin}"`, `set fxshield_key "${apiKey}"`, 'ensure fxshield'].join('\n')
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}
