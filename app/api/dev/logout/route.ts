/**
 * POST /api/dev/logout
 *
 * Clears the pabbas_dev_access HTTP-only cookie, revoking simulator access
 * on Vercel. After calling this, /dev/whatsapp will redirect to /dev/login.
 *
 * This does NOT affect the customer ordering session (pabbas_session).
 *
 * Response:
 *   200  { ok: true }
 */

import { NextResponse } from 'next/server'
import { clearDevAccessCookie } from '@/lib/dev/access'

export async function POST() {
  await clearDevAccessCookie()
  return NextResponse.json({ ok: true })
}
