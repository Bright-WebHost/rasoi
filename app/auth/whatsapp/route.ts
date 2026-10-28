/**
 * GET /auth/whatsapp?token=...
 *
 * Secure server-side token consumption endpoint.
 *
 * 1. Hashes the incoming token.
 * 2. Calls consume_ordering_token RPC to atomically claim the session.
 * 3. Looks up the customer identity.
 * 4. Sets an HTTP-only secure browser cookie.
 * 5. Redirects the user to the frontend ordering UI.
 *
 * The token is consumed immediately and never exposed to the client-side JavaScript.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashToken } from '@/lib/session/token'
import { setSessionCookie } from '@/lib/session/cookies'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')?.trim()

  // Always redirect somewhere clean, even on error, to avoid leaving token in history.
  // In a real app, this could redirect to /auth-error with a generic message.
  const errorRedirect = '/?auth_error=expired'

  if (!token) {
    return NextResponse.redirect(new URL(errorRedirect, request.url))
  }

  const tokenHash = hashToken(token)

  try {
    const admin = createAdminClient()

    // 1. Atomically consume token
    const { data, error: rpcError } = await admin.rpc('consume_ordering_token', {
      p_token_hash: tokenHash,
    })

    if (rpcError || !data || data.length === 0) {
      console.warn('Invalid or already consumed token attempt.')
      return NextResponse.redirect(new URL(errorRedirect, request.url))
    }

    const session = data[0]

    // 2. Lookup customer identity (optional for session, but good to ensure consistency)
    // The RPC ensures it's a valid session, and we have customer_id
    const customerId = session.customer_id

    // 3. Establish browser session
    await setSessionCookie({
      sessionId: session.id,
      customerId: customerId,
    })

    // 4. Redirect to the clean ordering URL, dropping the token parameter
    // We set a Referrer-Policy header via NextResponse if needed, but the 302 itself
    // to a URL without the token is the main protection against leaking via Referer.
    const response = NextResponse.redirect(new URL('/?from=whatsapp', request.url))
    
    // Hardening: Ensure we don't cache this redirect and don't leak referrer
    response.headers.set('Cache-Control', 'no-store, max-age=0')
    response.headers.set('Referrer-Policy', 'strict-origin')
    
    return response

  } catch (err) {
    console.error('Unexpected error consuming token:', err)
    return NextResponse.redirect(new URL(errorRedirect, request.url))
  }
}
