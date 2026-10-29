import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseYCloudEvent, persistYCloudEvent, verifyYCloudSignature, YCloudSupportedEvents } from '@/lib/server/ycloud-webhook'
import { drainYCloudInbox, forwarderConfig } from '@/lib/server/ycloud-forwarder'

// Verified events are durably accepted; forwarding to n8n is opt-in. No order actions here.

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('ycloud-signature')
  const secret = process.env.YCLOUD_WEBHOOK_SECRET?.trim()

  if (!secret) {
    console.error('YCloud webhook signing secret is not configured')
    return new NextResponse('Webhook is not configured', { status: 500 })
  }
  if (!signature || !verifyYCloudSignature(rawBody, signature, secret)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const parsed = parseYCloudEvent(rawBody)
  if (!parsed.event) return new NextResponse('Bad Request', { status: 400 })
  const { event, messageId } = parsed

  // Unsupported events are acknowledged without persistence or side effects.
  if (!YCloudSupportedEvents.has(event.type)) return new NextResponse(null, { status: 204 })

  // A unique provider event id makes concurrent retries atomic. Never use the
  // application messages table for webhook idempotency: it represents chat history.
  try {
    const admin = createAdminClient()
    const { error } = await persistYCloudEvent(admin, event, messageId)
    if (error) {
      console.error('YCloud event inbox acceptance failed')
      return new NextResponse('Temporary webhook storage failure', { status: 503 })
    }
  } catch {
    console.error('YCloud event inbox is unavailable')
    return new NextResponse('Temporary webhook storage failure', { status: 503 })
  }

  // Forward after responding so YCloud is acknowledged fast. Failures stay in the
  // inbox and are retried by /api/internal/ycloud-inbox/drain.
  const config = forwarderConfig()
  if (config) {
    after(() => drainYCloudInbox(createAdminClient(), config, { limit: 5 })
      .catch(() => console.error('YCloud inbox forward attempt failed')))
  }
  return new NextResponse(null, { status: 204 })
}
