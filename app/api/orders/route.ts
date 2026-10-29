import { NextResponse } from 'next/server'
import { getSessionCookie } from '@/lib/session/cookies'
import { createCustomerOrder } from '@/lib/orders/create'
import { timingSafeSecretEquals } from '@/lib/server/internal-auth'

export async function POST(request: Request) {
  try {
    const aiSecret = request.headers.get('x-rasoi-ai-secret')?.trim()
    const isAiBackend = timingSafeSecretEquals(aiSecret, process.env.RASOI_AI_WEBHOOK_SECRET)

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    let customerId: string | null = null
    if (isAiBackend && typeof body.customer_id === 'string') {
      customerId = body.customer_id
    } else {
      const session = await getSessionCookie()
      if (session?.customerId) customerId = session.customerId
    }

    const result = await createCustomerOrder({
      source: isAiBackend && body.source === 'whatsapp' ? 'whatsapp' : 'pwa',
      orderType: body.order_type,
      customerName: body.customer_name,
      customerPhone: body.customer_phone,
      customerId,
      channelUserId: body.channel_user_id,
      idempotencyKey: body.idempotency_key,
      paymentMethod: body.payment_method,
      deliveryAddress: body.delivery_address,
      landmark: body.landmark,
      pincode: body.pincode,
      scheduledTime: body.scheduled_time,
      tableNumber: body.table_number || body.table_id,
      cartItems: body.cart_items,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error, ...(result.code ? { code: result.code } : {}) }, { status: result.status })
    }

    return NextResponse.json({
      success: true,
      // Top-level copy for the n8n "Confirm Order" node, which reads $json.order_number.
      order_number: result.orderNumber,
      total: result.total,
      delivery_fee: result.deliveryFee,
      order: {
        order_number: result.orderNumber,
        order_type: result.orderType,
        order_status: result.status,
        total: result.total,
        delivery_fee: result.deliveryFee,
        scheduled_for: result.scheduledFor,
        is_duplicate: result.isDuplicate,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to place order'
    console.error('[POST /api/orders] Internal error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
