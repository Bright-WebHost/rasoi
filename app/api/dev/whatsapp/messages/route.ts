import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDevAccessFromCookies } from '@/lib/dev/access'

export async function GET(request: Request) {
  // ── Dev-access guard ──────────────────────────────────────────────────
  const hasDevAccess = await verifyDevAccessFromCookies()
  if (!hasDevAccess) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const customerId = searchParams.get('customerId')
  const after = searchParams.get('after')

  if (!customerId) {
    return NextResponse.json({ error: 'Missing customerId' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  
  let query = adminClient
    .from('dev_whatsapp_messages')
    .select('id, message, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: true })

  if (after) {
    query = query.gt('created_at', after)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ messages: data })
}
