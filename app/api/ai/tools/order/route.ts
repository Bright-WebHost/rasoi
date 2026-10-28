import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkOrderRules } from '@/lib/settings'
import { getActivePincodes, getSettings } from '@/lib/settings/server'

type ActiveMenuItem = { id: string; is_active: boolean }
type ActiveMenuVariant = { id: string; menu_item_id: string; is_active: boolean }

const VALID_ORDER_TYPES = new Set(['delivery', 'pickup', 'dine-in'])

function normalizeOrderType(value: unknown): 'delivery' | 'pickup' | 'dine-in' | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (!normalized) return null

  if (normalized === 'takeaway') return 'pickup'
  if (normalized === 'dinein') return 'dine-in'
  if (VALID_ORDER_TYPES.has(normalized)) {
    return normalized as 'delivery' | 'pickup' | 'dine-in'
  }

  return null
}

function sanitizeCartItems(input: unknown): Array<{ menu_item_id: string; variant_id?: string | null; quantity: number }> {
  if (!Array.isArray(input)) {
    throw new Error('cart_items must be an array.')
  }

  const sanitized: Array<{ menu_item_id: string; variant_id?: string | null; quantity: number }> = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each cart item must be an object.')
    }

    const record = item as Record<string, unknown>
    const menuItemId = typeof record.menu_item_id === 'string' ? record.menu_item_id : typeof record.menuItemId === 'string' ? record.menuItemId : null
    const variantId = typeof record.variant_id === 'string' ? record.variant_id : typeof record.variantId === 'string' ? record.variantId : null
    const quantity = Number(record.quantity)

    if (!menuItemId) {
      throw new Error('Each cart item requires a menu_item_id.')
    }

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      throw new Error('Each cart item quantity must be a positive integer.')
    }

    sanitized.push({
      menu_item_id: menuItemId,
      variant_id: variantId || null,
      quantity,
    })
  }

  return sanitized
}

