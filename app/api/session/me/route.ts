/**
 * GET /api/session/me
 *
 * Returns the current ordering session identity (from cookie).
 * Used by the AuthProvider on the client to know if a session is active.
 *
 * It decodes the opaque cookie and fetches the non-sensitive customer details
 * (name, phone) server-side from the app_customers table.
 *
 * POST /api/session/me  (with body { action: "signout" })
 * Clears the session cookie.
 */

import { NextResponse } from 'next/server'
import { getSessionCookie, clearSessionCookie } from '@/lib/session/cookies'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const session = await getSessionCookie()
  if (!session) {
    return NextResponse.json({ authenticated: false })
  }

  // Look up the customer data safely server-side
  const admin = createAdminClient()
  const { data: customer } = await admin
    .from('app_customers')
    .select('phone, name')
    .eq('id', session.customerId)
    .single()

  return NextResponse.json({
    authenticated: true,
    sessionId: session.sessionId,
    customerId: session.customerId,
    phone: customer?.phone || '',
    name: customer?.name || '',
  })
}

export async function POST(request: Request) {
  let body: { action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  if (body.action === 'signout') {
    await clearSessionCookie()
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
