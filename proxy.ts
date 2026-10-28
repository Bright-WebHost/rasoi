import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'

// ── Dev-access cookie constants (must match lib/dev/access.ts) ────────────────
const DEV_ACCESS_COOKIE = 'pabbas_dev_access'

/**
 * Verifies the pabbas_dev_access cookie value.
 *
 * The cookie is of the form `<nonce>.<hmac-sha256>` where the HMAC is keyed
 * with DEV_ACCESS_KEY. This is safe to run in Edge Middleware because we only
 * use the Web Crypto-compatible subset of the `crypto` module that Next.js
 * bundles for the Edge runtime.
 */
function verifyDevCookieInMiddleware(raw: string): boolean {
  const secret = process.env.DEV_ACCESS_KEY
  if (!secret) return false

  const dotIdx = raw.lastIndexOf('.')
  if (dotIdx === -1) return false

  const nonce = raw.slice(0, dotIdx)
  const sig = raw.slice(dotIdx + 1)

  const expected = createHmac('sha256', secret).update(nonce).digest('hex')

  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

import { updateSession } from './lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Dev route protection ─────────────────────────────────────────────
  if (pathname.startsWith('/dev')) {
    // LOCAL: always allow — no friction during development.
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.next({ request })
    }

    // PRODUCTION: /dev/login must remain accessible so the user can authenticate.
    if (pathname === '/dev/login' || pathname.startsWith('/dev/login/')) {
      return NextResponse.next({ request })
    }

    // PRODUCTION: all other /dev/* paths require a valid pabbas_dev_access cookie.
    const raw = request.cookies.get(DEV_ACCESS_COOKIE)?.value
    if (!raw || !verifyDevCookieInMiddleware(raw)) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/dev/login'
      loginUrl.search = ''
      return NextResponse.redirect(loginUrl)
    }
    
    return NextResponse.next({ request })
  }

  // Handle Supabase Auth for Dashboard
  return await updateSession(request)
}


export const config = {
  matcher: [
    /*
     * Match all request paths except for static files and assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
