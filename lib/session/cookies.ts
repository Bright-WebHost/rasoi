/**
 * Ordering Session — Cookie management
 *
 * Manages an HTTP-only, secure cookie that identifies the customer's
 * ordering session on the website.
 *
 * The cookie contains a signed JSON payload with:
 *   - sessionId   (ordering_sessions.id)
 *   - customerId  (app_customers.id)
 *   - iat         (issued-at timestamp)
 *   - exp         (expiration timestamp)
 *
 * This is NOT a general-purpose session — it is specific to an ordering session
 * established via the WhatsApp-linked flow.
 */

import { cookies } from 'next/headers'
import { createHmac } from 'crypto'

export const SESSION_COOKIE_NAME = 'pabbas_session'
const SESSION_MAX_AGE = 60 * 60 * 2 // 2 hours

export interface OrderingSessionPayload {
  sessionId: string
  customerId: string
  iat: number
  exp: number
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY /* Fallback to prevent breaking existing sessions during migration */
  if (!secret) {
    throw new Error('SESSION_SECRET or SUPABASE_SECRET_KEY must be set for cookie signing.')
  }
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex')
}

/**
 * Sets the ordering session cookie.
 */
export async function setSessionCookie(payload: Omit<OrderingSessionPayload, 'iat' | 'exp'>): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: OrderingSessionPayload = {
    ...payload,
    iat: now,
    exp: now + SESSION_MAX_AGE,
  }

  const json = JSON.stringify(fullPayload)
  const signature = sign(json)
  const value = `${Buffer.from(json).toString('base64url')}.${signature}`

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
}

/**
 * Reads and verifies the ordering session cookie.
 * Returns null if missing, malformed, signature invalid, or expired.
 */
export async function getSessionCookie(): Promise<OrderingSessionPayload | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!raw) return null

  const dotIndex = raw.lastIndexOf('.')
  if (dotIndex === -1) return null

  const payloadB64 = raw.slice(0, dotIndex)
  const sig = raw.slice(dotIndex + 1)

  let json: string
  try {
    json = Buffer.from(payloadB64, 'base64url').toString('utf-8')
  } catch {
    return null
  }

  const expected = sign(json)
  if (sig !== expected) return null

  try {
    const payload = JSON.parse(json) as OrderingSessionPayload
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) {
      return null
    }
    
    return payload
  } catch {
    return null
  }
}

/**
 * Clears the ordering session cookie.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}
