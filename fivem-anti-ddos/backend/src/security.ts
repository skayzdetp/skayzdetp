import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>

const KEY_LEN = 64
const SCRYPT_R = 8
const SCRYPT_P = 3

/** Password hash format: scrypt$N$r$p$<salt b64>$<hash b64> */
export async function hashPassword(password: string, N = 32768): Promise<string> {
  const salt = crypto.randomBytes(16)
  const hash = await scryptAsync(password, salt, KEY_LEN, {
    N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * N * SCRYPT_R * 2,
  })
  return `scrypt$${N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [string, string, string, string, string, string]
  const N = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  if (N < 1024 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  if (expected.length === 0) return false
  const actual = await scryptAsync(password, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 })
  return crypto.timingSafeEqual(actual, expected)
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

/** Constant-time string comparison (length-independent). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export const API_KEY_PREFIX = 'fxs_'

/** 256 bit random API key, e.g. `fxs_k3J…` (only its SHA-256 is stored). */
export function generateApiKey(): string {
  return API_KEY_PREFIX + crypto.randomBytes(32).toString('base64url')
}

/** Short, non-secret fragment shown in the dashboard to tell keys apart. */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + 6)
}

export function newId(prefix: string, bytes = 9): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`
}
