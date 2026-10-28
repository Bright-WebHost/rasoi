/**
 * POST /api/dev/whatsapp/session
 *
 * Development-only endpoint to simulate creating an ordering session
 * from a WhatsApp interaction.
 *
 * Request body:
 *   { channelUserId: string }
 *
 * Response:
 *   { url: string }       (the one-time URL to redirect the user to)
 *   { error: string }     on failure
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateToken, hashToken, TOKEN_TTL_SECONDS } from '@/lib/session/token'
import { verifyDevAccessFromCookies } from '@/lib/dev/access'

/** Development-only customer directory */
const DEV_CUSTOMERS: Record<string, { phone: string; name: string }> = {
  dev_customer_a: { phone: '+919876500001', name: 'Dev Customer A' },
  dev_customer_b: { phone: '+919876500002', name: 'Dev Customer B' },
}

export async function POST(request: Request) {
  // ── Dev-access guard ──────────────────────────────────────────────────
  // Locally: always passes (verifyDevAccessFromCookies returns true when NODE_ENV !== 'production').
  // On Vercel: requires the pabbas_dev_access cookie set by POST /api/dev/access.
  const hasDevAccess = await verifyDevAccessFromCookies()
  if (!hasDevAccess) {
    return NextResponse.json(
      { error: 'Dev simulator access is not enabled. Please authenticate at /dev/login.' },
      { status: 403 }
    )
  }

  // ── Parse request ────────────────────────────────────────────────────
  let body: { channelUserId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const channelUserId = body.channelUserId?.trim()
  if (!channelUserId) {
    return NextResponse.json({ error: 'channelUserId is required.' }, { status: 400 })
  }

  const devCustomer = DEV_CUSTOMERS[channelUserId]
  if (!devCustomer) {
    return NextResponse.json(
      { error: `Unknown development customer: "${channelUserId}".` },
      { status: 400 }
    )
  }

  try {
    const admin = createAdminClient()

    // 1. Find or create the customer in app_customers
    // This uses an upsert pattern on the unique constraint (channel, channel_user_id)
    const { data: customer, error: customerError } = await admin
      .from('app_customers')
      .upsert(
        {
          channel: 'whatsapp',
          channel_user_id: channelUserId,
          phone: devCustomer.phone,
          name: devCustomer.name,
        },
        { onConflict: 'channel,channel_user_id', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (customerError || !customer) {
      console.error('Failed to upsert customer:', customerError)
      return NextResponse.json({ error: 'Database error establishing customer identity.' }, { status: 500 })
    }

    // 2. Generate token server-side
    const rawToken = generateToken()
    const tokenHash = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString()

    // 3. Store the hashed session
    const { error: insertError } = await admin
      .from('ordering_sessions')
      .insert({
        customer_id: customer.id,
        channel: 'whatsapp',
        channel_user_id: channelUserId,
        token_hash: tokenHash,
        status: 'pending',
        expires_at: expiresAt,
      })

    if (insertError) {
      console.error('Failed to create ordering session:', insertError)
      return NextResponse.json({ error: 'Could not create ordering session.' }, { status: 500 })
    }

    // 4. Return the one-time link (as a relative URL so it works seamlessly on LAN IPs) and the Supabase UUID
    const url = `/auth/whatsapp?token=${encodeURIComponent(rawToken)}`

    return NextResponse.json({ 
      url: url,
      supabaseCustomerId: customer.id 
    })
  } catch (err: any) {
    console.error('Session creation failed:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
