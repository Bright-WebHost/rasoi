/**
 * POST /api/dev/access
 *
 * Issues a pabbas_dev_access HTTP-only cookie after verifying the submitted
 * DEV_ACCESS_KEY secret. This is the only way to unlock /dev/* routes on Vercel.
 *
 * Security:
 * - Secret comparison uses timingSafeEqual (constant-time).
 * - The secret is never echoed, logged, or returned to the client.
 * - The cookie value is a signed nonce, not the raw key.
 * - This cookie does NOT grant customer identity — that is handled separately
 *   by the pabbas_session cookie set by /auth/whatsapp.
 *
 * Request body:
 *   { secret: string }
 *
 * Responses:
 *   200  { ok: true }          — cookie set, proceed to /dev/whatsapp
 *   401  { error: string }     — invalid secret
 *   400  { error: string }     — bad request body
 *   500  { error: string }     — server misconfiguration (DEV_ACCESS_KEY not set)
 */

import { NextResponse } from 'next/server'
import { verifyAccessSecret, setDevAccessCookie } from '@/lib/dev/access'

export async function POST(request: Request) {
  // ── Parse body ─────────────────────────────────────────────────────────
  let body: { secret?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const submitted = typeof body.secret === 'string' ? body.secret.trim() : ''
  if (!submitted) {
    return NextResponse.json({ error: 'secret is required.' }, { status: 400 })
  }

  // ── Verify DEV_ACCESS_KEY is configured ────────────────────────────────
  if (!process.env.DEV_ACCESS_KEY) {
    console.error('[dev/access] DEV_ACCESS_KEY environment variable is not set.')
    return NextResponse.json(
      { error: 'Server misconfiguration. DEV_ACCESS_KEY is not set.' },
      { status: 500 }
    )
  }

  // ── Constant-time comparison ───────────────────────────────────────────
  const valid = verifyAccessSecret(submitted)
  if (!valid) {
    // Do NOT log the submitted value — it might be a real secret from another system.
    return NextResponse.json({ error: 'Invalid access key.' }, { status: 401 })
  }

  // ── Set the HTTP-only cookie ───────────────────────────────────────────
  const ok = await setDevAccessCookie()
  if (!ok) {
    return NextResponse.json(
      { error: 'Failed to issue access cookie. Is DEV_ACCESS_KEY set?' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
