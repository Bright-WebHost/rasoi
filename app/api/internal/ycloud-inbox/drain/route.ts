import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isInternalRequest } from '@/lib/server/internal-auth'
import { drainYCloudInbox, forwarderConfig } from '@/lib/server/ycloud-forwarder'

// Retry sweeper for the YCloud event inbox, called on a schedule by n8n
// (Vercel Hobby cron runs only daily). Returns counts only, never payloads.
export async function POST(request: Request) {
  if (!isInternalRequest(request)) return new NextResponse('Unauthorized', { status: 401 })
  const config = forwarderConfig()
  if (!config) return NextResponse.json({ enabled: false })
  try {
    return NextResponse.json({ enabled: true, ...await drainYCloudInbox(createAdminClient(), config, { limit: 20 }) })
  } catch {
    console.error('YCloud inbox drain failed')
    return new NextResponse('Drain failed', { status: 503 })
  }
}
