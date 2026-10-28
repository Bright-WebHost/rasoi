/**
 * Dev Simulator Access — Cookie utilities
 *
 * Manages the `pabbas_dev_access` HTTP-only cookie that gates access to
 * the WhatsApp Simulator on Vercel (production deployments).
 *
 * Security model:
 * - The DEV_ACCESS_KEY environment variable is the secret. It never leaves the server.
 * - The cookie value is an HMAC-SHA256 signed token, not the raw key.
 * - Secret comparison uses timingSafeEqual to prevent timing attacks.
 * - This cookie is completely separate from `pabbas_session` (customer identity).
 *   It only gates developer-tool access; it does NOT identify any customer.
 *
 * LOCAL: The enforcement is skipped entirely (NODE_ENV !== 'production'),
 * so /dev/* routes work normally with zero friction during development.
 *
 * PRODUCTION (Vercel): All /dev/* routes except /dev/login require a valid
 * pabbas_dev_access cookie, issued only by POST /api/dev/access.
 */

import { timingSafeEqual, createHmac, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

export const DEV_ACCESS_COOKIE = 'pabbas_dev_access'
/** 8 hours */
const DEV_ACCESS_MAX_AGE = 60 * 60 * 8

// ── Internal helpers ──────────────────────────────────────────────────────────

function getDevSecret(): string | null {
  return process.env.DEV_ACCESS_KEY ?? null
}

/**
 * Produces an HMAC-SHA256 hex digest of `payload` using the DEV_ACCESS_KEY.
 * Returns null if the key is not configured.
 */
function signPayload(payload: string): string | null {
  const secret = getDevSecret()
  if (!secret) return null
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Builds the signed cookie value: `<payload>.<hmac>`
 * The payload is a random nonce so replayed cookies cannot be forged.
 */
function buildCookieValue(): string | null {
  const nonce = randomBytes(24).toString('base64url')
  const sig = signPayload(nonce)
  if (!sig) return null
  return `${nonce}.${sig}`
}

/**
 * Verifies a raw cookie string of the form `<nonce>.<hmac>`.
 * Returns true only if the signature matches and DEV_ACCESS_KEY is set.
 */
function verifyCookieValue(raw: string): boolean {
  const dotIdx = raw.lastIndexOf('.')
  if (dotIdx === -1) return false

  const nonce = raw.slice(0, dotIdx)
  const sig = raw.slice(dotIdx + 1)
  const expected = signPayload(nonce)
  if (!expected) return false

  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Checks whether the request carries a valid dev-access cookie.
 *
 * Works with a raw `NextRequest` object — usable in Edge Middleware
 * where `cookies()` (from next/headers) is not available.
 */
export function verifyDevAccessFromRequest(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  const raw = request.cookies.get(DEV_ACCESS_COOKIE)?.value
  if (!raw) return false
  return verifyCookieValue(raw)
}

/**
 * Checks whether the current server context (Route Handler / Server Component)
 * carries a valid dev-access cookie.
 *
 * Uses `cookies()` from next/headers — suitable for API route handlers.
 */
export async function verifyDevAccessFromCookies(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  const store = await cookies()
  const raw = store.get(DEV_ACCESS_COOKIE)?.value
  if (!raw) return false
  return verifyCookieValue(raw)
}

/**
 * Verifies the submitted secret against DEV_ACCESS_KEY using timingSafeEqual.
 * Returns true only on an exact, constant-time match.
 * Never logs or exposes the key.
 */
export function verifyAccessSecret(submitted: string): boolean {
  const expected = getDevSecret()
  if (!expected || !submitted) return false
  try {
    const a = Buffer.from(submitted)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Sets the pabbas_dev_access HTTP-only cookie in a Route Handler response.
 * Call this after successfully verifying the submitted secret.
 *
 * @returns The signed cookie value to write, or null if DEV_ACCESS_KEY is not set.
 */
export async function setDevAccessCookie(): Promise<boolean> {
  const value = buildCookieValue()
  if (!value) return false

  const store = await cookies()
  store.set(DEV_ACCESS_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEV_ACCESS_MAX_AGE,
  })
  return true
}

/**
 * Clears the pabbas_dev_access cookie.
 */
export async function clearDevAccessCookie(): Promise<void> {
  const store = await cookies()
  store.delete(DEV_ACCESS_COOKIE)
}
