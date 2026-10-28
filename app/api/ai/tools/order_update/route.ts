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

  const { order_id, action, menu_item_id, quantity, customer_id } = body
  if (!order_id || !action || !menu_item_id || !customer_id) {
    return NextResponse.json({ error: 'order_id, customer_id, action, and menu_item_id are required' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // 1. Check order status (Locking logic)
  const { data: order, error: orderError } = await adminClient
    .from('orders')
    .select('id, status')
    .eq('id', order_id)
    .eq('customer_id', customer_id)
    .single()

  if (orderError || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const lockedStatuses = ['preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled']
  if (lockedStatuses.includes(order.status)) {
    return NextResponse.json({ error: 'ORDER_LOCKED' }, { status: 400 })
  }

  // 2. Validate menu item and get price
  const { data: menuItem, error: menuError } = await adminClient
    .from('menu_items')
    .select('id, price, available')
    .eq('id', menu_item_id)
    .single()

  if (menuError || !menuItem || !menuItem.available) {
    return NextResponse.json({ error: 'Menu item unavailable or not found' }, { status: 400 })
  }

  // 3. Get existing order item
  const { data: existingItem } = await adminClient
    .from('order_items')
    .select('id, quantity')
    .eq('order_id', order_id)
    .eq('menu_item_id', menu_item_id)
    .single()

  const qty = Number(quantity) || 1

  if (action === 'add' || action === 'update') {
    if (qty <= 0) {
      if (existingItem) {
        await adminClient.from('order_items').delete().eq('id', existingItem.id)
      }
    } else {
      if (existingItem) {
        const newQty = action === 'add' ? existingItem.quantity + qty : qty
        await adminClient.from('order_items').update({ quantity: newQty, unit_price: menuItem.price }).eq('id', existingItem.id)
      } else {
        await adminClient.from('order_items').insert({
          order_id,
          menu_item_id,
          quantity: qty,
          unit_price: menuItem.price
        })
      }
    }
  } else if (action === 'remove') {
    if (existingItem) {
      await adminClient.from('order_items').delete().eq('id', existingItem.id)
    }
  }

  // 4. Recalculate Order Total
  const { data: orderItems } = await adminClient
    .from('order_items')
    .select('quantity, unit_price')
    .eq('order_id', order_id)

  const newTotal = (orderItems || []).reduce((sum: number, item: { quantity: number; unit_price: number }) => sum + (item.quantity * Number(item.unit_price)), 0)

  await adminClient.from('orders').update({ total_amount: newTotal }).eq('id', order_id)

  return NextResponse.json({ success: true, new_total: newTotal })
}
