import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Customer asked for a person: pause the AI for this chat so staff can reply
 * from Live Chat (which flags these chats). Staff turn the AI back on there.
 */
const HANDOVER_BY = 'customer_request'

export async function POST(request: Request) {
  const secret = request.headers.get('x-pabbas-ai-secret')?.trim()
  if (!secret || secret !== process.env.PABBAS_AI_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  if (!rawPhone) return NextResponse.json({ error: 'phone is required' }, { status: 400 })

  const db = createAdminClient()
  const { data: phone } = await db.rpc('normalize_phone', { raw: rawPhone })
  const { error } = await db
    .from('chat_sessions')
    .update({ ai_enabled: false, ai_disabled_at: new Date().toISOString(), ai_disabled_by: HANDOVER_BY })
    .eq('phone', typeof phone === 'string' && phone ? phone : rawPhone.replace(/\D/g, ''))
  if (error) console.error('[handover] could not pause AI:', error.message)

  return NextResponse.json({
    success: true,
    reply: "Sure! 🙏 I've asked our team to reply to you here personally. They'll be with you shortly.",
  })
}
