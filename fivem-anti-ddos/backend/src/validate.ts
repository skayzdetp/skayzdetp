import net from 'node:net'

export type ListKind = 'ip' | 'cidr' | 'identifier'
export interface ParsedEntry {
  kind: ListKind
  value: string
}

/** Identifier types FiveM exposes and that are stable enough to block on. */
export const IDENTIFIER_TYPES = ['license', 'license2', 'steam', 'discord', 'fivem', 'xbl', 'live'] as const
const IDENTIFIER_RE = new RegExp(`^(${IDENTIFIER_TYPES.join('|')}):([A-Za-z0-9._-]{1,100})$`, 'i')

export function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map(Number)
  return (((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0)
}

export function intToIpv4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

/**
 * Classify and normalise one blocklist / allowlist value.
 * Accepts IPv4/IPv6 addresses, IPv4 CIDR ranges (/8–/32) and FiveM identifiers.
 */
export function parseListValue(raw: string): ParsedEntry | { error: string } {
  let v = raw.trim()
  if (!v) return { error: 'empty value' }
  if (v.length > 140) return { error: 'value too long' }

  // `ip:1.2.3.4` (as shown in FiveM identifier lists) is just an IP
  if (/^ip:/i.test(v)) v = v.slice(3)

  if (v.includes('/')) {
    const parts = v.split('/')
    const addr = parts[0] ?? ''
    const bitsStr = parts[1] ?? ''
    if (parts.length !== 2 || !/^\d{1,2}$/.test(bitsStr)) return { error: 'invalid CIDR range' }
    if (!net.isIPv4(addr)) return { error: 'only IPv4 CIDR ranges are supported' }
    const bits = Number(bitsStr)
    if (bits < 8 || bits > 32) return { error: 'CIDR prefix must be between /8 and /32' }
    if (bits === 32) return { kind: 'ip', value: addr }
    const mask = (0xffffffff << (32 - bits)) >>> 0
    return { kind: 'cidr', value: `${intToIpv4((ipv4ToInt(addr) & mask) >>> 0)}/${bits}` }
  }

  if (net.isIPv4(v)) return { kind: 'ip', value: v }
  if (net.isIPv6(v)) return { kind: 'ip', value: v.toLowerCase() }

  const m = IDENTIFIER_RE.exec(v)
  if (m) return { kind: 'identifier', value: `${m[1]!.toLowerCase()}:${m[2]!.toLowerCase()}` }

  return { error: 'not an IP address, CIDR range or identifier (e.g. license:abc…, discord:123…)' }
}

/** Split pasted text (newlines, commas, semicolons, spaces) into unique tokens. */
export function splitListInput(text: string, max = 500): string[] {
  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  return [...new Set(tokens)].slice(0, max)
}

/* eslint-disable no-control-regex */
const CONTROL = /[\u0000-\u001f\u007f]/g

/** Strip control characters and cap the length – for text that came from game servers. */
export function cleanText(value: string, max: number): string {
  return value.replace(CONTROL, ' ').trim().slice(0, max)
}

/** Returns a valid IPv4/IPv6 string or null. */
export function cleanIp(value: string | undefined): string | null {
  if (!value) return null
  const v = value.trim()
  return net.isIP(v) ? v.toLowerCase() : null
}

/** Returns `type:value` when it looks like a FiveM identifier, else null. */
export function cleanIdentifier(value: string | undefined): string | null {
  if (!value) return null
  const m = /^([a-z0-9]{2,12}):([A-Za-z0-9._-]{1,100})$/i.exec(value.trim())
  return m ? `${m[1]!.toLowerCase()}:${m[2]!.toLowerCase()}` : null
}
