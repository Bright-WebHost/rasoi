import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const secretHeader = request.headers.get('x-pabbas-ai-secret')?.trim()
  const expectedSecret = process.env.PABBAS_AI_WEBHOOK_SECRET?.trim()

  if (!expectedSecret || secretHeader !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { customer_id } = body
  if (!customer_id) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Fetch the most recent order for this customer
  const { data: order, error } = await adminClient
    .from('orders')
    .select('id, order_number, status, total_amount, created_at')
    .eq('customer_id', customer_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !order) {
    return NextResponse.json({ error: 'No recent orders found for this customer.' })
  }

  return NextResponse.json({ order })
}