export async function POST(request: Request) {
  const secretHeader = request.headers.get('x-pabbas-ai-secret')?.trim()
  const expectedSecret = process.env.PABBAS_AI_WEBHOOK_SECRET?.trim()

  if (!expectedSecret || secretHeader !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const customerId = typeof body.customer_id === 'string' ? body.customer_id : typeof body.customerId === 'string' ? body.customerId : null
  const customerName = typeof body.customer_name === 'string' ? body.customer_name : typeof body.customerName === 'string' ? body.customerName : 'WhatsApp Customer'
  const customerPhone = typeof body.customer_phone === 'string' ? body.customer_phone : typeof body.customerPhone === 'string' ? body.customerPhone : ''
  const orderType = normalizeOrderType(body.order_type ?? body.type)
  const deliveryAddress = typeof body.delivery_address === 'string' ? body.delivery_address : typeof body.deliveryAddress === 'string' ? body.deliveryAddress : null
  const landmark = typeof body.landmark === 'string' ? body.landmark : null
  const pincode = typeof body.pincode === 'string' ? body.pincode : null
  const scheduledTime = typeof body.scheduled_time === 'string' ? body.scheduled_time : typeof body.scheduledTime === 'string' ? body.scheduledTime : null
  const paymentMethod = typeof body.payment_method === 'string' ? body.payment_method : typeof body.paymentMethod === 'string' ? body.paymentMethod : 'upi'
  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
  const tableId = typeof body.table_id === 'string' ? body.table_id : typeof body.tableId === 'string' ? body.tableId : null
  const partySize = Number(body.party_size ?? body.partySize ?? 1)

  if (!customerId) {
    return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
  }

  if (!orderType) {
    return NextResponse.json({ error: 'Valid order_type is required.' }, { status: 400 })
  }

  if (!['upi', 'cash', 'online'].includes(paymentMethod.toLowerCase())) {
    return NextResponse.json({ error: 'Unsupported payment method.' }, { status: 400 })
  }

  let cartItems: Array<{ menu_item_id: string; variant_id?: string | null; quantity: number }>

  try {
    cartItems = sanitizeCartItems(body.cart_items ?? body.cart)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid cart payload.' }, { status: 400 })
  }

  if (orderType === 'delivery' && (!deliveryAddress || !deliveryAddress.trim())) {
    return NextResponse.json({ error: 'Delivery address is required for delivery orders.' }, { status: 400 })
  }

  if (orderType === 'dine-in' && !tableId) {
    return NextResponse.json({ error: 'Table selection is required for dine-in orders.' }, { status: 400 })
  }

  // Hours / pause, order types and delivery pincodes from Settings. Prices are computed
  // inside create_customer_order, so the minimum order is enforced on /api/orders only.
  const [settings, activePincodes] = await Promise.all([getSettings(), getActivePincodes()])
  const ruleError = checkOrderRules({ ...settings, minOrder: 0 }, activePincodes, {
    orderType: orderType === 'pickup' ? 'takeaway' : orderType,
    itemsSubtotal: 0,
    pincode,
  })
  if (ruleError) {
    return NextResponse.json({ error: ruleError, code: 'ORDER_RULES' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const menuItemIds = [...new Set(cartItems.map((item) => item.menu_item_id))]

  const { data: activeMenuItems, error: activeMenuItemsError } = (await adminClient
    .from('menu_items')
    .select('id, is_active')
    .in('id', menuItemIds)
    .eq('is_active', true)) as { data: ActiveMenuItem[] | null; error: { message?: string } | null }

  if (activeMenuItemsError) {
    return NextResponse.json({ error: 'Menu validation failed.' }, { status: 500 })
  }

  const validMenuItemIds = new Set((activeMenuItems ?? []).map((item: ActiveMenuItem) => item.id))
  const missingMenuItemIds = menuItemIds.filter((id) => !validMenuItemIds.has(id))

  if (missingMenuItemIds.length > 0) {
    return NextResponse.json({ error: 'One or more requested menu items are unavailable.' }, { status: 400 })
  }

  const variantIds = cartItems
    .map((item) => item.variant_id)
    .filter((value): value is string => Boolean(value))

  if (variantIds.length > 0) {
    const { data: activeVariants, error: activeVariantsError } = (await adminClient
      .from('menu_item_variants')
      .select('id, menu_item_id, is_active')
      .in('id', variantIds)
      .eq('is_active', true)) as { data: ActiveMenuVariant[] | null; error: { message?: string } | null }

    if (activeVariantsError) {
      return NextResponse.json({ error: 'Variant validation failed.' }, { status: 500 })
    }

    const activeVariantMap = new Map((activeVariants ?? []).map((variant: ActiveMenuVariant) => [variant.id, variant.menu_item_id]))

    for (const item of cartItems) {
      if (!item.variant_id) continue
      const matchingMenuItemId = activeVariantMap.get(item.variant_id)
      if (!matchingMenuItemId || matchingMenuItemId !== item.menu_item_id) {
        return NextResponse.json({ error: 'One or more selected variants are invalid for the requested item.' }, { status: 400 })
      }
    }
  }

  const normalizedPayload = {
    p_customer_id: customerId,
    p_order_type: orderType,
    p_customer_name: customerName,
    p_customer_phone: customerPhone,
    p_delivery_address: orderType === 'delivery' ? deliveryAddress : null,
    p_landmark: landmark || null,
    p_pincode: pincode || null,
    p_scheduled_time: scheduledTime || null,
    p_payment_method: paymentMethod.toLowerCase(),
    p_idempotency_key: idempotencyKey || null,
    p_cart_items: cartItems,
    p_table_id: orderType === 'dine-in' ? tableId : null,
    p_party_size: Number.isFinite(partySize) && partySize > 0 ? partySize : 1,
  }

  const { data, error } = await (adminClient.rpc as any)('create_customer_order', normalizedPayload)

  if (error) {
    return NextResponse.json({ error: error.message || 'Order could not be created.' }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    order: data,
    created_by: 'pabbas_ai_bridge',
  })
}
