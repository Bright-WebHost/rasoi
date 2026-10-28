import { NextResponse } from 'next/server'
import { getSessionCookie } from '@/lib/session/cookies'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDevAccessFromCookies } from '@/lib/dev/access'

/**
 * POST /api/dev/whatsapp/ai
 *
 * Secure server-side bridge between the WhatsApp Simulator and the n8n AI Agent.
 *
 * Identity resolution (in order of priority):
 * 1. Session cookie (from /auth/whatsapp) — the production path.
 * 2. channelUserId from the request body — dev-only fallback.
 *
 * The channelUserId is resolved server-side against app_customers
 * and is never trusted blindly from the browser.
 */

/** Development-only customer directory */
const DEV_CUSTOMERS: Record<string, { phone: string; name: string }> = {
  dev_customer_a: {
    phone: '+919876500001',
    name: 'Dev Customer A',
  },
  dev_customer_b: {
    phone: '+919876500002',
    name: 'Dev Customer B',
  },
}

export async function POST(request: Request) {
  let body: {
    message?: string
    conversation_id?: string
    channelUserId?: string
  }

  // --------------------------------------------------
  // 1. Parse request body
  // --------------------------------------------------

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body.' },
      { status: 400 }
    )
  }

  const {
    message,
    conversation_id,
    channelUserId,
  } = body

  if (!message || !conversation_id) {
    return NextResponse.json(
      { error: 'message and conversation_id are required.' },
      { status: 400 }
    )
  }

  // --------------------------------------------------
  // 2. Resolve customer identity
  // --------------------------------------------------

  const admin = createAdminClient()

  let customerId: string
  let customerPhone: string

  const session = await getSessionCookie()

  if (session) {
    // Production path:
    // Resolve customer from the authenticated session cookie.

    const { data: customer, error } = await admin
      .from('app_customers')
      .select('id, phone')
      .eq('id', session.customerId)
      .single()

    if (error || !customer) {
      return NextResponse.json(
        { error: 'Customer not found.' },
        { status: 404 }
      )
    }

    customerId = customer.id
    customerPhone = customer.phone
  } else if (
    channelUserId &&
    (await verifyDevAccessFromCookies())
  ) {
    // Development fallback:
    // Resolve the simulated customer server-side.

    const devCustomer = DEV_CUSTOMERS[channelUserId]

    if (!devCustomer) {
      return NextResponse.json(
        { error: 'Unknown dev customer.' },
        { status: 400 }
      )
    }

    const { data: customer, error } = await admin
      .from('app_customers')
      .select('id, phone')
      .eq('channel', 'whatsapp')
      .eq('channel_user_id', channelUserId)
      .single()

    if (error || !customer) {
      return NextResponse.json(
        {
          error:
            'Dev customer not found in database. Send a message first to create the session.',
        },
        { status: 404 }
      )
    }

    customerId = customer.id
    customerPhone = customer.phone
  } else {
    return NextResponse.json(
      { error: 'Unauthorized. No active session.' },
      { status: 401 }
    )
  }

  // --------------------------------------------------
  // 3. Get n8n configuration
  // --------------------------------------------------

  const webhookUrl = process.env.N8N_AI_WEBHOOK_URL
  const webhookSecret = process.env.PABBAS_AI_WEBHOOK_SECRET

  if (!webhookUrl || !webhookSecret) {
    console.error(
      'Missing N8N_AI_WEBHOOK_URL or PABBAS_AI_WEBHOOK_SECRET'
    )

    return NextResponse.json(
      { error: 'Server configuration error.' },
      { status: 500 }
    )
  }

  // --------------------------------------------------
  // 4. Call n8n AI webhook
  // --------------------------------------------------

  try {
    const n8nRes = await fetch(webhookUrl, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',

        // IMPORTANT:
        // The Pabbas AI n8n webhook expects the AI-specific
        // authentication header.
        'x-pabbas-ai-secret': webhookSecret,
      },

      body: JSON.stringify({
        customer_id: customerId,
        phone: customerPhone,
        message,
        conversation_id,
      }),
    })

    // ------------------------------------------------
    // 5. Handle n8n errors
    // ------------------------------------------------

    if (!n8nRes.ok) {
      const errText = await n8nRes.text().catch(() => '')

      console.error(
        'n8n returned error status:',
        n8nRes.status,
        errText
      )

      return NextResponse.json(
        {
          error:
            "Sorry, I'm having trouble connecting right now. You can still use the Pabbas ordering page to place your order.",
        },
        { status: 502 }
      )
    }

    // ------------------------------------------------
    // 6. Read n8n response
    // ------------------------------------------------

    const n8nData = await n8nRes.json()

    console.log('n8n AI response received:', {
      customerId,
      conversation_id,
      hasOutput: Boolean(n8nData?.output),
    })

    // ------------------------------------------------
    // 7. Return AI response to simulator
    // ------------------------------------------------

    return NextResponse.json({
      reply:
        n8nData.output ||
        n8nData.reply ||
        n8nData.message ||
        'Sorry, I did not understand that.',
    })
  } catch (err) {
    console.error('Failed to reach n8n:', err)

    return NextResponse.json(
      {
        error:
          "Sorry, I'm having trouble connecting right now. You can still use the Pabbas ordering page to place your order.",
      },
      { status: 502 }
    )
  }
}